/**
 * 인증 탭(아카이브 › 인증) — 단계 · 준비물 · 근거 · 공고 가점 거꾸로 묶기, 그리고 마이그레이션 · 도구 정의와의 대조.
 * 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Prisma } from "@/generated/prisma/client"
import {
  CERT_FIELDS,
  LEGACY_STAGE,
  bonusForCert,
  evidenceHref,
  normalizeChecklist,
  normalizeEvidence,
  readChecklist,
  readEvidence,
} from "./certs"
import { CERT_STAGES, CERT_STAGE_LABEL, parseSeoulMinute, seoulMinute } from "./grants-labels"
import { staleFields } from "./grants-expect"
import { stateOf } from "./grant-bonus"
import { CERT_STAGE } from "./tools/defs-grants"

const MIGRATION = readFileSync(join(process.cwd(), "prisma/migrations/20261128100000_cert_stages/migration.sql"), "utf8")
const ROLLBACK = readFileSync(join(process.cwd(), "prisma/rollbacks/20261128100000_cert_stages.down.sql"), "utf8")
const sql = MIGRATION.replace(/--.*$/gm, "")

// ─── 단계 ───

test("단계 여덟 — 순서 · 이름표", () => {
  assert.deepEqual(CERT_STAGES, ["CANDIDATE", "PREPARING", "APPLIED", "REVIEWING", "HELD", "RENEWAL_DUE", "EXPIRED", "STOPPED"])
  assert.deepEqual(CERT_STAGES.map((s) => CERT_STAGE_LABEL[s]), ["후보", "준비", "신청", "심사 중", "보유", "갱신 필요", "만료", "중단"])
})

test("마이그레이션 CHECK · 도구 enum 이 단계 목록과 같다", () => {
  const check = /"CompanyCertification_status_check"\s+CHECK \("status" IN \(([^)]*)\)\)/.exec(MIGRATION)
  assert.ok(check)
  assert.deepEqual([...check[1].matchAll(/'(\w+)'/g)].map((m) => m[1]), [...CERT_STAGES])
  assert.deepEqual([...CERT_STAGE.enum], [...CERT_STAGES])
})

test("옛 상태 → 새 단계 — 마이그레이션이 하는 일과 같다(NOT_ELIGIBLE 만 옮기고 사유를 단다)", () => {
  for (const [old, { stage, reason }] of Object.entries(LEGACY_STAGE)) {
    if (old === stage) {
      assert.equal(reason, null, old)
      continue
    }
    assert.equal(old, "NOT_ELIGIBLE")
    assert.equal(stage, "STOPPED")
    assert.equal(reason, "자격 안 됨")
    assert.match(sql, /SET\s+"stageReason" = coalesce\(\s*"stageReason",\s*'자격 안 됨'/)
    assert.match(sql, /"status" = 'STOPPED'\s+WHERE "status" = 'NOT_ELIGIBLE';/)
  }
  // 옮기기 전에 활동 기록 — 사람 고침과 다른 action
  const log = sql.indexOf("company.certification.stage_migrated")
  const move = sql.indexOf(`"status" = 'STOPPED'`)
  assert.ok(log > 0 && log < move)
  assert.ok(!sql.includes("'company.certification.updated'"))
})

test("마이그레이션은 다시 돌려도 된다 · 잠금은 오래 기다리지 않는다", () => {
  for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/g)) assert.fail(`IF NOT EXISTS 없는 CREATE: ${m[0]}`)
  for (const m of sql.matchAll(/ADD COLUMN\s+(?!IF NOT EXISTS)/g)) assert.fail(`IF NOT EXISTS 없는 ADD COLUMN: ${m[0]}`)
  for (const [, t, c] of sql.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)"/g))
    assert.ok(sql.includes(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${c}"`), c)
  assert.match(sql, /DROP TYPE IF EXISTS "CertStatus";/)
  assert.match(sql, /^SET lock_timeout = '5s';$/m)
  // 칼럼을 지우지 않는다(값을 잃는다) — 타입만 바꾼다
  assert.doesNotMatch(sql, /DROP COLUMN/)
  assert.match(sql, /ALTER COLUMN "status" TYPE TEXT USING "status"::text/)
})

test("되돌리기 — 옛 enum 으로 접고 새 칸을 지운 뒤 기록 줄을 지운다", () => {
  assert.match(ROLLBACK, /SET "status" = 'CANDIDATE' WHERE "status" IN \('PREPARING', 'APPLIED', 'REVIEWING'\);/)
  assert.match(ROLLBACK, /SET "status" = 'NOT_ELIGIBLE' WHERE "status" = 'STOPPED'/)
  for (const c of ["stageReason", "deadline", "ownerId", "checklist", "evidence"]) assert.match(ROLLBACK, new RegExp(`DROP COLUMN IF EXISTS "${c}"`), c)
  assert.match(ROLLBACK, /DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261128100000_cert_stages';/)
})

test("칸 키(공통 층 등록용)의 칼럼이 Prisma 모델에 있다", () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "CompanyCertification")!
  for (const [key, f] of Object.entries(CERT_FIELDS)) assert.ok(model.fields.some((x) => x.name === f.column), `${key} → ${f.column}`)
  for (const key of Object.keys(CERT_FIELDS)) assert.match(key, /^[a-z][a-z0-9_]{1,39}$/)
})

// ─── 가점 상태 ───

test("가점 매칭의 우리 상태 — 보유 계열만 인정, 진행 · 중단은 없음", () => {
  const ref = new Date("2026-12-10T00:00:00+09:00")
  const c = (status: string, validUntil: string | null = null) => ({ id: "x", name: "x", officialName: null, status, validUntil })
  assert.equal(stateOf(c("HELD"), ref).state, "held")
  assert.equal(stateOf(c("RENEWAL_DUE"), ref).state, "expired")
  for (const s of ["CANDIDATE", "PREPARING", "APPLIED", "REVIEWING", "STOPPED"]) assert.equal(stateOf(c(s), ref).state, "none", s)
  assert.equal(stateOf(c("REVIEWING"), ref).note, "심사 중")
  assert.equal(stateOf(c("CANDIDATE"), ref).note, "취득 후보")
  assert.equal(stateOf({ ...c("STOPPED"), stageReason: "자격 안 됨 — 업력 3년 미만" }, ref).note, "자격 안 됨")
  assert.equal(stateOf(c("STOPPED"), ref).note, "중단")
})

// ─── 준비물 ───

test("준비물 — 빈 줄 버림 · id 붙임 · 겹친 id 새로 · 글만 받아도 된다", () => {
  const r = normalizeChecklist([{ text: " 품질경영체제 자료 " }, "공인시험성적서", { id: "a", text: "x" }, { id: "a", text: "y", done: true }, { text: "  " }])
  assert.ok(Array.isArray(r))
  assert.deepEqual(r.map((x) => [x.text, x.done]), [["품질경영체제 자료", false], ["공인시험성적서", false], ["x", false], ["y", true]])
  assert.equal(new Set(r.map((x) => x.id)).size, 4)
  assert.equal(normalizeChecklist("x"), "준비물은 목록이어야 합니다")
  assert.match(String(normalizeChecklist([{ text: "x".repeat(201) }])), /200자/)
  assert.match(String(normalizeChecklist(Array(41).fill("a"))), /40개/)
  assert.match(String(normalizeChecklist([{ done: true }])), /글이 있어야/)
  assert.deepEqual(readChecklist([{ text: "a", done: true }, { bad: 1 }, null]), [{ id: "c0", text: "a", done: true }])
})

// ─── 근거 ───

test("근거 — 채팅 글 · 파일 · 링크, 같은 것은 한 번, 모양이 틀리면 거절", () => {
  const r = normalizeEvidence([
    { kind: "message", ref: "msg_123456", roomId: "room_1234", label: "인턴방 · 11/27 13:51", at: "2026-11-27T04:51:00Z" },
    { kind: "file", ref: "file_abcdef", label: "NEP 자격 검토.pdf" },
    { kind: "url", ref: "https://www.koat.or.kr/", label: "" },
    { kind: "url", ref: "https://www.koat.or.kr/" },
  ])
  assert.ok(Array.isArray(r))
  assert.equal(r.length, 3)
  assert.equal(r[2].label, "www.koat.or.kr/")
  assert.deepEqual(evidenceHref(r[0]), { href: "/chat/room_1234", external: false })
  assert.deepEqual(evidenceHref(r[1]), { href: "/api/files/file_abcdef", external: false })
  assert.deepEqual(evidenceHref(r[2]), { href: "https://www.koat.or.kr/", external: true })
  assert.match(String(normalizeEvidence([{ kind: "url", ref: "javascript:alert(1)" }])), /http/)
  assert.match(String(normalizeEvidence([{ kind: "message", ref: "msg_123456" }])), /방 id/)
  assert.match(String(normalizeEvidence([{ kind: "note", ref: "x" }])), /종류/)
  assert.equal(readEvidence([{ kind: "url", ref: "ftp://x" }, { kind: "file", ref: "file_abcdef" }]).length, 1)
})

// ─── 접수 마감 · 충돌 확인 ───

test("접수 마감 — 서울 시각, 날짜만이면 23:59, 같은 분이면 충돌 아님", () => {
  assert.equal(seoulMinute(parseSeoulMinute("2026-12-18 16:00")), "2026-12-18 16:00")
  assert.equal(seoulMinute(parseSeoulMinute("2026-12-18T16:00")), "2026-12-18 16:00")
  assert.equal(seoulMinute(parseSeoulMinute("2026-12-18")), "2026-12-18 23:59")
  assert.equal(parseSeoulMinute(""), null)
  assert.equal(parseSeoulMinute("12/18"), undefined)
  const kinds = { deadline: "minute", checklist: "json" } as const
  const cur = { deadline: new Date("2026-12-18T07:00:00Z"), checklist: [{ id: "a", text: "x", done: false }] }
  assert.deepEqual(staleFields({ deadline: "2026-12-18 16:00", checklist: [{ done: false, text: "x", id: "a" }] }, cur, kinds), [])
  assert.deepEqual(staleFields({ deadline: "2026-12-18 15:00", checklist: [] }, cur, kinds), ["deadline", "checklist"])
})

// ─── 공고 가점 거꾸로 ───

const notice = (id: string, title: string, deadline: string | null, items: { label: string; points: number | null; pointsText?: string }[]) => ({
  id,
  title,
  deadlineAt: deadline,
  bonusStatus: "ok",
  bonusItems: items.map((i) => ({ ...i, pointsText: i.pointsText ?? null, condition: null, quote: `${i.label} 가점`, source: "본문" })),
})
const REF = new Date("2026-11-28T00:00:00+09:00")

test("이 인증을 따면 — 같은 인증 키의 항목이 있는 접수 중 공고, 점 큰 순 · 마감 이른 순", () => {
  const notices = [
    notice("n1", "A 사업", "2026-12-20T18:00:00+09:00", [{ label: "신제품인증(NEP) 보유", points: 2 }, { label: "벤처기업", points: 1 }]),
    notice("n2", "B 사업", "2026-12-05T18:00:00+09:00", [{ label: "NEP 인증 기업", points: 3, pointsText: "3점" }]),
    notice("n3", "C 사업(지난)", "2026-11-01T18:00:00+09:00", [{ label: "신제품 인증", points: 5 }]),
    notice("n4", "D 사업", null, [{ label: "신기술인증(NET)", points: 2 }]),
    { ...notice("n5", "E 사업", null, [{ label: "신제품 인증", points: 1 }]), bonusStatus: "error" },
  ]
  const rows = bonusForCert({ name: "신제품 인증(NEP)", officialName: null }, notices, REF)
  assert.deepEqual(rows.map((r) => [r.noticeId, r.points]), [["n2", 3], ["n1", 2]])
  assert.equal(rows[1].items.length, 1, "벤처기업 항목은 이 인증이 아니다")
  assert.equal(rows[0].items[0].pointsLabel, "3점")
  // 키가 없는 인증은 이름이 통째로 들어 있을 때만
  const odd = bonusForCert({ name: "우수조달제품", officialName: null }, [notice("m", "F", null, [{ label: "우수조달제품 지정기업", points: 1 }])], REF)
  assert.equal(odd.length, 1)
  assert.equal(bonusForCert({ name: "조달", officialName: null }, [notice("m", "F", null, [{ label: "우수조달제품 지정기업", points: 1 }])], REF).length, 0)
})
