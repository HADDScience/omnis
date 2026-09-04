/**
 * 원료를 「몇 병」이 아니라 「몇 그램」으로 센다.
 *
 *   npx tsx scripts/convert-material-to-grams.ts [--apply]
 *
 * 엑셀은 DNA 를 5g 병과 4.5g 병으로 나눠 개수로 셌다. 생산에 들어가는 것은 그램이라
 * 병 개수만으로는 얼마가 남았는지 바로 알 수 없고, 병 규격이 바뀌면 과거 기록의 뜻이
 * 달라진다. 그래서 DNA 하나로 합치고 장부를 그램으로 다시 쓴다.
 *
 * 완제품에는 용량(ml)과 농도(wt%)를 채운다 — 생산에 드는 원료량을 계산하려면 둘이
 * 있어야 한다. 모르는 것은 비워 둔다. 지어내느니 계산을 안 하는 편이 낫다.
 */
import { PrismaClient, CrmStockUnit } from "../generated/prisma"

const APPLY = process.argv.includes("--apply")
const prisma = new PrismaClient()

/** 규격 문자열에서 ml 를 읽는다. "5ml (1ml x 5ea)" 는 총 5ml 다. */
const VOLUME_ML: Record<string, number | null> = {
  PRD001: 5, // 5ml (1ml × 5ea)
  PRD002: 5,
  PRD003: 1,
  PRD004: 3,
  PRD009: 2,
  PRD007: null, // Bottle & Syringe SET — 총 용량을 모른다
  PRD008: null, // 동결건조 — 액상이 아니다
  PRD010: null, // 고정제 — DNA 제품이 아니다
}

/** 애드젤이 1wt%. 라이브젤·고정제는 확인 전이라 비워 둔다. */
const CONCENTRATION: Record<string, number | null> = {
  PRD001: 1,
  PRD002: 1,
  PRD009: 1,
  PRD007: 1,
  PRD008: null,
  PRD003: null, // 라이브젤 — 농도 확인 필요
  PRD004: null,
  PRD010: null,
}

async function main() {
  const products = await prisma.crmProduct.findMany({
    orderBy: { code: "asc" },
    include: { stockMoves: true },
  })
  const materials = products.filter((p) => p.isMaterial)
  const keep = materials.find((m) => m.code === "PRD005")
  if (!keep) throw new Error("PRD005 (DNA) 를 찾지 못했다")

  console.log(APPLY ? "모드: 실제 반영\n" : "모드: 미리보기 (쓰지 않음)\n")

  // 병 규격(g) — 이름/규격에 적힌 값이 곧 한 병의 그램이다
  const gramsPerUnit = (spec: string | null) => parseFloat((spec ?? "0").replace(/[^\d.]/g, "")) || 0

  console.log("─── 원료를 그램으로 ───")
  let total = 0
  const converted: { movedAt: Date; grams: number; note: string | null; from: string }[] = []
  for (const m of materials) {
    const per = gramsPerUnit(m.spec)
    for (const mv of m.stockMoves) {
      const grams = Number(mv.quantity) * per
      total += mv.direction === "IN" ? grams : -grams
      converted.push({ movedAt: mv.movedAt, grams, note: mv.note, from: m.code })
      console.log(
        `  ${mv.movedAt.toISOString().slice(0, 10)} ${m.code} ${mv.direction} ${mv.quantity}병 × ${per}g = ${grams}g  ${mv.note ?? ""}`
      )
    }
  }
  console.log(`  → DNA 합계 ${total}g`)

  console.log("\n─── 완제품 용량·농도 ───")
  for (const p of products.filter((x) => !x.isMaterial)) {
    const v = VOLUME_ML[p.code] ?? null
    const c = CONCENTRATION[p.code] ?? null
    const need = v != null && c != null ? ((v * c) / 100).toFixed(3) : null
    console.log(
      `  ${p.code} ${p.name} ${p.spec ?? ""}` +
        `  용량 ${v ?? "—"}ml · 농도 ${c ?? "—"}wt%` +
        (need ? `  → 1개에 DNA ${need}g` : "  → 계산 불가 (값을 채워 주세요)")
    )
  }

  if (!APPLY) {
    console.log("\n미리보기라 쓰지 않았다. 반영하려면 --apply")
    return
  }

  await prisma.$transaction(async (tx) => {
    // 1) DNA 하나로 합친다
    await tx.crmStockMove.deleteMany({ where: { productId: { in: materials.map((m) => m.id) } } })
    await tx.crmProduct.update({
      where: { id: keep.id },
      data: {
        name: "DNA",
        spec: null,
        kind: "원료",
        stockUnit: CrmStockUnit.GRAM,
        note: "하이드로젤 원료. 그램으로 센다",
      },
    })
    for (const c of converted) {
      await tx.crmStockMove.create({
        data: {
          movedAt: c.movedAt,
          productId: keep.id,
          direction: "IN",
          quantity: c.grams,
          note: [c.note, c.from !== keep.code ? `${c.from} 에서 합침` : null]
            .filter(Boolean)
            .join(" · "),
        },
      })
    }
    // 2) 남은 원료 품목은 감춘다. 지우지 않는 이유는 지난 기록이 가리킬 수 있어서다.
    for (const m of materials.filter((x) => x.id !== keep.id)) {
      await tx.crmProduct.update({
        where: { id: m.id },
        data: { archived: true, note: `${keep.code} (DNA) 로 합쳐짐` },
      })
    }
    // 3) 완제품에 용량·농도
    for (const p of products.filter((x) => !x.isMaterial)) {
      await tx.crmProduct.update({
        where: { id: p.id },
        data: {
          stockUnit: CrmStockUnit.PIECE,
          volumeMl: VOLUME_ML[p.code] ?? null,
          concentrationPct: CONCENTRATION[p.code] ?? null,
        },
      })
    }
  })

  const after = await prisma.crmProduct.findMany({
    where: { isMaterial: true, archived: false },
    include: { stockMoves: true },
  })
  console.log("\n─── 반영 후 ───")
  for (const m of after) {
    const bal = m.stockMoves.reduce(
      (a, x) => a + (x.direction === "IN" ? Number(x.quantity) : -Number(x.quantity)),
      0
    )
    console.log(`  ${m.code} ${m.name}: ${bal}g (${m.stockMoves.length}줄)`)
  }
}

main()
  .catch((e) => {
    console.error("실패:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
