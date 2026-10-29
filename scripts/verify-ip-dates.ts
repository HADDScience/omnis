/**
 * 출원일·등록일 규칙 검증 — 트리거와 재계산이 같은 답을 내는가.
 *
 *   npx tsx scripts/verify-ip-dates.ts
 *
 * 전부 한 트랜잭션 안에서 돌리고 마지막에 되돌린다. DB 에 아무것도 남지 않는다.
 * 계획: mydocs/plans/2026-10-28-ip-explicit-dates.md
 */
import { prisma } from "../lib/db"
import { isYmd } from "../lib/ip-data"

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const ROLLBACK = new Error("rollback")
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type Row = Record<string, unknown>

const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v))

/** 개시 스냅샷을 직접 만든 시험용 건. 실제 건의 값에 기대지 않는다. */
async function seed(tx: Tx, id: string, stage: string, refDate: string | null) {
  await tx.$executeRaw`
    INSERT INTO ip.trademarks (id, name, status, ref_date) VALUES (${id}, ${id}, ${stage}, ${refDate}::date)`
  await tx.$executeRaw`
    INSERT INTO ip.opening_state (entity_kind, entity_id, stage, ref_date, name)
    VALUES ('trademark', ${id}, ${stage}, ${refDate}::date, ${id})`
}

async function entry(
  tx: Tx,
  id: string,
  on: string,
  stage: string,
  source = "manual",
  dates: { filedOn?: string; registeredOn?: string } = {}
) {
  await tx.$executeRaw`
    INSERT INTO ip.progress_entries
      (occurred_on, entity_kind, entity_id, stage, note, source, raw, filed_on, registered_on)
    VALUES (${on}::date, 'trademark', ${id}, ${stage}, 'verify', ${source},
            ${source === "mail" ? "verify" : null}, ${dates.filedOn ?? null}, ${dates.registeredOn ?? null})`
}

