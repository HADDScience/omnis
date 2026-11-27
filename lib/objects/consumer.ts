// 공통 층 소비기(P4) — ObjectChange(트리거가 남긴 변경)를 값 이력과 색인으로 옮긴다. 하루 한 번 daily cron 끝에 돈다.
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §6-2
//
// - 같은 행의 변경은 묶어 마지막 상태로 색인을 한 번만 만든다. 내용 해시가 같으면 Gemini 를 부르지 않는다.
// - 바뀐 칸마다 ObjectRevision(authorKind = 트리거가 읽은 쓴 쪽: screen · source …)을 남긴다. 같은 changeId 로 이미
//   남긴 것은 건너뛴다(다시 돌려도 겹치지 않는다. P10 의 run_action 이 먼저 남긴 것도 건너뛴다).
// - 값 이력과 processedAt 을 먼저 한 트랜잭션으로 확정하고, 색인은 그 뒤에 만든다. 색인(임베딩)이 실패해도 이력은 남고,
//   그 변경에는 lastError 만 적는다 — 매일 대조(reconcileObjectIndex)가 색인을 다시 맞춘다. 임베딩이 멈춰도 outbox 가 막히지 않는다.
// - 이력 · 처리 표시가 실패한 묶음만 attempts 를 올린다. 5번 실패한 것은 더 집지 않는다.
// - 임베딩 함수는 인자로 바꿀 수 있다(기본은 lib/ai embedTexts). 확인 스크립트가 Gemini 없이 돌 때만 바꾼다.
// - 검색 직전 처리(최대 50건 · 2초)는 OBJECT 조각을 읽는 일반 검색(P5)과 함께 붙인다 — 지금은 읽는 곳이 없어 지연만 는다.
// 기존 원천(TASK · OMNIS_CARD …)의 색인 경로(lib/embeddings.ts)는 건드리지 않는다.
import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"
import { embedTexts } from "@/lib/ai"
import { Prisma } from "@/generated/prisma/client"
import { indexTextOf, objectSourceId, revisionsOf, visibilityOf, type ChangeRow } from "./change"
import type { TypeDef } from "./define"
import { OBJECT_TYPES, OPTION_SET_MAP } from "./index"
import { backingModel } from "./backing"
import type { AuthorKind } from "./records"

export const MAX_ATTEMPTS = 5
const EMBED_BATCH = 100

const byBacking = new Map(OBJECT_TYPES.map((t) => [t.backing!, t]))

/** Prisma 모델 이름 → 위임 객체(CompanyRecord → prisma.companyRecord) */
function delegateOf(def: TypeDef): { findUnique: (a: { where: { id: string } }) => Promise<Record<string, unknown> | null>; findMany: () => Promise<Record<string, unknown>[]> } {
  const model = backingModel(def.backing!)
  if (!model) throw new Error(`${def.key}: Prisma 밖 표는 아직 소비하지 않는다`)
  const name = model[0].toLowerCase() + model.slice(1)
  return (prisma as unknown as Record<string, ReturnType<typeof delegateOf>>)[name]
}

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex")

/** 문서 임베딩 함수 — 텍스트 배열 → 벡터 배열(768) */
export type EmbedFn = (texts: string[]) => Promise<number[][]>
const geminiEmbed: EmbedFn = (texts) => embedTexts(texts, "RETRIEVAL_DOCUMENT")
const toVector = (v: number[]) => `[${v.join(",")}]`

interface Want {
  def: TypeDef
  id: string
  title: string
  content: string
  hash: string
  visibility: string[]
}

/** 한 행의 바라는 색인. 행이 없으면 null(조각을 지운다) */
function wantFor(def: TypeDef, row: Record<string, unknown>): Want {
  const { title, content } = indexTextOf(def, row, OPTION_SET_MAP)
  return { def, id: String(row.id), title, content, hash: hashOf(`${title}\n${content}`), visibility: visibilityOf(def, row) }
}

