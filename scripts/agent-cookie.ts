// 로컬 확인용 — 로컬 NEXTAUTH_SECRET 으로 세션 쿠키를 만든다(1·2단계 verify-omnis-room-http.ts 와 같은 방식). 이름을 받는다
import { encode } from "next-auth/jwt"
import { prisma } from "@/lib/db"

const name = process.argv[2] ?? "정우창"
const u = await prisma.user.findFirst({ where: { name, isActive: true }, select: { id: true, name: true, role: true } })
if (!u) throw new Error(`없는 사용자: ${name}`)
const token = await encode({
  token: { sub: u.id, id: u.id, role: u.role, name: u.name },
  secret: process.env.NEXTAUTH_SECRET!,
  salt: "authjs.session-token",
  maxAge: 8 * 3600,
})
console.log(token)
await prisma.$disconnect()