async function ledger(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT status, ref_date, filed_on, registered_on FROM ip.trademarks WHERE id = ${id}`
  const r = rows[0]
  return { status: r.status, ref: day(r.ref_date), filed: day(r.filed_on), registered: day(r.registered_on) }
}

/** 트랜잭션 안에서 SQL 이 실패하는지. 실패하면 트랜잭션이 깨지므로 savepoint 로 감싼다. */
async function rejects(tx: Tx, run: () => Promise<unknown>): Promise<boolean> {
  await tx.$executeRawUnsafe("SAVEPOINT reject_check")
  try {
    await run()
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT reject_check")
    return false
  } catch {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reject_check")
    return true
  }
}

async function main() {
  console.log("\n[isYmd]")
  check("2025-10-17 통과", isYmd("2025-10-17"))
  check("2025.10.17 거절", !isYmd("2025.10.17"))
  check("2025-02-30 거절", !isYmd("2025-02-30"))
  check("빈 문자열 거절", !isYmd(""))

  await prisma
    .$transaction(async (tx) => {
      console.log("\n[재계산 동일성 — 실제 데이터]")
      const snap = async () =>
        JSON.stringify(
          await tx.$queryRaw<Row[]>`
            SELECT 'tm' k, id, status, ref_date, app_no, reg_no, filed_on, registered_on FROM ip.trademarks
            UNION ALL
            SELECT 'pt', id, status, ref_date, app_no, reg_no, filed_on, registered_on FROM ip.patents
            ORDER BY 1, 2`
        )
      const before = await snap()
      await tx.$queryRaw`SELECT * FROM ip.rebuild_ledger()`
      check("rebuild_ledger 뒤 대장이 그대로", before === (await snap()))

      console.log("\n[latch — 그 단계에 들어간 기록만 날짜를 채운다]")
      // PT-05·06 의 모양: 이미 출원 단계 · 출원일 없음 · 기준일 = 실제 출원일
      await seed(tx, "ZZ-A", "출원", "2025-10-17")
      await entry(tx, "ZZ-A", "2026-10-26", "출원", "mail")
      let a = await ledger(tx, "ZZ-A")
      check("기준일보다 늦은 같은 단계 기록은 출원일을 채우지 않는다", a.filed === null, JSON.stringify(a))
      check("  그래도 마지막 진행일은 움직인다", a.ref === "2026-10-26", JSON.stringify(a))

      // TM-07 의 모양: 이미 등록 단계 · 기준일 당일의 등록 기록
      await seed(tx, "ZZ-B", "등록", "2025-12-18")
      await entry(tx, "ZZ-B", "2025-12-18", "등록", "excel")
      check("기준일 당일의 같은 단계 기록은 등록일을 채운다", (await ledger(tx, "ZZ-B")).registered === "2025-12-18")

      await seed(tx, "ZZ-C", "출원준비", "2026-09-01")
      await entry(tx, "ZZ-C", "2026-10-01", "출원")
      await entry(tx, "ZZ-C", "2026-10-20", "출원", "mail")
      check("단계가 바뀌는 기록이 출원일을 채우고, 후속 기록은 그대로 둔다", (await ledger(tx, "ZZ-C")).filed === "2026-10-01")

      // 권리 이전: 이미 등록 · 등록일 없음 · 나중 날짜의 이전 기록
      await seed(tx, "ZZ-D", "등록", "2025-05-15")
      await entry(tx, "ZZ-D", "2026-03-02", "등록")
      check("이전 기록은 등록일이 되지 않는다", (await ledger(tx, "ZZ-D")).registered === null)

      await seed(tx, "ZZ-E", "출원", null)
      await entry(tx, "ZZ-E", "2026-01-05", "출원")
      check("기준일을 모르면 같은 단계 기록이 출원일을 채운다", (await ledger(tx, "ZZ-E")).filed === "2026-01-05")

      console.log("\n[명시값 — 값 정정]")
      await entry(tx, "ZZ-A", "2026-10-28", "출원", "edit", { filedOn: "2025-10-17" })
      a = await ledger(tx, "ZZ-A")
      check("출원일 정정이 반영된다", a.filed === "2025-10-17", JSON.stringify(a))
      check("  정정은 마지막 진행일을 움직이지 않는다", a.ref === "2026-10-26", JSON.stringify(a))

      await entry(tx, "ZZ-B", "2025-01-01", "등록", "edit", { registeredOn: "2025-06-07" })
      check("기준일보다 이른 날짜의 정정도 반영된다", (await ledger(tx, "ZZ-B")).registered === "2025-06-07")

      await entry(tx, "ZZ-E", "2026-10-28", "출원", "edit", { filedOn: "" })
      check("빈 문자열은 비운다", (await ledger(tx, "ZZ-E")).filed === null)

      const trig = JSON.stringify(
        await Promise.all(["ZZ-A", "ZZ-B", "ZZ-C", "ZZ-D", "ZZ-E"].map((id) => ledger(tx, id)))
      )
      await tx.$queryRaw`SELECT * FROM ip.rebuild_ledger()`
      const rebuilt = JSON.stringify(
        await Promise.all(["ZZ-A", "ZZ-B", "ZZ-C", "ZZ-D", "ZZ-E"].map((id) => ledger(tx, id)))
      )
      check("재계산이 트리거와 같은 답을 낸다", trig === rebuilt, `${trig}\n    ${rebuilt}`)

      console.log("\n[거부되어야 하는 것]")
      check(
        "형식이 틀린 날짜(2025.10.17)",
        await rejects(tx, () => entry(tx, "ZZ-A", "2026-10-28", "출원", "edit", { filedOn: "2025.10.17" }))
      )
      check(
        "달력에 없는 날짜(2025-02-30)",
        await rejects(tx, () => entry(tx, "ZZ-A", "2026-10-28", "출원", "edit", { registeredOn: "2025-02-30" }))
      )

      throw ROLLBACK
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e
    })

  console.log(`\n${passed} 통과 · ${failed} 실패 (변경은 되돌렸다)`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
