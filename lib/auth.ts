import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compareSync } from "bcryptjs"
import { prisma } from "./db"

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
})
