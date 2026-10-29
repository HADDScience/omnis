/**
 * 출원일·등록일 규칙 검증 — 트리거와 재계산이 같은 답을 내는가.
 *
 *   npx tsx scripts/verify-ip-dates.ts
 *
 * 전부 한 트랜잭션 안에서 돌리고 마지막에 되돌린다. DB 에 아무것도 남지 않는다.
 * 계획: mydocs/plans/2026-10-28-ip-explicit-dates.md
 *       mydocs/plans/2026-10-29-ip-status-and-event.md (상태 5개 · 사건)
 */
import { prisma } from "../lib/db"
import { isYmd, resolveStatusEvent } from "../lib/ip-data"

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
async function seed(
  tx: Tx,
  id: string,
  status: string,
  refDate: string | null,
  nums: { appNo?: string; regNo?: string } = {}
) {
  await tx.$executeRaw`
    INSERT INTO ip.trademarks (id, name, status, ref_date, app_no, reg_no, kind)
    VALUES (${id}, ${id}, ${status}, ${refDate}::date, ${nums.appNo ?? null}, ${nums.regNo ?? null}, 'trademark')`
  await tx.$executeRaw`
    INSERT INTO ip.opening_state (entity_kind, entity_id, stage, status, ref_date, name, app_no, reg_no)
    VALUES ('trademark', ${id}, ${status}, ${status}, ${refDate}::date, ${id}, ${nums.appNo ?? null}, ${nums.regNo ?? null})`
}

/** 기록 한 줄. event 는 사건, 상태는 extra.status 로만 명시한다(새 방식). */
async function entry(
  tx: Tx,
  id: string,
  on: string,
  event: string | null,
  source = "manual",
  extra: { filedOn?: string; registeredOn?: string; status?: string; appNo?: string; regNo?: string } = {}
) {
  await tx.$executeRaw`
    INSERT INTO ip.progress_entries
      (occurred_on, entity_kind, entity_id, stage, status, app_no, reg_no, note, source, raw,
       filed_on, registered_on)
    VALUES (${on}::date, 'trademark', ${id}, ${event}, ${extra.status ?? null},
            ${extra.appNo ?? null}, ${extra.regNo ?? null}, 'verify', ${source},
            ${source === "mail" ? "verify" : null}, ${extra.filedOn ?? null}, ${extra.registeredOn ?? null})`
}

