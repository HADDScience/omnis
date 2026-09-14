/**
 * 카톡 이식 업무를 일괄 완료 처리한다.
 *
 * 카톡에서는 "완료했습니다" 를 명시하지 않는 경우가 많아 이식된 업무 대부분이 TODO/IN_PROGRESS 로 남았다.
 * 작업지시자가 훑어보고 "이미 다 끝난 일" 이라고 판단한 것을 반영한다(2026-09-08).
 *
 * 앱의 완료 처리(PATCH /api/tasks · 알림 「완료로 표시」)와 같은 일을 한다:
 * status=DONE · workEnd · 체크리스트 전부 done · 떠 있는 완료 확인 알림 정리 · 활동 기록 · 색인 갱신.
 * workEnd 는 지금이 아니라 그 업무의 마지막 대화 시각으로 둔다 — 실제로 끝난 때에 가깝다.
 *
 *   npx tsx scripts/backfill-done.ts --target prod --except slug1,slug2 [--dry]
 *   npx tsx scripts/backfill-done.ts --target prod --slugs a,b,c               (지정한 것만)
 *   npx tsx scripts/backfill-done.ts --target prod --rollback <backup.json>    (되돌리기)
 *
 * 되돌릴 수 있게 바꾸기 전 상태를 $KAKAO_DATA_DIR/backfill/done-<시각>.json 에 남긴다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

const args = process.argv.slice(2)
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const has = (k: string) => args.includes(k)
const list = (k: string) => flag(k)?.split(",").map((s) => s.trim()).filter(Boolean)

const target = flag("--target") ?? "local"
const dry = has("--dry")
const only = list("--slugs")
const except = list("--except") ?? []
const rollback = flag("--rollback")
const actorName = flag("--as") ?? "정우창"
const DATA_DIR = process.env.KAKAO_DATA_DIR ?? path.join(process.env.HOME ?? "", "work/omnis-import")

if (target === "prod") {
  const envFile = ".env.production.local"
  if (!existsSync(envFile)) throw new Error(`${envFile} 없음`)
  const env = Object.fromEntries(
    readFileSync(envFile, "utf-8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] }),
  )
  if (!env.POSTGRES_URL_NON_POOLING?.includes("neon.tech")) throw new Error("프로덕션 DB 주소가 아니다")
  process.env.DATABASE_URL = env.POSTGRES_URL_NON_POOLING
  if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
}

const { prisma } = await import("../lib/db")
const { syncEmbeddingsBatch } = await import("../lib/embeddings")
const { writeActivity } = await import("../lib/api")

type Backup = { id: string; slug: string; name: string; status: string; workEnd: string | null; undoneChecklistIds: string[] }

async function main() {
  const actor = await prisma.user.findUnique({ where: { name: actorName }, select: { id: true } })
  if (!actor) throw new Error(`사용자 없음: ${actorName}`)

  if (rollback) {
    const rows: Backup[] = JSON.parse(readFileSync(rollback, "utf-8"))
    console.log(`되돌리기 ${rows.length}건 (${target})${dry ? " — dry" : ""}`)
    for (const r of rows) {
      if (dry) continue
      await prisma.$transaction([
        prisma.task.update({ where: { id: r.id }, data: { status: r.status as never, workEnd: r.workEnd ? new Date(r.workEnd) : null } }),
        prisma.checklist.updateMany({ where: { id: { in: r.undoneChecklistIds } }, data: { done: false } }),
      ])
    }
    if (!dry) await syncEmbeddingsBatch("TASK", rows.map((r) => r.id), { userId: actor.id })
    console.log("done")
    return
  }

  const candidates = await prisma.task.findMany({
    where: { status: { not: "DONE" }, ...(only ? { slug: { in: only } } : {}) },
    select: {
      id: true, slug: true, name: true, status: true, workEnd: true, createdAt: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      checklists: { where: { done: false }, select: { id: true } },
    },
  })
  const picked = candidates.filter((t) => !except.includes(t.slug))
  const held = candidates.filter((t) => except.includes(t.slug))
  console.log(`대상 ${picked.length}건 · 보류 ${held.length}건 (${target}${dry ? ", dry" : ""})`)
  for (const h of held) console.log("  보류:", h.name, `#${h.slug}`)
  const unknown = except.filter((s) => !candidates.some((t) => t.slug === s))
  if (unknown.length) console.log("  --except 에 있으나 미완료 목록에 없음:", unknown.join(", "))
  if (dry || picked.length === 0) return

  const backup: Backup[] = picked.map((t) => ({
    id: t.id, slug: t.slug, name: t.name, status: t.status, workEnd: t.workEnd?.toISOString() ?? null,
    undoneChecklistIds: t.checklists.map((c) => c.id),
  }))
  const dir = path.join(DATA_DIR, "backfill")
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)
  const backupFile = path.join(dir, `done-${target}-${stamp}.json`)
  writeFileSync(backupFile, JSON.stringify(backup, null, 2))
  console.log("이전 상태 저장:", backupFile)

  let n = 0
  for (const t of picked) {
    const last = t.messages[0]?.createdAt ?? t.createdAt
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { status: "DONE", workEnd: last } }),
      prisma.checklist.updateMany({ where: { taskId: t.id, done: false }, data: { done: true } }),
      prisma.notification.updateMany({ where: { entityId: t.id, actionType: "confirm_done", resolvedAt: null }, data: { resolvedAt: new Date() } }),
    ])
    await writeActivity({
      userId: actor.id, action: "task.updated", entity: "TASK", entityId: t.id,
      title: `업무 수정: ${t.name}`,
      metadata: { status: "DONE", backfill: "kakao-done-20260908", previous: t.status },
    })
    n++
    if (n % 50 === 0) console.log(`  ${n}/${picked.length}`)
  }
  console.log(`완료 처리 ${n}건 · 색인 갱신 중`)
  const r = await syncEmbeddingsBatch("TASK", picked.map((t) => t.id), { userId: actor.id, onProgress: (d, tot) => { if (d % 100 === 0) console.log(`  색인 ${d}/${tot}`) } })
  console.log("색인:", r)
}

await main().finally(() => prisma.$disconnect())
