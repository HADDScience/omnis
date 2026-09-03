// 프로젝트를 NAS 과제 폴더에서 세운다.
//
//   npx tsx import-tools/seed-projects-from-nas.ts
//
// 이 회사에서 프로젝트는 과제 단위다(사용자 확인). 채팅에서 이름을 추출해 만들면
// "AI 과제" "기사 작성" 처럼 세션 주제 수준으로 흩어지므로, 실제 과제 목록을
// 기준으로 먼저 세우고 구조화가 여기에 붙게 한다.
//
// 멱등: 이름 기준 upsert.
import { readFileSync } from "fs"
import { prisma, normalizeProjectName , DATA_DIR } from "./kakao-common"

interface NasProject { name: string; kind: string; year: number; done: boolean }

async function main() {
  const rows: NasProject[] = JSON.parse(
    readFileSync(`${DATA_DIR}/nas-projects.json`, "utf8"),
  )

  // 이름 정리 규칙이 바뀌면 기존 이름도 갱신해야 한다("20250527 IR 피치덱" → "IR 피치덱").
  // 업무가 붙지 않은 프로젝트는 지우고 다시 만든다.
  await prisma.project.deleteMany({ where: { tasks: { none: {} } } })

  const existing = await prisma.project.findMany({ select: { id: true, name: true } })
  const byNorm = new Map(existing.map((p) => [normalizeProjectName(p.name), p.id]))

  let created = 0, skipped = 0
  for (const r of rows) {
    const norm = normalizeProjectName(r.name)
    if (byNorm.has(norm)) { skipped++; continue }
    const p = await prisma.project.create({
      data: {
        name: r.name.slice(0, 120),
        status: r.done ? "완료" : "진행 중",
        // 과제 구분을 목적에 적어 둔다. 구조화가 프로젝트를 고를 때 단서가 된다.
        purpose: `${r.year}년 ${r.kind}`,
      },
      select: { id: true },
    })
    byNorm.set(norm, p.id)
    created++
  }
  console.log(`  새로 만든 프로젝트 ${created}개 · 이미 있던 것 ${skipped}개`)
  console.log(`  전체 ${await prisma.project.count({ where: { archived: false } })}개`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