async function ledger(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT status, ref_date, filed_on, registered_on, app_no, reg_no FROM ip.trademarks WHERE id = ${id}`
  const r = rows[0]
  return {
    status: r.status,
    ref: day(r.ref_date),
    filed: day(r.filed_on),
    registered: day(r.registered_on),
    app: r.app_no,
    reg: r.reg_no,
  }
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

      await seed(tx, "ZZ-C", "출원전", "2026-09-01")
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

      console.log("\n[상태 — 사건이 옮기는 것만 옮긴다]")
      // PT-10 의 모양: 출원 상태에서 우선심사신청·의견제출통지·출원공고
      await seed(tx, "ZZ-F", "출원", "2026-07-31", { appNo: "10-2026-0142466" })
      await entry(tx, "ZZ-F", "2026-08-13", "우선심사신청", "mail")
      check("우선심사신청은 상태를 바꾸지 않는다", (await ledger(tx, "ZZ-F")).status === "출원")
      await entry(tx, "ZZ-F", "2026-09-01", "의견제출통지", "mail")
      await entry(tx, "ZZ-F", "2026-09-20", "출원공고", "mail")
      check("의견제출통지·출원공고 뒤에도 출원", (await ledger(tx, "ZZ-F")).status === "출원")
      await entry(tx, "ZZ-F", "2026-10-01", "등록", "mail", { regNo: "10-2900000" })
      const f = await ledger(tx, "ZZ-F")
      check("「등록」 사건이 등록으로 옮기고 등록일을 채운다", f.status === "등록" && f.registered === "2026-10-01", JSON.stringify(f))

      await seed(tx, "ZZ-G", "출원", "2026-01-01", { appNo: "40-2025-0000001" })
      await entry(tx, "ZZ-G", "2026-02-01", "거절결정", "mail")
      check("거절결정을 받고 다투는 중이면 출원", (await ledger(tx, "ZZ-G")).status === "출원")
      await entry(tx, "ZZ-G", "2026-04-01", "거절확정")
      check("거절확정이 거절로 옮긴다", (await ledger(tx, "ZZ-G")).status === "거절")

      await seed(tx, "ZZ-H", "출원", "2026-01-01")
      await entry(tx, "ZZ-H", "2026-03-01", "검토의견")
      check("출원한 건에 검토의견이 와도 출원전으로 되돌아가지 않는다", (await ledger(tx, "ZZ-H")).status === "출원")
      await entry(tx, "ZZ-H", "2026-04-01", null, "manual", { status: "포기" })
      check("상태 명시(사건 없음)는 그대로 반영된다", (await ledger(tx, "ZZ-H")).status === "포기")
      await entry(tx, "ZZ-H", "2026-03-15", null, "manual", { status: "출원" })
      check("  지난 날짜의 상태 명시는 지금을 되돌리지 않는다", (await ledger(tx, "ZZ-H")).status === "포기")

      console.log("\n[번호 자동 전환 — 날짜는 채우지 않는다]")
      await seed(tx, "ZZ-I", "출원전", "2026-09-01")
      await entry(tx, "ZZ-I", "2026-09-10", "출원준비", "manual", { appNo: "사건번호: PJC260673" })
      check("출원번호 형식이 아니면 출원으로 옮기지 않는다", (await ledger(tx, "ZZ-I")).status === "출원전")
      await seed(tx, "ZZ-J", "출원전", "2026-09-01")
      await entry(tx, "ZZ-J", "2026-10-26", "검토의견", "mail", { appNo: "40-2026-0190878 (제05류)" })
      let j = await ledger(tx, "ZZ-J")
      check("출원번호를 처음 넣으면 출원", j.status === "출원", JSON.stringify(j))
      check("  메일 날짜를 출원일로 넣지 않는다", j.filed === null, JSON.stringify(j))
      await entry(tx, "ZZ-J", "2026-10-27", "값 정정", "edit", { regNo: "40-2475905" })
      j = await ledger(tx, "ZZ-J")
      check("등록번호를 처음 넣으면 등록 · 등록일은 비어 있다", j.status === "등록" && j.registered === null, JSON.stringify(j))
      await seed(tx, "ZZ-K", "등록", "2025-01-01", { regNo: "40-2359918" })
      await entry(tx, "ZZ-K", "2026-01-01", "등록료납부", "manual", { regNo: "40-2359918" })
      check("이미 등록번호가 있으면 다시 옮기지 않는다", (await ledger(tx, "ZZ-K")).status === "등록")

      console.log("\n[TM-08 의 모양 — 등록번호 칸의 출원번호를 옮긴다]")
      await seed(tx, "ZZ-L", "거절", "2026-10-26", { regNo: "40-2025-0124087" })
      await entry(tx, "ZZ-L", "2026-10-29", "값 정정", "edit", { appNo: "40-2025-0124087", regNo: "" })
      const l = await ledger(tx, "ZZ-L")
      check(
        "app_no 로 옮기고 reg_no 는 비우며 상태는 거절 그대로",
        l.status === "거절" && l.app === "40-2025-0124087" && l.reg === null && l.ref === "2026-10-26",
        JSON.stringify(l)
      )

      const ids = ["ZZ-A", "ZZ-B", "ZZ-C", "ZZ-D", "ZZ-E", "ZZ-F", "ZZ-G", "ZZ-H", "ZZ-I", "ZZ-J", "ZZ-K", "ZZ-L"]
      const trig = JSON.stringify(await Promise.all(ids.map((id) => ledger(tx, id))))
      await tx.$queryRaw`SELECT * FROM ip.rebuild_ledger()`
      const rebuilt = JSON.stringify(await Promise.all(ids.map((id) => ledger(tx, id))))
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
      check("없는 사건", await rejects(tx, () => entry(tx, "ZZ-A", "2026-10-28", "없는사건")))
      check("옛 상태 값(심사중)을 상태로", await rejects(tx, () => entry(tx, "ZZ-A", "2026-10-28", null, "manual", { status: "심사중" })))
      check("상태도 사건도 없는 기록", await rejects(tx, () => entry(tx, "ZZ-A", "2026-10-28", null)))
      check(
        "대장에 옛 단계 값",
        await rejects(tx, () => tx.$executeRaw`UPDATE ip.trademarks SET status = '출원준비' WHERE id = 'ZZ-A'`)
      )

      throw ROLLBACK
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e
    })

  console.log("\n[옛 단계 번역 — add_progress·웹 API 가 쓰는 resolveStatusEvent]")
  const tr = async (input: Parameters<typeof resolveStatusEvent>[1], cur: string | null) =>
    JSON.stringify(await resolveStatusEvent("patent", input, cur))
  const same = async (input: Parameters<typeof resolveStatusEvent>[1], cur: string | null, want: unknown) => {
    const got = await tr(input, cur)
    check(`${JSON.stringify(input)} @${cur} → ${JSON.stringify(want)}`, got === JSON.stringify(want), got)
  }
  await same({ stage: "의견제출통지" }, "출원전", { status: "출원", event: "의견제출통지" })
  await same({ stage: "의견제출통지" }, "출원", { status: null, event: "의견제출통지" })
  await same({ stage: "검토의견" }, "출원", { status: null, event: "검토의견" })
  await same({ stage: "출원준비" }, "포기", { status: null, event: "출원준비" })
  await same({ stage: "심사중" }, "출원", { status: null, event: "심사중" })
  await same({ stage: "포기·중단" }, "출원전", { status: null, event: "포기" })
  await same({ stage: "거절확정" }, "출원", { status: null, event: "거절확정" })
  await same({ stage: "출원" }, "출원전", { status: null, event: "출원" })
  await same({ stage: "출원전" }, "포기", { status: "출원전", event: null })
  await same({ event: "우선심사신청" }, "출원", { status: null, event: "우선심사신청" })
  await same({ status: "출원준비", event: "값 정정" }, "출원", { status: "출원전", event: "값 정정" })
  await same({ status: "포기" }, "출원", { status: "포기", event: null })
  await same({ status: "심사중" }, "출원전", { status: "출원", event: "심사중" })
  for (const bad of [{ stage: "없는단계" }, { status: "없는상태" }, { event: "없는사건" }, {}]) {
    const got = await tr(bad, "출원")
    check(`거부: ${JSON.stringify(bad)}`, got.includes("error"), got)
  }

  console.log(`\n${passed} 통과 · ${failed} 실패 (변경은 되돌렸다)`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
