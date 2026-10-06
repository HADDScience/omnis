// 연혁 제안의 결정적인 규칙 — 같은 사건 판별 · 정확도 · 자동 전환 · 대외비 표기.
//   npx tsx scripts/verify-record-proposals.ts
import { isSameEvent, typeStats, canAutoApply, recordInputFrom, type Decision } from "../lib/record-proposals"

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}
const d = (s: string) => new Date(`${s}T00:00:00Z`)

console.log("── 같은 사건")
check("같은 날 같은 제목", isSameEvent({ title: "GBSA 아카데미 우수사례 공모전 최우수상", date: d("2026-06-17") }, { title: "GBSA 아카데미 우수사례 공모전 최우수상 수상", date: d("2026-06-17") }), true)
check("5일 차 · 띄어쓰기 다름", isSameEvent({ title: "수원대 바이오청년창업인턴십 업무협약", date: d("2025-09-19") }, { title: "수원대학교 바이오 청년창업 인턴십 업무 협약 체결", date: d("2025-09-24") }), true)
check("대외비 접두어는 무시", isSameEvent({ title: "인비트로큐 업무협약(MOU) 체결", date: d("2026-08-18") }, { title: "[내부용·대외비] 인비트로큐(Invitrocue) 업무협약(MOU) 체결", date: d("2026-08-18") }), true)
// 거부되어야 하는 것
check("거부: 8일 차이", isSameEvent({ title: "GBSA 우수사례 공모전 최우수상", date: d("2026-06-17") }, { title: "GBSA 우수사례 공모전 최우수상", date: d("2026-06-25") }), false)
check("거부: 같은 날 다른 사건", isSameEvent({ title: "AI바이오 현장점검", date: d("2026-08-25") }, { title: "발명특허대전 출품 신청", date: d("2026-08-25") }), false)
check("거부: 날짜 없는 옛 연혁이 비슷한 정도로는 막지 않는다", isSameEvent({ title: "2026 바이오 박람회 부스 운영", date: d("2026-09-11") }, { title: "바이오 박람회 참석", date: null }), false)

console.log("── 정확도 · 자동 전환")
const many = (n: number, x: Partial<Decision>): Decision[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "FORUM", grade: "GENERAL", status: "ACCEPTED", edited: false, revertedAt: null, decidedAt: new Date(Date.UTC(2026, 0, 1 + i)), ...x }))
const ok20 = typeStats(many(20, {}))[0]
check("20건 전부 원안 채택 → 자동", [ok20.decided, ok20.rate, ok20.streak, ok20.auto], [20, 1, 20, true])
const s19 = typeStats(many(19, {}))[0]
check("거부: 19건이면 아직", s19.auto, false)
const mixed = typeStats([...many(18, {}), ...many(2, { status: "REJECTED", decidedAt: new Date(Date.UTC(2025, 0, 1)) })])[0]
check("20건 중 18건(90%) → 자동", [mixed.rate, mixed.auto], [0.9, true])
const low = typeStats([...many(17, {}), ...many(3, { status: "REJECTED", decidedAt: new Date(Date.UTC(2025, 0, 1)) })])[0]
check("거부: 85% 면 아직", low.auto, false)
const brokenStreak = typeStats([...many(19, { decidedAt: new Date(Date.UTC(2025, 0, 1)) }), { kind: "FORUM", grade: "GENERAL", status: "ACCEPTED", edited: true, revertedAt: null, decidedAt: new Date(Date.UTC(2027, 0, 1)) }])[0]
check("거부: 가장 최근이 수정 채택이면 연속이 끊긴다", [brokenStreak.streak, brokenStreak.auto], [0, false])
const reverted = typeStats([...many(20, {}), { kind: "FORUM", grade: "GENERAL", status: "AUTO_APPLIED", edited: false, revertedAt: new Date(Date.UTC(2027, 0, 1)), decidedAt: new Date(Date.UTC(2026, 11, 1)) }])[0]
check("거부: 자동 등록을 되돌리면 연속이 끊긴다", [reverted.decided, reverted.streak, reverted.auto], [21, 0, false])
const autoOnly = typeStats(many(30, { status: "AUTO_APPLIED" }))
check("되돌리지 않은 자동 등록은 사람 판단으로 세지 않는다", autoOnly[0].decided, 0)
const major = typeStats(many(30, { grade: "MAJOR" }))[0]
check("거부: 주요 등급은 아무리 맞아도 자동이 아니다", major.auto, false)
check("자동 유형의 일반 · 공개 제안 → 자동 등록", canAutoApply({ kind: "FORUM", grade: "GENERAL", confidential: false }, [ok20]), true)
check("거부: 같은 유형이라도 대외비면 사람이 본다", canAutoApply({ kind: "FORUM", grade: "GENERAL", confidential: true }, [ok20]), false)
check("거부: 다른 종류는 그 종류 기록으로", canAutoApply({ kind: "EDUCATION", grade: "GENERAL", confidential: false }, [ok20]), false)

console.log("── 연혁 한 줄")
const today = d("2026-10-06")
const conf = recordInputFrom({ kind: "MILESTONE", grade: "MAJOR", confidential: true, title: "인비트로큐 업무협약(MOU) 체결", occurredOn: d("2026-08-18"), periodRaw: null, organizer: null }, { auto: false, today })
check("대외비: 제목 접두어", conf.title, "[내부용·대외비] 인비트로큐 업무협약(MOU) 체결")
check("대외비: 공개범위 · 비고", [conf.visibility, conf.note.includes("외부 자료 사용 금지")], ["INTERNAL", true])
check("주요 등급 → 분류 「주요」", conf.category, "주요")
const twice = recordInputFrom({ kind: "MILESTONE", grade: "MAJOR", confidential: true, title: "[내부용·대외비] 이미 붙은 것", occurredOn: null, periodRaw: null, organizer: null }, { auto: false, today })
check("거부: 접두어를 두 번 붙이지 않는다", twice.title, "[내부용·대외비] 이미 붙은 것")
const future = recordInputFrom({ kind: "EXHIBITION", grade: "GENERAL", confidential: false, title: "발명특허대전 출품", occurredOn: d("2026-12-02"), periodRaw: "2026.12.02~12.05", organizer: null }, { auto: true, today })
check("앞날 사건 → 상태 계획 · 자동 등록 표기 · 공개", [future.status, future.note.includes("자동 등록"), future.visibility, future.category], ["계획", true, "PUBLIC", null])

console.log(fail === 0 ? "\n전부 통과" : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
