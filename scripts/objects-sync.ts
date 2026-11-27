/**
 * 공통 층 유형 정의(코드 정본, lib/objects)를 DB 정의 표 5개로 옮긴다 — P2.
 *
 *   pnpm run objects:sync               # 건식: 바꿀 것만 센다. 쓰지 않는다
 *   pnpm run objects:sync -- --apply    # 한 트랜잭션으로 쓴다
 *
 * 멱등이다 — 두 번째 실행은 「바꿀 것 없음」 이어야 한다. 계획은 lib/objects/sync.ts(시험: sync.test.ts).
 * 운영(Neon)을 가리키면 --prod 를 함께 줘야 쓴다. 운영 실행은 작업지시자 승인 뒤, 배포 절차에서 db:deploy 다음에.
 * 계획: mydocs/plans/2026-11-27-ontology-phase1.md
 */
import "dotenv/config"
import { prisma } from "@/lib/db"
import { checkOptionSet, checkTypeDef } from "@/lib/objects/define"
import { OBJECT_TYPES, OPTION_SET_MAP, PLANNED_TYPES } from "@/lib/objects/index"
import { OPTION_SETS } from "@/lib/objects/options"
import { planSync, summarizeOps, type DbState, type Json, type SyncOp } from "@/lib/objects/sync"
import { TOOL_POLICY } from "@/lib/tools/registry"
import { Prisma } from "@/generated/prisma/client"

const APPLY = process.argv.includes("--apply")
const PROD_OK = process.argv.includes("--prod")

function target(): { host: string; db: string; prod: boolean } {
  const url = process.env.DATABASE_URL ?? ""
  const m = /@([^/:?]+)(?::\d+)?\/([^?]+)/.exec(url)
  const host = m?.[1] ?? "(알 수 없음)"
  return { host, db: m?.[2] ?? "", prod: host.endsWith("neon.tech") }
}

const confirmOf = (tool: string): string | null => {
  const p = (TOOL_POLICY as Record<string, { confirm?: string }>)[tool]
  return p?.confirm ?? null
}

async function readState(): Promise<DbState> {
  const [types, fields, options, actions, versions] = await Promise.all([
    prisma.objectType.findMany(),
    prisma.objectField.findMany(),
    prisma.optionValue.findMany(),
    prisma.actionType.findMany(),
    prisma.objectTypeVersion.findMany({ orderBy: { version: "desc" } }),
  ])
  const latest = new Map<string, (typeof versions)[number]>()
  for (const v of versions) if (!latest.has(v.typeKey)) latest.set(v.typeKey, v)
  return {
    types: types.map((t) => ({ ...t, examples: t.examples as Json, autoApply: (t.autoApply ?? null) as Json, links: t.links as Json })),
    fields: fields.map((f) => ({ ...f, fileRule: (f.fileRule ?? null) as Json })),
    options,
    actions,
    latestVersions: [...latest.values()].map((v) => ({ ...v, definition: v.definition as Json })),
  }
}

/** Json 칸 값 — null 은 SQL NULL(Prisma.DbNull) */
const j = (v: Json) => (v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue))

