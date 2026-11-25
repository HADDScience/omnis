/**
 * CRM 젤 타입 옮기기 전후 대조(2026-11-25) — 마이그레이션 …_crm_gel_types_data · …_crm_gel_ml_only 가 재고 합을 바꾸지 않았는지 본다.
 *
 *   옮기기 전:  pnpm tsx scripts/crm-gel-types-check.ts --save before.json
 *   옮긴 뒤:    pnpm tsx scripts/crm-gel-types-check.ts --compare before.json   (마크다운 대조표를 찍는다)
 *
 * 읽기만 한다. 대상 DB 는 DATABASE_URL — localhost 가 아니면 멈춘다(--allow-remote 로만 연다. 운영은 읽기 전용 세션으로 돈다).
 * 비교 기준: (타입, 농도) 칸의 총 ml = Σ(규격별 행의 개수 × 한 개 용량). 원료(g) · 젤이 아닌 제품은 그대로여야 한다.
 * 출고 ml 도 본다: 전 = 규격별 행 출고 개수 × 용량, 뒤 = 젤 출고의 volumeMl(개수는 비어 있다).
 * 개수(units)는 2차(11/25)부터 세지 않으므로 비교하지 않는다. 옮기지 못하고 숨긴 젤 행은 따로 찍는다.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { PrismaClient } from "../generated/prisma"

type Snapshot = {
  takenAt: string
  /** "ADDGEL@1" → ml */
  gelMl: Record<string, number>
  /** "ADDGEL@1" → 출고 ml 합(장부와 무관하게 출고 기록에 적힌 양) */
  shipMl: Record<string, number>
  /** 옮기지 못해 숨긴 젤 행(뒤에만) — 코드 · 이름 규격 · 걸린 출고 · 견적 품목 */
  hidden?: { code: string; label: string; shipments: string[]; quoteItems: number }[]
  /** 젤이 아닌 제품 코드 → 재고(개 · g) */
  other: Record<string, number>
  counts: Record<string, number>
}

const args = process.argv.slice(2)
const url = process.env.DATABASE_URL ?? ""
const host = (() => { try { return new URL(url).host } catch { return "?" } })()
if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && !args.includes("--allow-remote")) {
  console.error(`대상 DB 가 로컬이 아닙니다(${host}). 운영을 읽으려면 --allow-remote`)
  process.exit(1)
}
const prisma = new PrismaClient()
const r3 = (n: number) => Math.round(n * 1000) / 1000
const typeOfName = (name: string) => (name.startsWith("애드젤") ? "ADDGEL" : name.startsWith("라이브젤") ? "LIVEGEL" : null)

async function snapshot(): Promise<Snapshot> {
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
  // 칸이 아직 없을 수 있다(옮기기 전) — raw SQL 로 있는 칸만 읽는다
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'CrmProduct' AND column_name = 'gelType'`,
  )
  const migrated = cols.length > 0
  const products = await prisma.$queryRawUnsafe<{ id: string; code: string; name: string; isMaterial: boolean; volumeMl: string | null; concentrationPct: string | null; gelType: string | null }[]>(
    `SELECT id, code, name, "isMaterial", "volumeMl"::text, "concentrationPct"::text, ${migrated ? `"gelType"::text` : "NULL"} AS "gelType" FROM "CrmProduct"`,
  )
  const moves = await prisma.$queryRawUnsafe<{ productId: string; direction: string; quantity: string; concentrationPct: string | null }[]>(
    `SELECT "productId", direction::text, quantity::text, ${migrated ? `"concentrationPct"::text` : `NULL AS "concentrationPct"`} FROM "CrmStockMove"`,
  )
  const ships = await prisma.$queryRawUnsafe<{ code: string; productId: string; quantity: number | null; concentrationPct: string | null; volumeMl: string | null }[]>(
    `SELECT code, "productId", quantity, ${migrated ? `"concentrationPct"::text, "volumeMl"::text` : `NULL AS "concentrationPct", NULL AS "volumeMl"`} FROM "CrmShipment"`,
  )
  const byId = new Map(products.map((p) => [p.id, p]))
  const gelMl: Record<string, number> = {}
  const other: Record<string, number> = {}
  for (const m of moves) {
    const p = byId.get(m.productId)!
    const sign = m.direction === "IN" ? 1 : -1
    const q = Number(m.quantity)
    if (p.gelType) {
      // 옮긴 뒤 — 장부가 이미 ml · 농도
      const key = `${p.gelType}@${Number(m.concentrationPct ?? 0)}`
      gelMl[key] = r3((gelMl[key] ?? 0) + sign * q)
      continue
    }
    const t = typeOfName(p.name)
    if (!p.isMaterial && t && p.volumeMl && p.concentrationPct && Number(p.volumeMl) > 0 && Number(p.concentrationPct) > 0) {
      // 옮기기 전 — 규격별 행의 개수 × 한 개 용량
      const key = `${t}@${Number(p.concentrationPct)}`
      gelMl[key] = r3((gelMl[key] ?? 0) + sign * q * Number(p.volumeMl))
      continue
    }
    other[p.code] = r3((other[p.code] ?? 0) + sign * q)
  }
  const shipMl: Record<string, number> = {}
  for (const x of ships) {
    const p = byId.get(x.productId)!
    if (p.gelType) {
      // 뒤 — 출고 ml 가 volumeMl 에 있다(1차만 돈 상태면 개수 × 한 개 용량)
      const key = `${p.gelType}@${Number(x.concentrationPct ?? 0)}`
      const ml = x.quantity != null && x.volumeMl != null ? x.quantity * Number(x.volumeMl) : Number(x.volumeMl ?? 0)
      shipMl[key] = r3((shipMl[key] ?? 0) + ml)
      continue
    }
    const t = typeOfName(p.name)
    if (!p.isMaterial && t && p.volumeMl && p.concentrationPct && Number(p.volumeMl) > 0 && Number(p.concentrationPct) > 0) {
      const key = `${t}@${Number(p.concentrationPct)}`
      shipMl[key] = r3((shipMl[key] ?? 0) + (x.quantity ?? 0) * Number(p.volumeMl))
    }
  }
  let hidden: Snapshot["hidden"]
  if (migrated) {
    const rows = await prisma.$queryRawUnsafe<{ id: string; code: string; name: string; spec: string | null }[]>(
      `SELECT id, code, name, spec FROM "CrmProduct" WHERE "gelType" IS NULL AND "isMaterial" = false AND "mergedIntoId" IS NULL AND archived = true AND (name LIKE '애드젤%' OR name LIKE '라이브젤%') ORDER BY code`,
    )
    hidden = []
    for (const h of rows) {
      const q = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "CrmQuoteItem" WHERE "productId" = $1`, h.id)
      hidden.push({ code: h.code, label: `${h.name}${h.spec ? ` ${h.spec}` : ""}`, shipments: ships.filter((x) => x.productId === h.id).map((x) => `${x.code}(${x.quantity ?? "-"}개)`), quoteItems: Number(q[0].n) })
    }
  }
  const count = async (t: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n)
  const counts: Record<string, number> = {}
  for (const t of ["CrmProduct", "CrmStockMove", "CrmShipment", "CrmQuoteItem", "CrmSampleRequest", "CrmProduction", "TaxInvoiceItem"]) counts[t] = await count(t)
  return { takenAt: new Date().toISOString(), gelMl, shipMl, other, counts, ...(hidden ? { hidden } : {}) }
}

