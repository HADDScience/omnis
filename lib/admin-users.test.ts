import { test } from "node:test"
import assert from "node:assert/strict"
import { accountLock, maskEmail, onboardingRow, onboardingTargetVersion, toAdminUserRow } from "./admin-users"
import { needsOnboarding } from "./onboarding-version"

const limits = { max: 5, windowMs: 15 * 60_000 }
const now = Date.parse("2026-11-13T03:00:00Z")
const ago = (min: number) => new Date(now - min * 60_000)
const fails = (key: string, mins: number[]) => mins.map((m) => ({ entityId: key, action: "fail", createdAt: ago(m) }))

test("메일 가리기 — 앞 두 글자 · 도메인만 남는다", () => {
  assert.equal(maskEmail("jwoochang@haddscience.com"), "jw•••••••@haddscience.com")
  assert.equal(maskEmail("ab@x.com"), "a•••@x.com")
  assert.equal(maskEmail("a@x.com"), "a•••@x.com")
  assert.equal(maskEmail("  "), null)
  assert.equal(maskEmail(null), null)
  assert.equal(maskEmail("noatsign"), "•••")
  assert.equal(maskEmail("@x.com"), "•••")
})

test("창 안 실패 5번이면 잠김 — 가장 오래된 실패가 창을 벗어날 때 풀린다", () => {
  const lock = accountLock(fails("k", [1, 2, 3, 4, 5]), ["k"], now, limits)
  assert.deepEqual(lock, { locked: true, until: ago(5).getTime() + limits.windowMs })
})

test("4번이면 안 잠김 · 다른 사람 키의 실패는 세지 않는다", () => {
  assert.deepEqual(accountLock(fails("k", [1, 2, 3, 4]), ["k"], now, limits), { locked: false, fails: 4 })
  assert.deepEqual(accountLock(fails("other", [1, 2, 3, 4, 5]), ["k"], now, limits), { locked: false, fails: 0 })
})

test("잠금 해제(unlock) · 로그인 성공(ok) 뒤로는 다시 센다", () => {
  for (const action of ["unlock", "ok"]) {
    const rows = [...fails("k", [5, 6, 7, 8, 9]), { entityId: "k", action, createdAt: ago(4) }]
    assert.deepEqual(accountLock(rows, ["k"], now, limits), { locked: false, fails: 0 }, action)
    // 해제 뒤 다시 다섯 번 틀리면 또 잠긴다
    assert.equal(accountLock([...rows, ...fails("k", [0.5, 1, 1.5, 2, 3])], ["k"], now, limits).locked, true)
  }
})

test("이름 · 메일 키 중 하나라도 잠기면 잠김", () => {
  const rows = [...fails("mail", [1, 2, 3, 4, 5]), ...fails("name", [1])]
  assert.equal(accountLock(rows, ["name", "mail"], now, limits).locked, true)
})

test("창 밖 실패는 세지 않는다", () => {
  assert.deepEqual(accountLock(fails("k", [16, 17, 18, 19, 20]), ["k"], now, limits), { locked: false, fails: 0 })
})

test("내보내는 모양에 비밀번호 · 해시 · 원래 메일이 들어가지 않는다", () => {
  const row = toAdminUserRow(
    { id: "u1", name: "사원1", email: "staff1@haddscience.com", role: "MEMBER", isActive: true, passwordHash: "$2a$10$secret", password: "pw", code: "123456" },
    { lastLoginAt: new Date(now), social: ["kakao", "google"], tempPassword: true, lock: { locked: false, fails: 0 }, onboarding: { seen: 2, status: "seen", lastSeenAt: null } },
  )
  assert.deepEqual(Object.keys(row).sort(), ["id", "isActive", "lastLoginAt", "lock", "maskedEmail", "name", "onboarding", "role", "social", "tempPassword"])
  const json = JSON.stringify(row)
  for (const leak of ["$2a$10$secret", "\"pw\"", "123456", "staff1@", "passwordHash"]) assert.ok(!json.includes(leak), leak)
  assert.deepEqual(row.social, ["google", "kakao"])
  assert.equal(row.maskedEmail, "st••••@haddscience.com")
})

test("모르는 역할 값은 구성원으로 내보낸다", () => {
  const row = toAdminUserRow({ id: "u", name: "n", email: null, role: "admin", isActive: false }, { lastLoginAt: null, social: [], tempPassword: false, lock: { locked: false, fails: 0 }, onboarding: { seen: 0, status: "never", lastSeenAt: null } })
  assert.equal(row.role, "MEMBER")
  assert.equal(row.lastLoginAt, null)
})

test("온보딩 상태 — 봤음 · 다시 뜰 예정 · 안 봄", () => {
  const t = new Date(now)
  assert.deepEqual(onboardingRow({ onboardingVersion: 3, onboardingCompletedAt: t }, 3, t), { seen: 3, status: "seen", lastSeenAt: t.toISOString() })
  assert.equal(onboardingRow({ onboardingVersion: 2, onboardingCompletedAt: t }, 3, null).status, "due")
  // 판 칸이 생기기 전에 마친 사람은 1판을 본 것
  assert.deepEqual(onboardingRow({ onboardingVersion: null, onboardingCompletedAt: t }, 3, null), { seen: 1, status: "due", lastSeenAt: null })
  assert.equal(onboardingRow({ onboardingVersion: null, onboardingCompletedAt: null }, 3, null).status, "never")
  // 한 번도 안 본 사람이라도 관리자가 판을 적어 두면 「다시 뜰 예정」(다음 화면에 뜬다)
  assert.equal(onboardingRow({ onboardingVersion: 2, onboardingCompletedAt: null }, 3, null).status, "due")
  assert.equal(onboardingRow({ onboardingVersion: 0, onboardingCompletedAt: null }, 3, null).status, "never")
})

test("다시 띄우기는 다음 화면에 뜨게, 끄기는 이번 판을 본 것으로", () => {
  for (const current of [1, 2, 5]) {
    const replay = onboardingTargetVersion("replay", current)
    const dismiss = onboardingTargetVersion("dismiss", current)
    assert.equal(needsOnboarding({ onboardingVersion: replay, onboardingCompletedAt: new Date(now) }, current), true)
    assert.equal(needsOnboarding({ onboardingVersion: dismiss, onboardingCompletedAt: null }, current), false)
    assert.ok(replay >= 0)
  }
})
