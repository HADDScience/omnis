/**
 * 카톡 이식의 수기 사본 짝 맞추기 · 제외 목록 검증 — 걸러야 하는 경우와 거르면 안 되는 경우.
 *
 *   npx tsx scripts/verify-kakao-hand-copies.ts
 *
 * DB 를 쓰지 않는다. import-tools/hand-copies.ts · redaction.ts 의 순수 함수만 부른다.
 */
import { matchHandCopies, normalizeForCopy, type CopySide, type KakaoSide } from "../import-tools/hand-copies"
import { dropExcluded } from "../import-tools/redaction"
import { messageSourceId } from "../import-tools/kakao-common"

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const at = (s: string) => new Date(`${s}:00+09:00`)
const k = (id: string, authorId: string, content: string, t: string): KakaoSide => ({ sourceId: id, authorId, content, createdAt: at(t) })
const c = (id: string, authorId: string, content: string, t: string): CopySide => ({ id, authorId, content, createdAt: at(t) })
const skipped = (kakao: KakaoSide[], copies: CopySide[]) => [...matchHandCopies(kakao, copies).skip].sort().join(",")

console.log("정규화")
check("앞의 /업무 · @이름 을 뗀다", normalizeForCopy("/업무 @담당자 샘플 정리해줘요") === "샘플정리해줘요")
check("앞의 #슬러그 와 끝의 첨부 표시를 뗀다", normalizeForCopy("#샘플-업무 글씨를 키워주세요 [첨부: image.png]") === "글씨를키워주세요")
check("본문 가운데의 #·@ 는 남긴다", normalizeForCopy("이건 @담당자 님께 #급함") === "이건@담당자님께#급함")

console.log("짝이 맞아야 하는 경우")
check("같은 사람 · 같은 본문 · 사본이 뒤", skipped([k("a", "u1", "네 검토할 내용 올려주세요", "2026-09-23T14:12")], [c("x", "u1", "네 검토할 내용 올려주세요", "2026-09-23T15:49")]) === "a")
check("옮기며 /업무 @이름 을 붙여도", skipped([k("a", "u1", "샘플 정리해주세요", "2026-09-15T16:50")], [c("x", "u1", "/업무 @담당자 샘플 정리해주세요", "2026-09-15T17:10")]) === "a")
check("줄바꿈·공백이 달라도", skipped([k("a", "u1", "1. 모으기\n2. 거르기", "2026-09-15T17:51")], [c("x", "u1", "1. 모으기 2. 거르기", "2026-09-15T17:51")]) === "a")
check("카톡 두 줄을 한 글로 합친 사본 — 둘 다", skipped([k("a", "u1", "회의 자료입니다! ", "2026-09-23T14:12"), k("b", "u1", "검토 후 의견 주세요~~", "2026-09-23T14:12")], [c("x", "u1", "회의 자료입니다!  검토 후 의견 주세요~~", "2026-09-23T15:49")]) === "a,b")
check("사본이 카톡 긴 글의 앞부분만", skipped([k("a", "u1", "거래처에 샘플을 만들어 보내는 일정에 대해서", "2026-09-23T14:14")], [c("x", "u1", "거래처에 샘플을 만들어", "2026-09-23T15:49")]) === "a")
check("후보가 여럿이면 가장 가까운 것", skipped([k("a", "u1", "네", "2026-09-20T10:00"), k("b", "u1", "네", "2026-09-23T14:00")], [c("x", "u1", "네", "2026-09-23T15:00")]) === "b")

console.log("짝이 맞으면 안 되는 경우")
check("다른 사람", skipped([k("a", "u1", "네 알겠습니다", "2026-09-23T14:12")], [c("x", "u2", "네 알겠습니다", "2026-09-23T15:49")]) === "")
check("사본이 카톡보다 앞섬", skipped([k("a", "u1", "넵 알겠습니다", "2026-10-01T09:08")], [c("x", "u1", "넵 알겠습니다", "2026-09-23T15:49")]) === "")
check("사흘을 넘김", skipped([k("a", "u1", "넵", "2026-09-10T09:00")], [c("x", "u1", "넵", "2026-09-13T09:01")]) === "")
check("본문이 다름", skipped([k("a", "u1", "넵 알겠습니다", "2026-09-23T14:12")], [c("x", "u1", "넵 알겠습니다!", "2026-09-23T15:49")]) === "")
check("짧은 말은 긴 사본 안에 있어도 짝이 아님", skipped([k("a", "u1", "감사합니다!", "2026-09-23T14:00")], [c("x", "u1", "자료 올렸습니다 감사합니다! 확인 부탁드려요", "2026-09-23T15:00")]) === "")
check("포함이어도 다른 사람이면 아님", skipped([k("a", "u2", "검토 후 의견 주세요~~", "2026-09-23T14:12")], [c("x", "u1", "회의 자료입니다! 검토 후 의견 주세요~~", "2026-09-23T15:49")]) === "")
check("사본 하나에 카톡 둘 — 하나만", skipped([k("a", "u1", "네", "2026-09-23T14:00"), k("b", "u1", "네", "2026-09-23T14:01")], [c("x", "u1", "네", "2026-09-23T15:00")]) === "b")
check("빈 본문(첨부 표시뿐)은 짝짓지 않음", skipped([k("a", "u1", "[첨부: a.png]", "2026-09-23T14:00")], [c("x", "u1", "[첨부: a.png]", "2026-09-23T15:00")]) === "")
const { unmatched } = matchHandCopies([k("a", "u1", "네", "2026-09-23T14:00")], [c("x", "u1", "네", "2026-09-23T15:00"), c("y", "u1", "네", "2026-09-23T15:01")])
check("같은 사본이 두 번이면 하나는 짝 없음으로 보고", unmatched.map((u) => u.id).join(",") === "y")

console.log("제외 목록")
const room = "하드사이언스 인턴방"
const m1 = { t: "2026-09-16 13:24:00", u: "직원A", m: "맥은 어떤 칩이에요?" }
const m2 = { t: "2026-09-16 13:25:00", u: "직원A", m: "이 줄은 빼 주세요" }
const m3 = { t: "2026-09-30 14:34:00", u: "직원A", m: "주말에 여행 갈 예정이에요" }
const sessions = [
  { id: "s1", room, start: m1.t, end: m2.t, n: 2, msgs: [m1, m2] },
  { id: "s2", room, start: m3.t, end: m3.t, n: 1, msgs: [m3] },
]
const ex = (...ms: typeof m1[]) => ms.map((m) => ({ key: messageSourceId(room, m), cat: "T", reason: "" }))
const r1 = dropExcluded(sessions, ex(m2, m3))
check("목록의 줄만 빠지고 같은 세션의 다른 줄은 남음", r1.sessions[0]?.msgs.length === 1 && r1.sessions[0].msgs[0] === m1)
check("줄이 빠져도 세션 id 는 그대로", r1.sessions[0]?.id === "s1" && r1.sessions[0].start === m1.t)
check("다 빠진 세션은 버림", r1.sessions.length === 1 && r1.dropped === 2)
check("같은 방·시각이라도 본문이 다르면 빼지 않음", dropExcluded(sessions, ex({ ...m2, m: m2.m + "!" })).dropped === 0)
check("다른 방의 같은 말은 빼지 않음", dropExcluded([{ ...sessions[0], room: "HADD-수원대" }], ex(m2)).dropped === 0)
check("목록이 비면 그대로", dropExcluded(sessions, []).dropped === 0)

console.log(`\n${passed} 통과 · ${failed} 실패`)
process.exit(failed ? 1 : 0)
