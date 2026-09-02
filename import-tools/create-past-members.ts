// 과거 구성원 계정 생성.
//
// 카톡 이력에는 지금 재직하지 않는 인턴 3명의 발화가 1,432건 있다.
// ChatMessage.authorId 와 Task.ownerId 는 User 를 가리키는 필수 외래키라,
// 계정이 없으면 이 이력을 아예 넣을 수 없다.
//
// isActive: false 로 만든다 — lib/auth.ts 의 authorize 가 isActive 를 확인하므로
// 로그인은 불가능하고, 이력의 주인으로만 남는다.
// 멱등: 이름 기준 upsert 라 여러 번 돌려도 결과가 같다.
import { randomBytes } from "crypto"
import { hashSync } from "bcryptjs"
import { PrismaClient } from "../generated/prisma"

const prisma = new PrismaClient()

const PAST_MEMBERS = [
  { name: "박소정", position: "인턴", department: null },
  { name: "주용석", position: "인턴", department: null },
  { name: "주진호", position: "인턴", department: null },
]

async function main() {
  for (const m of PAST_MEMBERS) {
    // 로그인 불가 계정이지만 passwordHash 가 필수라 추측 불가능한 값을 넣는다.
    const passwordHash = hashSync(randomBytes(32).toString("hex"), 10)
    const user = await prisma.user.upsert({
      where: { name: m.name },
      update: { position: m.position, department: m.department, isActive: false },
      create: {
        name: m.name,
        position: m.position,
        department: m.department,
        role: "MEMBER",
        isActive: false,
        passwordHash,
      },
      select: { id: true, name: true, position: true, isActive: true },
    })
    console.log(`  ${user.name}  ${user.position}  활성=${user.isActive ? "Y" : "N"}  ${user.id}`)
  }

  const total = await prisma.user.count()
  const active = await prisma.user.count({ where: { isActive: true } })
  console.log(`\n  전체 ${total}명 (활성 ${active} · 비활성 ${total - active})`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
