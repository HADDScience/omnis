import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"

/**
 * /lab/ab 의 문지기 — 페이지와 API 가 같이 쓴다.
 * 로컬 `next dev` 이고 로그인한 ADMIN 일 때만 Caller 를 준다. 그 밖에는 null → 404.
 * `next start` 는 운영 DB 에 붙으므로(.env.production.local) NODE_ENV 로 먼저 막는다.
 * 세션의 role 만 믿지 않고 DB 에서 다시 본다 — 권한을 내린 뒤에도 옛 세션이 남아 있을 수 있다.
 */
export async function labAdmin(): Promise<Caller | null> {
  if (process.env.NODE_ENV !== "development") return null
  const session = await auth()
  const id = session?.user?.id
  if (!id || (session.user as { role?: string }).role !== "ADMIN") return null
  const user = await prisma.user.findFirst({ where: { id, isActive: true }, select: { id: true, name: true, role: true } })
  if (!user || user.role !== "ADMIN") return null
  return { userId: user.id, name: user.name, role: "ADMIN", ip: null }
}
