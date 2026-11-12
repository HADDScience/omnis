import NextAuth, { CredentialsSignin } from "next-auth"
import type { Provider } from "next-auth/providers"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import Kakao from "next-auth/providers/kakao"
import { compareSync } from "bcryptjs"
import { prisma } from "./db"
import { resolveIdentity, linkIdentity, rememberIdentityEmail } from "./auth-identity"
import { BASE_PATH } from "./base-path"
import { clientIp, loginAttemptInfo, recordLoginFailure, recordLoginSuccess } from "./login-guard"
import { encodeAttemptCode, normalizeLoginName } from "./login-attempts"
import { verifyLoginCode } from "./login-code-server"
import { isCodeShape } from "./login-code"
import { PASSWORD_ENTITY } from "./password-state"

/**
 * 로그인 실패 — `code` 에 남은 횟수 · 잠금 시각을 싣는다(lib/login-attempts.ts, 로그인 화면이 읽는다).
 * 없는 이름 · 틀린 비밀번호 · 쉬는 계정이 모두 같은 모양이라 계정이 있는지 드러나지 않는다.
 */
class LoginFailed extends CredentialsSignin {
  constructor(code: string) {
    super()
    this.code = code
  }
}

// 소셜은 자격증명이 실제로 설정된 것만 켠다.
// 키 없이 프로바이더를 등록하면 로그인 화면에 버튼은 뜨는데 누르면 깨진다.
const providers: Provider[] = [
  Credentials({
    credentials: {
      name: { label: "이름", type: "text" },
      password: { label: "비밀번호", type: "password" },
    },
    async authorize(credentials, request) {
      if (!credentials?.name || !credentials?.password) return null
      // 잠금 키와 조회가 같은 이름을 보게 — 앞뒤 공백 · 자모 분리(NFD)를 정리한다
      const name = normalizeLoginName(credentials.name as string)
      if (!name) return null
      const ip = clientIp(request?.headers)

      // 잠긴 동안에는 대조하지 않는다(lib/login-guard.ts)
      const before = await loginAttemptInfo(name, ip)
      if (before.locked) throw new LoginFailed(encodeAttemptCode(before))

      const user = await prisma.user.findUnique({ where: { name } })

      if (!user || !user.isActive || !compareSync(credentials.password as string, user.passwordHash)) {
        await recordLoginFailure(name, ip)
        throw new LoginFailed(encodeAttemptCode(await loginAttemptInfo(name, ip)))
      }
      await recordLoginSuccess(user.id, name)

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    },
  }),
  // 로그인 코드(웍스 메일로 받은 6자리) — 처음 로그인 · 비밀번호를 잊었을 때. 들어오면 새 비밀번호를 만들 때까지 앱을 막는다
  // (ActivityLog auth.password 의 code_login — lib/password-notice.ts). 규칙: lib/login-code.ts
  Credentials({
    id: "login-code",
    credentials: {
      identifier: { label: "이름 또는 웍스 메일", type: "text" },
      code: { label: "로그인 코드", type: "text" },
    },
    async authorize(credentials, request) {
      const identifier = normalizeLoginName(String(credentials?.identifier ?? ""))
      const code = String(credentials?.code ?? "").trim()
      if (!identifier || !isCodeShape(code)) return null
      const ip = clientIp(request?.headers)
      const before = await loginAttemptInfo(identifier, ip)
      if (before.locked) throw new LoginFailed(encodeAttemptCode(before))
      const user = await verifyLoginCode(identifier, code)
      if (!user) {
        await recordLoginFailure(identifier, ip)
        throw new LoginFailed(encodeAttemptCode(await loginAttemptInfo(identifier, ip)))
      }
      await recordLoginSuccess(user.id, identifier)
      await prisma.activityLog.create({
        data: { userId: user.id, entity: PASSWORD_ENTITY, entityId: user.id, action: "code_login", title: "로그인 코드로 로그인" },
      })
      return { id: user.id, name: user.name, email: user.email, role: user.role }
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
      if (!account || account.provider === "credentials" || account.provider === "login-code") return true

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
      if (!result.ok) return `/settings/profile?error=${result.reason}`
      return true
    },

    async jwt({ token, user, account }) {
      if (user && account) {
        if (account.provider === "credentials" || account.provider === "login-code") {
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

    /**
     * 로그인·로그아웃 뒤 돌아갈 곳. 화면은 "/tasks" 처럼 앱 안 경로를 넘기는데,
     * NextAuth 는 그것을 호스트 루트에 붙인다 — basePath(/omnis) 아래 뜰 때는 그
     * 자리가 홈페이지라 404 다. 앱 안 경로면 basePath 를 붙이고, 다른 오리진은 막는다.
     */
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url.startsWith(`${BASE_PATH}/`) || url === BASE_PATH ? url : `${BASE_PATH}${url}`}`
      }
      return new URL(url).origin === baseUrl ? url : `${baseUrl}${BASE_PATH}`
    },
  },
  // basePath 아래 뜰 때 NextAuth 가 자기 경로를 알아야 콜백·로그인 화면 주소가 맞는다.
  basePath: `${BASE_PATH}/api/auth`,
  pages: {
    signIn: `${BASE_PATH}/login`,
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