/** 해시가 다른 것만 임베딩해 OBJECT 조각으로 넣는다. 공개 범위 · 유형 키 칸도 함께 맞춘다 */
async function writeChunks(wants: Want[], embed: EmbedFn): Promise<{ embedded: number; unchanged: number }> {
  if (!wants.length) return { embedded: 0, unchanged: 0 }
  const ids = wants.map((w) => objectSourceId(w.def.key, w.id))
  const existing = await prisma.embeddingChunk.findMany({
    where: { source: "OBJECT", sourceId: { in: ids }, chunkIndex: 0 },
    select: { sourceId: true, contentHash: true, visibility: true },
  })
  const have = new Map(existing.map((e) => [e.sourceId, e]))
  const stale: Want[] = []
  let unchanged = 0
  for (const w of wants) {
    const h = have.get(objectSourceId(w.def.key, w.id))
    if (h && h.contentHash === w.hash) {
      unchanged++
      if (h.visibility.join() !== w.visibility.join())
        await prisma.embeddingChunk.updateMany({ where: { source: "OBJECT", sourceId: objectSourceId(w.def.key, w.id) }, data: { visibility: w.visibility } })
      continue
    }
    stale.push(w)
  }
  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH)
    const vectors = await embed(batch.map((w) => `${w.title}\n${w.content}`))
    for (let k = 0; k < batch.length; k++) {
      const w = batch[k]
      await prisma.$executeRaw`
        INSERT INTO "EmbeddingChunk"
          ("id", "source", "sourceId", "chunkIndex", "title", "content", "contentHash", "embedding", "typeKey", "visibility", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), 'OBJECT'::"EmbeddingSource", ${objectSourceId(w.def.key, w.id)}, 0, ${w.title}, ${w.content}, ${w.hash},
           ${toVector(vectors[k])}::vector, ${w.def.key}, ${w.visibility}::text[], NOW(), NOW())
        ON CONFLICT ("source", "sourceId", "chunkIndex")
        DO UPDATE SET "title" = EXCLUDED."title", "content" = EXCLUDED."content", "contentHash" = EXCLUDED."contentHash",
          "embedding" = EXCLUDED."embedding", "typeKey" = EXCLUDED."typeKey", "visibility" = EXCLUDED."visibility", "updatedAt" = NOW()
      `
    }
  }
  return { embedded: stale.length, unchanged }
}

export interface ConsumeResult {
  picked: number
  processed: number
  failed: number
  /** 이력은 남겼지만 색인을 못 만든 변경(대조가 다시 맞춘다) */
  indexFailed: number
  revisions: number
  embedded: number
  unchanged: number
  removed: number
  stoppedByBudget: boolean
}

