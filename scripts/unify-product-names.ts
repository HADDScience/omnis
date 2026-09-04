/**
 * 제품명을 한 형식으로 맞춘다.
 *
 *   npx tsx scripts/unify-product-names.ts [--apply]
 *
 * 엑셀에서 애드젤이 네 가지로 흩어져 있었다 —
 *   ADD Gel (1%) 시린지 타입 · 애드젤 (ADD GEL 1%) · ADDGEL (Bottle&Syringe) ·
 *   ADDGEL (Lypophilized)
 * 같은 제품인데 표기가 다르면 검색이 갈라지고, 사람이 "어느 쪽이 맞나"를 매번 고른다.
 * 실제로 샘플요청에서는 "애드젠" 이라는 오타까지 생겼다.
 *
 * 라이브젤이 이미 쓰던 `한글명 (English Name)` 형식으로 통일하고, 형태·용량은
 * 이름이 아니라 규격·타입 칸으로 옮긴다. 이름은 제품이 무엇인지만 말한다.
 *
 * 금액은 영향받지 않는다 — 견적 품목은 단가를 복사해 굳혀 두었다.
 */
import { PrismaClient } from "../generated/prisma"

const APPLY = process.argv.includes("--apply")
const prisma = new PrismaClient()

interface Rename {
  code: string
  name: string
  spec: string | null
  kind: string | null
}

const RENAMES: Rename[] = [
  { code: "PRD001", name: "애드젤 (ADD Gel)", spec: "5ml (1ml × 5ea)", kind: "시린지" },
  { code: "PRD002", name: "애드젤 (ADD Gel)", spec: "5ml", kind: "바이알" },
  { code: "PRD009", name: "애드젤 (ADD Gel)", spec: "2ml", kind: "바이알" },
  { code: "PRD007", name: "애드젤 (ADD Gel)", spec: "Bottle & Syringe SET", kind: "세트" },
  { code: "PRD008", name: "애드젤 (ADD Gel)", spec: "동결건조", kind: "동결건조" },
  { code: "PRD003", name: "라이브젤 (Live Gel)", spec: "1ml", kind: null },
  { code: "PRD004", name: "라이브젤 (Live Gel)", spec: "3ml", kind: null },
]

async function main() {
  const before = await prisma.crmProduct.findMany({ orderBy: { code: "asc" } })
  const byCode = new Map(before.map((p) => [p.code, p]))

  console.log(APPLY ? "모드: 실제 반영\n" : "모드: 미리보기 (쓰지 않음)\n")
  console.log("─── 바꿀 것 ───")
  let changes = 0
  for (const r of RENAMES) {
    const p = byCode.get(r.code)
    if (!p) {
      console.log(`  ${r.code} — 없다. 건너뛴다`)
      continue
    }
    const same = p.name === r.name && p.spec === r.spec && p.kind === r.kind
    if (same) {
      console.log(`  ${r.code}  이미 맞음`)
      continue
    }
    changes++
    console.log(`  ${r.code}`)
    console.log(`      ${p.name} / ${p.spec ?? "-"} / ${p.kind ?? "-"}`)
    console.log(`   →  ${r.name} / ${r.spec ?? "-"} / ${r.kind ?? "-"}`)
  }

  const untouched = before.filter((p) => !RENAMES.some((r) => r.code === p.code))
  console.log("\n─── 손대지 않는 것 ───")
  for (const p of untouched) {
    console.log(`  ${p.code}  ${p.name}${p.spec ? ` / ${p.spec}` : ""}`)
  }

  // (이름, 규격) 이 unique 라 겹치면 반영이 막힌다. 미리 잡아 둔다.
  const keys = new Map<string, string>()
  for (const r of RENAMES) {
    const k = `${r.name}::${r.spec ?? ""}`
    if (keys.has(k)) {
      console.log(`\n✗ ${r.code} 와 ${keys.get(k)} 가 같은 (이름, 규격) 이다: ${k}`)
      process.exit(1)
    }
    keys.set(k, r.code)
  }
  for (const p of untouched) {
    const k = `${p.name}::${p.spec ?? ""}`
    if (keys.has(k)) {
      console.log(`\n✗ ${p.code} 가 ${keys.get(k)} 와 같은 (이름, 규격) 이 된다: ${k}`)
      process.exit(1)
    }
  }
  console.log("\n(이름, 규격) 중복 없음")

  if (!APPLY) {
    console.log(`\n미리보기라 쓰지 않았다. ${changes}건을 바꾸려면 --apply`)
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const r of RENAMES) {
      if (!byCode.has(r.code)) continue
      await tx.crmProduct.update({
        where: { code: r.code },
        data: { name: r.name, spec: r.spec, kind: r.kind },
      })
    }
  })

  console.log("\n─── 반영 후 ───")
  for (const p of await prisma.crmProduct.findMany({ orderBy: { code: "asc" } })) {
    console.log(`  ${p.code}  ${p.name}${p.spec ? `  ${p.spec}` : ""}${p.kind ? `  (${p.kind})` : ""}`)
  }

  // 금액이 그대로인지 확인한다 — 단가는 견적에 복사돼 있으므로 변할 이유가 없다
  const items = await prisma.crmQuoteItem.findMany()
  const supply = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0)
  console.log(`\n견적 총 공급가 ${supply.toLocaleString()}  ${supply === 39951550 ? "✓ 그대로" : "✗ 변했다"}`)
}

main()
  .catch((e) => {
    console.error("실패:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
