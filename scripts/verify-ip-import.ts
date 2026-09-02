/**
 * 옮겨 온 ip 스키마가 원본과 같은지 확인한다.
 *
 *   TARGET_DB="<접속문자열>" npx tsx scripts/verify-ip-import.ts
 *
 * 핵심은 마지막 검사다. rebuild_ledger() 는 출발선(opening_state)에서 시작해 진행
 * 기록을 순서대로 다시 밟아 상표·특허 대장을 처음부터 계산한다. 그 결과가 지금
 * 대장과 한 칸도 다르지 않다면, 옮겨 온 plpgsql 이 원본과 같은 규칙으로 돌고
 * 데이터도 온전하다는 뜻이다. 행 수만 세는 것보다 훨씬 강한 확인이다.
 */
import { PrismaClient } from "../generated/prisma"

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TARGET_DB } },
})

/** Supabase 원본에서 센 행 수 (2026-09-02 기준) */
const EXPECTED: Record<string, number> = {
  status_options: 24,
  members: 2,
  trademarks: 16,
  patents: 11,
  opening_state: 27,
  progress_entries: 95,
  communications: 0,
  communication_links: 0,
  actions: 0,
  integrity_flags: 2,
  org_meta: 1,
  member_prefs: 1,
  audit_log: 876,
}

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

async function count(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM ip.${table}`
  )
  return Number(rows[0].n)
}

/** 대장의 모든 칸을 한 줄 문자열로 — 비교하기 좋게. */
async function ledgerSnapshot(): Promise<string> {
  const tm = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, name, status, ref_date, holder, app_no, reg_no, filed_on, registered_on, probability
       FROM ip.trademarks ORDER BY id`
  )
  const pt = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, title, status, ref_date, applicant, app_no, reg_no, filed_on, registered_on
       FROM ip.patents ORDER BY id`
  )
  return JSON.stringify({ tm, pt })
}

async function main() {
  console.log("\n[1] 행 수")
  for (const [table, want] of Object.entries(EXPECTED)) {
    const got = await count(table)
    check(`ip.${table}: ${want}행`, got === want, `실제 ${got}행`)
  }

  console.log("\n[2] 사용자 연결")
  const members = await prisma.$queryRawUnsafe<
    { email: string; role: string; omnis_name: string | null }[]
  >(
    `SELECT m.email, m.role, u.name AS omnis_name
       FROM ip.members m LEFT JOIN public."User" u ON u.id = m.user_id
      ORDER BY m.email`
  )
  check("구성원 2명이 모두 Omnis 계정에 연결됐다", members.every((m) => m.omnis_name !== null))
  for (const m of members) console.log(`      ${m.email} → ${m.omnis_name} (${m.role})`)

  const orphan = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM ip.member_prefs p
      LEFT JOIN public."User" u ON u.id = p.user_id WHERE u.id IS NULL`
  )
  check("화면 설정이 없는 사람을 가리키지 않는다", Number(orphan[0].n) === 0)

  console.log("\n[3] 참조 무결성")
  const badStage = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM ip.progress_entries pe
      LEFT JOIN ip.status_options s ON s.kind = pe.entity_kind AND s.value = pe.stage
      WHERE s.value IS NULL`
  )
  check("모든 진행 기록의 단계가 정의된 단계다", Number(badStage[0].n) === 0)

  const orphanEntry = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM ip.progress_entries pe
      WHERE (pe.entity_kind = 'trademark' AND NOT EXISTS (SELECT 1 FROM ip.trademarks t WHERE t.id = pe.entity_id))
         OR (pe.entity_kind = 'patent'    AND NOT EXISTS (SELECT 1 FROM ip.patents p    WHERE p.id = pe.entity_id))`
  )
  check("진행 기록이 없는 건을 가리키지 않는다", Number(orphanEntry[0].n) === 0)

  console.log("\n[4] 이식한 plpgsql 이 원본과 같은 대장을 만드는가")
  const before = await ledgerSnapshot()
  const rebuilt = await prisma.$queryRawUnsafe<{ kind: string; id: string }[]>(
    `SELECT * FROM ip.rebuild_ledger()`
  )
  const after = await ledgerSnapshot()
  check(`rebuild_ledger 가 ${rebuilt.length}건을 다시 계산했다`, rebuilt.length > 0)
  check("다시 계산해도 대장이 그대로다 (한 칸도 바뀌지 않음)", before === after)

  if (before !== after) {
    const b = JSON.parse(before) as { tm: Record<string, unknown>[] }
    const a = JSON.parse(after) as { tm: Record<string, unknown>[] }
    for (let i = 0; i < b.tm.length; i++) {
      if (JSON.stringify(b.tm[i]) !== JSON.stringify(a.tm[i])) {
        console.log(`      이전: ${JSON.stringify(b.tm[i])}`)
        console.log(`      이후: ${JSON.stringify(a.tm[i])}`)
      }
    }
  }

  console.log("\n[5] 트리거가 다시 켜져 있는가")
  const triggers = await prisma.$queryRawUnsafe<{ tgname: string; enabled: string }[]>(
    `SELECT t.tgname, t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ip' AND NOT t.tgisinternal ORDER BY t.tgname`
  )
  check(`트리거 ${triggers.length}개가 모두 켜져 있다`, triggers.every((t) => t.enabled === "O"))

  console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