/** 처리 안 된 변경을 id 순으로 집어 처리한다. limit 건 · budgetMs 안에서 멈춘다 */
export async function processObjectChanges(opts: { limit?: number; budgetMs?: number; embed?: EmbedFn } = {}): Promise<ConsumeResult> {
  const started = Date.now()
  const limit = opts.limit ?? 2000
  const budget = opts.budgetMs ?? 60_000
  const embed = opts.embed ?? geminiEmbed
  const res: ConsumeResult = { picked: 0, processed: 0, failed: 0, indexFailed: 0, revisions: 0, embedded: 0, unchanged: 0, removed: 0, stoppedByBudget: false }

  const changes = await prisma.objectChange.findMany({
    where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { id: "asc" },
    take: limit,
  })
  res.picked = changes.length
  if (!changes.length) return res

  const versions = new Map((await prisma.objectType.findMany({ select: { key: true, version: true } })).map((t) => [t.key, t.version]))
  const groups = new Map<string, typeof changes>()
  for (const c of changes) {
    const k = `${c.tableName}\u0000${c.rowId}`
    groups.set(k, [...(groups.get(k) ?? []), c])
  }

  for (const group of groups.values()) {
    if (Date.now() - started > budget) {
      res.stoppedByBudget = true
      break
    }
    const ids = group.map((c) => c.id)
    try {
      const def = byBacking.get(group[0].tableName)
      if (!def) throw new Error(`등록 유형이 없는 표: ${group[0].tableName}`)
      const version = versions.get(def.key)
      if (!version) throw new Error(`정의 표에 ${def.key} 가 없다 — objects:sync 가 먼저다`)
      const rowId = group[0].rowId

      // 값 이력 — 같은 changeId 로 이미 남긴 것은 건너뛴다
      const done = new Set(
        (await prisma.objectRevision.findMany({ where: { changeId: { in: ids } }, select: { changeId: true } })).map((r) => String(r.changeId))
      )
      const drafts = group
        .filter((c) => !done.has(String(c.id)))
        .flatMap((c) =>
          revisionsOf(def, rowId, {
            id: c.id,
            op: c.op as ChangeRow["op"],
            changedCols: c.changedCols,
            oldValues: (c.oldValues ?? null) as Record<string, unknown> | null,
            newValues: (c.newValues ?? null) as Record<string, unknown> | null,
            actorKind: c.actorKind as AuthorKind,
          }, version, OPTION_SET_MAP)
        )
      const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue))

      // 1) 이력 + 처리 표시 — 한 트랜잭션
      await prisma.$transaction(async (tx) => {
        if (drafts.length)
          await tx.objectRevision.createMany({
            data: drafts.map((d) => ({ ...d, value: json(d.value), prevValue: json(d.prevValue) })),
          })
        await tx.objectChange.updateMany({ where: { id: { in: ids } }, data: { processedAt: new Date(), lastError: null } })
      }, { timeout: 30_000 })
      res.revisions += drafts.length
      res.processed += group.length

      // 2) 색인 — 마지막 상태 하나로. 실패해도 이력은 남는다(lastError 만)
      try {
        const row = await delegateOf(def).findUnique({ where: { id: rowId } })
        if (row) {
          const w = await writeChunks([wantFor(def, row)], embed)
          res.embedded += w.embedded
          res.unchanged += w.unchanged
        } else {
          const { count } = await prisma.embeddingChunk.deleteMany({ where: { source: "OBJECT", sourceId: objectSourceId(def.key, rowId) } })
          res.removed += count
        }
      } catch (e) {
        res.indexFailed += group.length
        await prisma.objectChange.updateMany({
          where: { id: { in: ids } },
          data: { lastError: `색인 실패(대조가 다시 맞춘다): ${String((e as Error).message ?? e).slice(0, 400)}` },
        })
        console.error("[objects] 색인 실패", group[0].tableName, rowId, (e as Error).message)
      }
    } catch (e) {
      res.failed += group.length
      await prisma.objectChange.updateMany({
        where: { id: { in: ids } },
        data: { attempts: { increment: 1 }, lastError: String((e as Error).message ?? e).slice(0, 500) },
      })
      console.error("[objects] 변경 처리 실패", group[0].tableName, group[0].rowId, e)
    }
  }
  return res
}

/**
 * 매일 대조 — 등록 유형의 지금 행과 OBJECT 조각을 맞춘다. 트리거를 걸기 전 행 · 트리거가 놓친 행을 여기서 잡는다.
 * 해시가 다른 행만 임베딩하고, 행이 사라진 조각은 지운다. 처음 한 번은 등록 유형 행 전부를 임베딩한다.
 */
export async function reconcileObjectIndex(embed: EmbedFn = geminiEmbed): Promise<{ rows: number; embedded: number; unchanged: number; removed: number }> {
  let rows = 0, embedded = 0, unchanged = 0, removed = 0
  for (const def of OBJECT_TYPES) {
    const all = await delegateOf(def).findMany()
    rows += all.length
    const w = await writeChunks(all.map((r) => wantFor(def, r)), embed)
    embedded += w.embedded
    unchanged += w.unchanged
    const live = new Set(all.map((r) => objectSourceId(def.key, String(r.id))))
    const chunks = await prisma.embeddingChunk.findMany({ where: { source: "OBJECT", typeKey: def.key }, select: { sourceId: true } })
    const gone = chunks.map((c) => c.sourceId).filter((s) => !live.has(s))
    if (gone.length) removed += (await prisma.embeddingChunk.deleteMany({ where: { source: "OBJECT", sourceId: { in: gone } } })).count
  }
  return { rows, embedded, unchanged, removed }
}

/** daily cron 에서 부른다 — 변경 처리 다음 대조 */
export async function runObjectUpkeep() {
  const changes = await processObjectChanges({ limit: 5000, budgetMs: 120_000 })
  const reconcile = await reconcileObjectIndex()
  const stuck = await prisma.objectChange.count({ where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } } })
  return { changes, reconcile, stuck }
}
