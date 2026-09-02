/**
 * 옮겨 온 자료가 원본(Supabase)과 같은지 값 단위로 대조한다.
 *
 *   TARGET_DB="<Neon 접속문자열>" npx tsx scripts/compare-ip-source.ts
 *
 * 행 수가 같아도 값이 다를 수 있다. 표별로 모든 업무 칸을 이어 붙여 md5 를 내고
 * 원본에서 같은 방식으로 낸 값과 견준다 — 한 글자만 달라도 걸린다.
 *
 * 원본 쪽 digest 는 Supabase 에 같은 질의를 던져 받아 적은 것이다. 이사가 끝나
 * Supabase 를 내리면 이 스크립트도 쓸모를 다한다.
 */
import { PrismaClient } from "../generated/prisma"

const prisma = new PrismaClient({ datasources: { db: { url: process.env.TARGET_DB } } })

/** Supabase 원본에서 받은 값 (2026-09-02, 컷오버 직후) */
const SOURCE = {
  trademarks: "8606f82be5ff1d00bdabbc0432f3c0f8",
  patents: "25c45db47392d73cff2aecda0bb03386",
  progress_entries: "20ee56f0c08e54c12e037a3e38ddb518",
  opening_state: "f281da5c76f13f4c7af96764bacd1090",
}

const QUERIES: Record<keyof typeof SOURCE, string> = {
  trademarks: `SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS d FROM (
    SELECT id||'|'||name||'|'||name_ko||'|'||array_to_string(classes,',')||'|'||coalesce(goods,'')||'|'||coalesce(app_no,'')||'|'||coalesce(reg_no,'')||'|'||coalesce(ref_date::text,'')||'|'||coalesce(filed_on::text,'')||'|'||coalesce(registered_on::text,'')||'|'||coalesce(holder,'')||'|'||status||'|'||coalesce(probability::text,'')||'|'||note AS x FROM ip.trademarks) a`,
  patents: `SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS d FROM (
    SELECT id||'|'||title||'|'||coalesce(app_no,'')||'|'||coalesce(reg_no,'')||'|'||coalesce(ref_date::text,'')||'|'||coalesce(filed_on::text,'')||'|'||coalesce(registered_on::text,'')||'|'||applicant||'|'||status||'|'||note AS x FROM ip.patents) b`,
  progress_entries: `SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS d FROM (
    SELECT id::text||'|'||occurred_on::text||'|'||entity_kind||'|'||entity_id||'|'||stage||'|'||coalesce(direction,'')||'|'||counterpart||'|'||next_turn||'|'||coalesce(due_on::text,'')||'|'||coalesce(app_no,'')||'|'||coalesce(reg_no,'')||'|'||coalesce(probability::text,'')||'|'||coalesce(name,'')||'|'||coalesce(holder,'')||'|'||note||'|'||source||'|'||coalesce(raw,'') AS x FROM ip.progress_entries) c`,
  opening_state: `SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS d FROM (
    SELECT entity_kind||'|'||entity_id||'|'||stage||'|'||coalesce(ref_date::text,'')||'|'||name||'|'||coalesce(holder,'')||'|'||coalesce(app_no,'')||'|'||coalesce(reg_no,'')||'|'||note||'|'||source_note AS x FROM ip.opening_state) d`,
}

async function main() {
  let failed = 0
  console.log("\n원본 대조 (md5)")
  for (const [table, want] of Object.entries(SOURCE) as [keyof typeof SOURCE, string][]) {
    const rows = await prisma.$queryRawUnsafe<{ d: string }[]>(QUERIES[table])
    const got = rows[0].d
    if (got === want) {
      console.log(`  ✓ ip.${table}`)
    } else {
      failed++
      console.log(`  ✗ ip.${table}\n      원본: ${want}\n      현재: ${got}`)
    }
  }
  console.log(failed === 0 ? "\n통과: 원본과 값이 같다\n" : `\n실패: ${failed}개 표가 다르다\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