function compare(a: Snapshot, b: Snapshot): string {
  const out: string[] = []
  const keys = [...new Set([...Object.keys(a.gelMl), ...Object.keys(b.gelMl)])].sort()
  out.push("| 재고 칸 (타입 @ 농도%) | 전 (규격별 개수 × 용량) | 뒤 (ml) | 같음 |", "|---|---:|---:|---|")
  let ok = true
  for (const k of keys) {
    const x = a.gelMl[k] ?? 0
    const y = b.gelMl[k] ?? 0
    const same = x === y
    ok &&= same
    out.push(`| ${k} | ${x}ml | ${y}ml | ${same ? "예" : "**아니오**"} |`)
  }
  out.push("", "| 출고 ml (타입 @ 농도%) | 전 (출고 개수 × 용량) | 뒤 (출고 ml) | 같음 |", "|---|---:|---:|---|")
  for (const k of [...new Set([...Object.keys(a.shipMl ?? {}), ...Object.keys(b.shipMl ?? {})])].sort()) {
    const x = a.shipMl?.[k] ?? 0
    const y = b.shipMl?.[k] ?? 0
    ok &&= x === y
    out.push(`| ${k} | ${x}ml | ${y}ml | ${x === y ? "예" : "**아니오**"} |`)
  }
  out.push("", "| 젤이 아닌 품목(코드) | 전 | 뒤 | 같음 |", "|---|---:|---:|---|")
  for (const k of [...new Set([...Object.keys(a.other), ...Object.keys(b.other)])].sort()) {
    const same = (a.other[k] ?? 0) === (b.other[k] ?? 0)
    ok &&= same
    out.push(`| ${k} | ${a.other[k] ?? 0} | ${b.other[k] ?? 0} | ${same ? "예" : "**아니오**"} |`)
  }
  out.push("", "| 표 | 행 수 전 | 뒤 |", "|---|---:|---:|")
  for (const t of Object.keys(b.counts)) out.push(`| ${t} | ${a.counts[t]} | ${b.counts[t]} |`)
  if (b.hidden?.length) {
    out.push("", "| 옮기지 못해 숨긴 젤 행 | 이름 규격 | 걸린 출고 | 견적 품목 |", "|---|---|---|---:|")
    for (const h of b.hidden) out.push(`| ${h.code} | ${h.label} | ${h.shipments.join(", ") || "-"} | ${h.quoteItems} |`)
  }
  out.push("", ok ? "재고 합이 전후 모두 같다." : "**재고 합이 다르다 — 위에서 「아니오」 줄을 확인할 것.**")
  return out.join("\n")
}

async function main() {
  const snap = await snapshot()
  const save = args[args.indexOf("--save") + 1]
  const cmp = args[args.indexOf("--compare") + 1]
  if (args.includes("--save") && save) {
    writeFileSync(save, JSON.stringify(snap, null, 2))
    console.log(`저장: ${save}`)
    console.log(JSON.stringify(snap, null, 2))
  } else if (args.includes("--compare") && cmp) {
    console.log(compare(JSON.parse(readFileSync(cmp, "utf8")) as Snapshot, snap))
  } else console.log(JSON.stringify(snap, null, 2))
}

main().finally(() => prisma.$disconnect())
