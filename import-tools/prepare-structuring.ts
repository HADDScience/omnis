// 순차 구조화 — 라운드 하나치 입력을 만든다.
//
//   npx tsx import-tools/prepare-structuring.ts <라운드번호>
//
// lib/ai.ts 의 structureTask 와 같은 계약을 쓴다. 다른 점은 호출 주체(Gemini → Claude)와
// **순차성**이다. N 라운드는 1..N-1 이 만든 프로젝트·업무를 모두 보고 판단한다.
// 그래야 3월에 생긴 프로젝트에 5월 업무가 붙는다 — 지금처럼 이름만 다른 프로젝트가
// 47개로 흩어지지 않는다.
import { writeFileSync, readFileSync, existsSync } from "fs"
import { prisma, loadSessions, loadClassified, ROOMS, SPEAKER_TO_USER , DATA_DIR } from "./kakao-common"

const ROUND = Number(process.argv[2] || 1)
const SIZE = 40
const DIR = `${DATA_DIR}/structure`

async function main() {
  const classified = loadClassified()
  const targets = loadSessions()
    .filter((s) => {
      const c = classified.get(s.id)
      return ROOMS[s.room] && c?.label === "업무" && c.actionable === true
    })
    .sort((a, b) => a.start.localeCompare(b.start))

  const chunk = targets.slice((ROUND - 1) * SIZE, ROUND * SIZE)
  if (chunk.length === 0) { console.log("남은 세션 없음"); await prisma.$disconnect(); return }

  const [projects, products, members, omnisCards] = await Promise.all([
    prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, product: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.omnisCard.findMany({ select: { title: true, category: { select: { name: true } } }, take: 60 }),
  ])

  // 앞 라운드까지 만들어진 업무. 이어지는 업무인지, 새 업무인지 판단하는 근거다.
  const priorTasks = await prisma.task.findMany({
    where: { sourceId: { startsWith: "kakao-task:" } },
    select: { name: true, createdAt: true, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 80,
  })

  const payload = {
    round: ROUND,
    totalRounds: Math.ceil(targets.length / SIZE),
    context: {
      projects: projects.map((p) => ({ id: p.id, name: p.name, productName: p.product?.name ?? null })),
      products,
      members: members.map((m) => m.name),
      omnisCards: omnisCards.map((c) => `[${c.category.name}] ${c.title}`),
      priorTasks: priorTasks.map((t) => ({
        name: t.name,
        project: t.project?.name ?? null,
        date: t.createdAt.toISOString().slice(0, 10),
      })),
    },
    sessions: chunk.map((s) => ({
      id: s.id,
      start: s.start,
      messages: s.msgs.map((m) => ({ t: m.t.slice(5, 16), u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
    })),
  }

  writeFileSync(`${DIR}/in/round${String(ROUND).padStart(2, "0")}.json`, JSON.stringify(payload, null, 1))
  console.log(`라운드 ${ROUND}/${payload.totalRounds} · 세션 ${chunk.length}개 (${chunk[0].start.slice(0,10)} ~ ${chunk[chunk.length-1].start.slice(0,10)})`)
  console.log(`  맥락: 프로젝트 ${projects.length} · 제품 ${products.length} · 팀원 ${members.length} · 옴니스카드 ${omnisCards.length} · 앞선 업무 ${priorTasks.length}`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
