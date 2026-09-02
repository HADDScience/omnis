import NextAuth from "next-auth"
import type { Provider } from "next-auth/providers"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import Kakao from "next-auth/providers/kakao"
import { compareSync } from "bcryptjs"
import { prisma } from "./db"
import { resolveIdentity, linkIdentity, rememberIdentityEmail } from "./auth-identity"

// 소셜은 자격증명이 실제로 설정된 것만 켠다.
// 키 없이 프로바이더를 등록하면 로그인 화면에 버튼은 뜨는데 누르면 깨진다.
const providers: Provider[] = [
  Credentials({
    credentials: {
      name: { label: "이름", type: "text" },
      password: { label: "비밀번호", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.name || !credentials?.password) return null

      const user = await prisma.user.findUnique({
        where: { name: credentials.name as string },
      })

      if (!user || !user.isActive) return null
      if (!compareSync(credentials.password as string, user.passwordHash))
        return null

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    },
  }),
]

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google)
if (process.env.AUTH_KAKAO_ID && process.env.AUTH_KAKAO_SECRET) providers.push(Kakao)

/** 로그인 화면이 어떤 소셜 버튼을 그릴지 판단할 때 쓴다. */
export const enabledSocialProviders = providers
  .map((p) => (typeof p === "function" ? p() : p))
  .map((p) => p.id)
  .filter((id): id is "google" | "kakao" => id === "google" || id === "kakao")

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  callbacks: {
    /**
     * 소셜로 들어온 요청을 어떻게 처리할지 정한다.
     *
     * 1. 이미 연결된 소셜  → 그 자체 계정으로 로그인
     * 2. 연결 안 됐는데 로그인 중 → 지금 계정에 연결 (설정에서 "연결" 누른 경우)
     * 3. 연결 안 됐고 로그인도 안 됨 → 거부. 소셜만으로는 계정이 생기지 않는다.
     *
     * 3번이 이 설계의 핵심이다. 소셜 이메일로 사람을 짐작해 새 계정을 만들면
     * 구글 계정 가진 아무나 사내 업무 데이터에 들어온다.
     */
    async signIn({ user, account }) {
      if (!account || account.provider === "credentials") return true

      // 이메일은 account 가 아니라 제공자 프로필에서 온 user 에 실린다.
      const social = {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email: user.email ?? null,
      }

      if (await resolveIdentity(social)) {
        await rememberIdentityEmail(social)
        return true
      }

      const current = await auth()
      if (!current?.user?.id) return "/login?error=notlinked"

      const result = await linkIdentity(current.user.id, social)
      if (!result.ok) return `/settings?error=${result.reason}`
      return true
    },

    async jwt({ token, user, account }) {
      if (user && account) {
        if (account.provider === "credentials") {
          token.id = user.id
          token.role = (user as { role?: string }).role
        } else {
          // 소셜 프로필이 아니라 연결된 자체 계정을 세션에 싣는다.
          // 화면에 뜨는 이름은 언제나 옴니스 계정 이름이어야 한다.
          const owner = await resolveIdentity({
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          })
          if (!owner) return {}
          token.id = owner.id
          token.role = owner.role
          token.name = owner.name
          token.email = owner.email
        }
      } else if (token.id) {
        // 방어 코드: DB가 reseed되어 token.id가 더 이상 존재하지 않으면 세션 무효화
        // (그러지 않으면 후속 write에서 FK violation 발생)
        const exists = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { id: true },
        })
        if (!exists) return {}
      }
      token.lastActiveAt = Date.now()
      return token
    },

    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string
        ;(session.user as { role?: string }).role = token.role as string
      }
      ;(session as { lastActiveAt?: number }).lastActiveAt = token.lastActiveAt as number | undefined
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 90 * 24 * 60 * 60,
    updateAge: 60,
  },
  jwt: {
    maxAge: 90 * 24 * 60 * 60,
  },
})