async function apply(tx: Prisma.TransactionClient, op: SyncOp) {
  switch (op.table) {
    case "ObjectType": {
      if (op.op === "create") {
        const d = op.data
        return tx.objectType.create({ data: { ...d, examples: d.examples as Prisma.InputJsonValue, autoApply: j(d.autoApply), links: d.links as Prisma.InputJsonValue } })
      }
      const { examples, autoApply, links, ...rest } = op.data
      return tx.objectType.update({
        where: { key: op.key },
        data: {
          ...rest,
          ...(examples !== undefined && { examples: examples as Prisma.InputJsonValue }),
          ...(autoApply !== undefined && { autoApply: j(autoApply) }),
          ...(links !== undefined && { links: links as Prisma.InputJsonValue }),
        },
      })
    }
    case "ObjectTypeVersion":
      return tx.objectTypeVersion.create({ data: { ...op.data, definition: op.data.definition as Prisma.InputJsonValue } })
    case "ObjectField": {
      const { fileRule, ...rest } = op.data
      const fr = fileRule === undefined ? {} : { fileRule: j(fileRule) }
      if (op.op === "create") return tx.objectField.create({ data: { ...(rest as Required<typeof rest>), ...fr } })
      return tx.objectField.update({ where: { typeKey_key: { typeKey: op.typeKey, key: op.key } }, data: { ...rest, ...fr } })
    }
    case "OptionValue":
      if (op.op === "create") return tx.optionValue.create({ data: op.data })
      return tx.optionValue.update({ where: { setKey_key: { setKey: op.setKey, key: op.key } }, data: op.data })
    case "ActionType":
      if (op.op === "create") return tx.actionType.create({ data: op.data })
      return tx.actionType.update({ where: { typeKey_key: { typeKey: op.typeKey, key: op.key } }, data: op.data })
  }
}

async function main() {
  const t = target()
  console.log(`대상 DB: ${t.host} / ${t.db}${t.prod ? " (운영)" : ""} · ${APPLY ? "쓰기" : "건식"}`)
  if (APPLY && t.prod && !PROD_OK) {
    console.error("운영(Neon)이다. 작업지시자 승인 뒤 --prod 를 함께 줘야 쓴다. 중단.")
    process.exit(1)
  }

  // 정의 검사가 먼저다 — 틀린 정의는 표에 넣지 않는다
  const typeKeys = new Set([...OBJECT_TYPES.map((d) => d.key), ...Object.keys(PLANNED_TYPES)])
  const defErrs = [
    ...OPTION_SETS.flatMap(checkOptionSet),
    ...OBJECT_TYPES.flatMap((d) => checkTypeDef(d, { optionSets: OPTION_SET_MAP, typeKeys })),
  ]
  if (defErrs.length) {
    console.error("정의 오류 — 아무것도 쓰지 않았다:\n" + defErrs.map((e) => `  ${e}`).join("\n"))
    process.exit(1)
  }

  const plan = planSync({ types: OBJECT_TYPES, optionSets: OPTION_SETS, db: await readState(), confirmOf, now: new Date() })
  if (plan.errors.length) {
    console.error("바꿀 수 없는 칸이 바뀌었다 — 아무것도 쓰지 않았다:\n" + plan.errors.map((e) => `  ${e}`).join("\n"))
    process.exit(1)
  }
  console.log(`바꿀 것 ${plan.ops.length}건 — ${summarizeOps(plan.ops)}`)
  for (const op of plan.ops)
    if (op.table === "ObjectTypeVersion") console.log(`  ${op.data.typeKey} v${op.data.version}${op.data.breaking ? " (깨지는 변경)" : ""} — ${op.data.summary}`)
    else if (op.op === "update") console.log(`  ${op.table} ${"key" in op ? op.key : ""} ${"typeKey" in op ? op.typeKey + "." : ""}: ${Object.keys(op.data).join(", ")}`)

  if (!APPLY || !plan.ops.length) return
  // 한 건씩 차례로 보낸다 — 운영(Neon)은 왕복이 있어 기본 timeout 5초를 넘긴다(2026-11-27 첫 운영 실행이 82건 중
  // 칸을 쓰다 P2028 로 되돌려졌다). 첫 등록 82건 × 왕복을 넉넉히 받게 60초를 준다
  await prisma.$transaction(
    async (tx) => {
      for (const op of plan.ops) await apply(tx, op)
    },
    { timeout: 60_000, maxWait: 10_000 }
  )
  const after = await readState()
  console.log(`썼다 — 유형 ${after.types.length} · 칸 ${after.fields.length} · 선택지 ${after.options.length} · Action ${after.actions.length} · 버전 ${after.latestVersions.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
