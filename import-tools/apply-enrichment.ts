// Phase B-2 — AI 보강 결과를 업무 카드에 반영한다.
//
//   npx tsx import-tools/apply-enrichment.ts [--dry]
//
// 서브에이전트가 세션 대화를 읽고 뽑은 체크리스트·마감일·완료 여부를 얹는다.
// 규칙만으로는 알 수 없던 것들이다.
//
// 멱등: 같은 세션을 다시 반영해도 체크리스트가 쌓이지 않는다(교체).
import { readdirSync, readFileSync } from "fs"
import { prisma, taskSourceId, parseKst } from "./kakao-common"

const DRY = process.argv.includes("--dry")
const OUT_DIR = `${process.env.HOME}/omnis-import/enrich/out`

interface Enriched {
  id: string
  checklist?: string[]
  deadline?: string | null
  status?: "TODO" | "IN_PROGRESS" | "DONE"
  background?: string
  confidence?: "high" | "low"
}

const STATUSES = new Set(["TODO", "IN_PROGRESS", "DONE"])

function load(): Map<string, Enriched> {
  const byId = new Map<string, Enriched>()
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).sort()
  let bad = 0
  for (const f of files) {
    let parsed: unknown
    try {
      // 에이전트가 코드블록으로 감싸는 경우가 있어 벗겨낸다.
      const raw = readFileSync(`${OUT_DIR}/${f}`, "utf8").replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "")
      parsed = JSON.parse(raw)
    } catch {
      console.log(`  ⚠ ${f} 파싱 실패 — 건너뜀`); bad++; continue
    }
    if (!Array.isArray(parsed)) { console.log(`  ⚠ ${f} 배열이 아님 — 건너뜀`); bad++; continue }
    for (const e of parsed as Enriched[]) if (e?.id) byId.set(e.id, e)
  }
  console.log(`  파일 ${files.length}개 · 파싱 실패 ${bad}개 · 세션 ${byId.size}건`)
  return byId
}

/** 마감일이 세션 시각과 터무니없이 떨어져 있으면 버린다 (환산 오류 방어). */
function sensibleDeadline(iso: string | null | undefined, start: Date): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return null
  const days = (d.getTime() - start.getTime()) / 86400000
  return days >= -3 && days <= 180 ? d : null
}

async function main() {
  const enriched = load()
  const tasks = await prisma.task.findMany({
    where: { sourceId: { startsWith: "kakao-session:" } },
    select: { id: true, sourceId: true, createdAt: true, name: true },
  })
  console.log(`이식된 업무 ${tasks.length}개`)

  const stats = { matched: 0, missing: 0, status: { TODO: 0, IN_PROGRESS: 0, DONE: 0 }, deadline: 0, checklist: 0, lowConf: 0, droppedDeadline: 0 }

  for (const t of tasks) {
    const sessionId = t.sourceId!.slice("kakao-session:".length)
    const e = enriched.get(sessionId)
    if (!e) { stats.missing++; continue }
    stats.matched++

    const status = e.status && STATUSES.has(e.status) ? e.status : "TODO"
    stats.status[status]++
    const deadline = sensibleDeadline(e.deadline, t.createdAt)
    if (e.deadline && !deadline) stats.droppedDeadline++
    if (deadline) stats.deadline++
    const items = (e.checklist ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    if (items.length) stats.checklist++
    if (e.confidence === "low") stats.lowConf++

    if (DRY) continue

    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: t.id },
        data: {
          status,
          deadline,
          ...(e.background?.trim() ? { background: e.background.trim().slice(0, 2000) } : {}),
        },
      })
      // 체크리스트는 교체한다. 다시 돌려도 쌓이지 않게.
      await tx.checklist.deleteMany({ where: { taskId: t.id } })
      if (items.length) {
        await tx.checklist.createMany({
          data: items.map((name) => ({
            name,
            taskId: t.id,
            // 완료된 업무는 체크리스트도 완료로 본다 — 화면의 진행률이 상태와 어긋나지 않게.
            done: status === "DONE",
          })),
        })
      }
    })
  }

  console.log(`  매칭 ${stats.matched} · 보강 결과 없음 ${stats.missing}`)
  console.log(`  상태  TODO ${stats.status.TODO} · 진행중 ${stats.status.IN_PROGRESS} · 완료 ${stats.status.DONE}`)
  console.log(`  마감일 ${stats.deadline}건 (범위 밖이라 버린 것 ${stats.droppedDeadline}건)`)
  console.log(`  체크리스트 있는 업무 ${stats.checklist}건 · 판정 불확실 ${stats.lowConf}건`)
  if (DRY) { console.log("\n--dry — 쓰지 않았음"); await prisma.$disconnect(); return }

  // updatedAt 이 방금 시각으로 덮이므로 다시 교정한다.
  const fixed = await prisma.$executeRaw`
    UPDATE "Task" SET "updatedAt" = "createdAt" WHERE "sourceId" LIKE 'kakao-session:%'`
  console.log(`  updatedAt 재교정 ${fixed}건`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error("실패:", e); await prisma.$disconnect(); process.exit(1) })
