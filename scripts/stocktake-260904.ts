/**
 * 2026-09-04 실사. 작업지시자가 직접 센 수치를 장부에 맞춘다.
 *
 *   npx tsx scripts/stocktake-260904.ts [--apply]
 *
 *   DNA            600g
 *   애드젤 2ml 시린지   54개
 *   라이브젤 2ml       50개
 *
 * 지난 기록은 지우지 않는다. 차이만큼 「실사 보정」 한 줄을 더한다 — 이력을 지우면
 * 왜 그 숫자가 됐는지 다시 물을 때 답할 것이 없다.
 *
 * 함께 고치는 것:
 *  - PRD009 의 형태가 바이알로 잘못 적혀 있었다 → 시린지
 *  - 라이브젤 2ml 이 제품마스터에 없었다 → 새로 만든다 (0.74wt%, 이미징용)
 *  - 라이브젤 농도 0.74wt% — 애드젤과 성분이 같고 용도만 다르다고 확인받았으므로
 *    1ml·3ml 에도 같이 넣는다
 */
import { PrismaClient, CrmStockUnit } from "../generated/prisma"
import { stockBalance, gramsPerUnit } from "../lib/crm"

const APPLY = process.argv.includes("--apply")
const prisma = new PrismaClient()

const LIVEGEL_PCT = 0.74
const COUNTED_AT = new Date("2026-09-04T00:00:00.000Z")

async function main() {
  console.log(APPLY ? "모드: 실제 반영\n" : "모드: 미리보기 (쓰지 않음)\n")

  const dna = await prisma.crmProduct.findUnique({
    where: { code: "PRD005" },
    include: { stockMoves: true },
  })
  const syringe2ml = await prisma.crmProduct.findUnique({
    where: { code: "PRD009" },
    include: { stockMoves: true },
  })
  if (!dna || !syringe2ml) throw new Error("PRD005 또는 PRD009 를 찾지 못했다")

  const live2ml = await prisma.crmProduct.findFirst({
    where: { name: "라이브젤 (Live Gel)", spec: "2ml" },
    include: { stockMoves: true },
  })
  const liveOthers = await prisma.crmProduct.findMany({
    where: { name: "라이브젤 (Live Gel)", spec: { in: ["1ml", "3ml"] } },
  })

  const targets = [
    { label: "DNA", product: dna, counted: 600, unit: "g" },
    { label: "애드젤 2ml 시린지", product: syringe2ml, counted: 54, unit: "개" },
    { label: "라이브젤 2ml", product: live2ml, counted: 50, unit: "개" },
  ]

  console.log("─── 맞출 것 ───")
  for (const t of targets) {
    const now = t.product ? stockBalance(t.product.stockMoves).balance : 0
    const diff = Math.round((t.counted - now) * 1000) / 1000
    console.log(
      `  ${t.label.padEnd(16)} 장부 ${String(now).padStart(7)}${t.unit}` +
        ` → 실사 ${t.counted}${t.unit}` +
        `  (${diff >= 0 ? "+" : ""}${diff}${t.unit})` +
        (t.product ? "" : "  ※ 제품마스터에 없어 새로 만든다")
    )
  }

  console.log("\n─── 제품마스터 수정 ───")
  console.log(`  PRD009 형태  ${syringe2ml.kind} → 시린지`)
  console.log(`  라이브젤 2ml  새로 만듦 (2ml · ${LIVEGEL_PCT}wt% · 이미징용)`)
  for (const l of liveOthers) {
    console.log(`  ${l.code} 라이브젤 ${l.spec} 농도  ${l.concentrationPct ?? "-"} → ${LIVEGEL_PCT}wt%`)
  }
  console.log(
    `\n  → 라이브젤 2ml 한 개에 DNA ${gramsPerUnit(2, LIVEGEL_PCT)}g` +
      ` · 애드젤 2ml 한 개에 ${gramsPerUnit(2, 1)}g`
  )

  if (!APPLY) {
    console.log("\n미리보기라 쓰지 않았다. 반영하려면 --apply")
    return
  }

  await prisma.$transaction(async (tx) => {
    // 1) PRD009 형태 바로잡기
    await tx.crmProduct.update({ where: { id: syringe2ml.id }, data: { kind: "시린지" } })

    // 2) 라이브젤 농도
    for (const l of liveOthers) {
      await tx.crmProduct.update({
        where: { id: l.id },
        data: { concentrationPct: LIVEGEL_PCT },
      })
    }

    // 3) 라이브젤 2ml
    let live = live2ml
    if (!live) {
      const codes = (await tx.crmProduct.findMany({ select: { code: true } })).map((p) => p.code)
      const seq = codes.reduce((m, c) => {
        const g = /^PRD(\d+)$/.exec(c)
        return g ? Math.max(m, Number(g[1])) : m
      }, 0)
      const created = await tx.crmProduct.create({
        data: {
          code: `PRD${String(seq + 1).padStart(3, "0")}`,
          name: "라이브젤 (Live Gel)",
          spec: "2ml",
          volumeMl: 2,
          concentrationPct: LIVEGEL_PCT,
          stockUnit: CrmStockUnit.PIECE,
          note: "이미징용. 애드젤과 성분은 같고 농도와 용도가 다르다",
        },
      })
      live = { ...created, stockMoves: [] }
      console.log(`  ${created.code} 라이브젤 2ml 를 만들었다`)
    }

    // 4) 실사 보정
    const adjust = async (product: { id: string; stockMoves: { direction: string; quantity: unknown }[] }, counted: number) => {
      const now = stockBalance(product.stockMoves as never).balance
      const diff = Math.round((counted - now) * 1000) / 1000
      if (diff === 0) return
      await tx.crmStockMove.create({
        data: {
          movedAt: COUNTED_AT,
          productId: product.id,
          direction: diff > 0 ? "IN" : "OUT",
          quantity: Math.abs(diff),
          note: "실사 보정 (2026-09-04)",
        },
      })
    }
    await adjust(dna, 600)
    await adjust(syringe2ml, 54)
    await adjust(live, 50)
  })

  console.log("\n─── 반영 후 ───")
  const after = await prisma.crmProduct.findMany({
    where: { archived: false },
    orderBy: { code: "asc" },
    include: { stockMoves: true },
  })
  for (const p of after) {
    const { balance } = stockBalance(p.stockMoves)
    if (balance === 0 && p.stockMoves.length === 0) continue
    const per = gramsPerUnit(
      p.volumeMl ? Number(p.volumeMl) : null,
      p.concentrationPct ? Number(p.concentrationPct) : null
    )
    console.log(
      `  ${p.code} ${p.name} ${p.spec ?? ""} ${p.kind ? `(${p.kind})` : ""}`.padEnd(48) +
        `${balance}${p.stockUnit === "GRAM" ? "g" : "개"}` +
        (per ? `  · 1개에 ${per}g` : "")
    )
  }
}

main()
  .catch((e) => {
    console.error("실패:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
