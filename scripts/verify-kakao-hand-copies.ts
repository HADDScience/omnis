/**
 * 카톡 이식의 수기 사본 짝 맞추기 · 제외 목록 · 휴대폰 txt 합치기 검증 — 걸러야 하는 경우와 거르면 안 되는 경우.
 *
 *   npx tsx scripts/verify-kakao-hand-copies.ts
 *
 * DB 를 쓰지 않는다. 마스터 합치기는 임시 폴더(KAKAO_DATA_DIR)에서 돌려 실제 원본을 건드리지 않는다 —
 * 그래서 kakao-common 을 부르기 전에 환경변수를 정하고 동적으로 불러온다.
 */
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { CopySide, KakaoSide } from "../import-tools/hand-copies"

process.env.KAKAO_DATA_DIR = mkdtempSync(join(tmpdir(), "kakao-verify-"))
const { matchHandCopies, normalizeForCopy } = await import("../import-tools/hand-copies")
const { dropExcluded } = await import("../import-tools/redaction")
const { messageSourceId, parseKakaoMobileTxt, mergeRawMessages, sameMessage } = await import("../import-tools/kakao-common")

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

console.log("휴대폰 txt")
const txt = join(process.env.KAKAO_DATA_DIR!, "Talk.txt")
writeFileSync(txt, [
  "\uFEFFTalk_2026.10.6 15:30-1.txt", "저장한 날짜 : 2026. 10. 6. 15:53", "", "",
  "2026년 10월 2일 금요일",
  "2026. 10. 2. 9:05: 직원A님이 들어왔습니다.",
  "2026. 10. 2. 9:05, 직원A : 사진",
  "2026. 10. 2. 9:06, 직원A : 사진 3장",
  "2026. 10. 2. 9:07, 직원B : 파일: 회의록.pdf",
  "2026. 10. 2. 9:08, 직원B : 첫 줄",
  "둘째 줄",
  "2026. 10. 2. 9:09, 직원A : 지운 글",
  "여러 줄 메시지가 삭제되었습니다.",
].join("\n"))
const mob = parseKakaoMobileTxt(txt, "테스트방")
check("시스템 알림·날짜 줄은 빼고 메시지만", mob.length === 5)
check("사진 → Photo · 사진 3장 → 3 photos · 파일: → File:", mob[0].m === "Photo" && mob[1].m === "3 photos" && mob[2].m === "File: 회의록.pdf")
check("시각은 분까지 + :00, 한 자리 시는 두 자리로", mob[0].t === "2026-10-02 09:05:00")
check("이어지는 줄은 앞 메시지에 붙음", mob[3].m === "첫 줄\n둘째 줄")
check("여러 줄 글의 삭제 표시도 PC 말로", mob[4].m === "지운 글\n여러 줄 The message has been deleted.")

console.log("같은 메시지인가")
check("멘션 표기만 다름", sameMessage("@주용석(데과21) 원본 파일 남아있나요?", "@주용석 원본 파일 남아있나요?"))
check("한쪽에만 삭제 표시", sameMessage("수정할 점 부탁드립니다!\nThe message has been deleted.", "수정할 점 부탁드립니다!"))
check("나중에 고친 글", sameMessage("우리 홈피니까 우리가 주인공 쓰자입장으로", "우리 홈피니까 주인공 입장으로 쓰자"))
check("사진 자리와 글은 다름", !sameMessage("Photo", "전에 기사인데, 참석에서 진행으로 바꿔주실수 있나요~~"))
check("사진 한 장과 사진 여러 장은 다름", !sameMessage("Photo", "3 photos"))
check("짧은 다른 말은 다름", !sameMessage("ㅇㅋ", "넵"))
check("파일과 그 설명 글은 다름", !sameMessage("File: 회의록.pdf", "회의록 작성한 파일입니다. 3쪽 참고해주세요"))

console.log("마스터 합치기 (임시 폴더)")
const pc = [
  { room: "테스트방", t: "2026-10-02 09:05:12", u: "직원A", m: "Photo" },
  { room: "테스트방", t: "2026-10-02 09:08:40", u: "직원B", m: "첫 줄\n둘째 줄" },
]
mergeRawMessages(pc)
const r2 = mergeRawMessages(mob)
check("PC 에 있는 줄은 휴대폰에서 다시 넣지 않음 — 빠진 3줄만", r2.added === 3)
// 휴대폰으로 채운 「3 photos」 하나 + 나중 PC CSV 에 같은 분의 「3 photos」 두 개(진짜로 두 번 보낸 것)
const pcLater = [
  { room: "테스트방", t: "2026-10-02 09:06:31", u: "직원A", m: "3 photos" },
  { room: "테스트방", t: "2026-10-02 09:06:50", u: "직원A", m: "3 photos" },
]
const r3 = mergeRawMessages(pcLater)
check("휴대폰으로 채운 줄이 나중에 PC 에서 초까지 붙어 와도 다시 넣지 않음 — 하나는 그 줄, 하나는 새 메시지", r3.added === 1 && r3.sameAsMobile === 1)
const r4 = mergeRawMessages(pcLater)
check("같은 PC CSV 를 다시 주면 0건", r4.added === 0)
const r5 = mergeRawMessages(mob)
check("같은 휴대폰 txt 를 두 번 주면 두 번째는 0건", r5.added === 0)

console.log(`\n${passed} 통과 · ${failed} 실패`)
process.exit(failed ? 1 : 0)
