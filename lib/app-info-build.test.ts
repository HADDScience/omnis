import { test } from "node:test"
import assert from "node:assert/strict"
import { humanizeTitle, normalizeLicenses, parseMergeLog } from "./app-info-build.mjs"

test("PR 제목 → 사람이 읽을 한 줄: 종류 머리를 떼고 이름표를 단다", () => {
  assert.deepEqual(humanizeTitle("feat(chat): 폰에서 글을 오른쪽으로 밀면 답장"), { kind: "새 기능", text: "폰에서 글을 오른쪽으로 밀면 답장" })
  assert.deepEqual(humanizeTitle("fix(chat): 🤖 를 화면에서 옴니스 아이콘으로 (핫픽스)"), { kind: "고침", text: "🤖 를 화면에서 옴니스 아이콘으로" })
  assert.deepEqual(humanizeTitle("perf: 방 목록을 빨리 연다 #12"), { kind: "빨라짐", text: "방 목록을 빨리 연다" })
  assert.deepEqual(humanizeTitle("feat(tasks): `담당자` 여러 명"), { kind: "새 기능", text: "담당자 여러 명" })
})

test("내부 작업은 싣지 않는다 — 종류 · 범위 · 내부 용어", () => {
  for (const t of [
    "chore: 의존성 올림",
    "refactor(chat): 나눔",
    "ci: 캐시",
    "e2e 게이트 — 바꾼 영역을 push 전에 격리 DB 에서",
    "fix(kakao): 건식 임시 사본에 raw/keys-v2 표식도 옮긴다",
    "fix(kakao-import): 카톡 표시명을 믿지 않는다",
    "feat(upload): 큰 첨부 R2(S3 호환) 직접 올리기 · 서명 주소 열람 — 꺼진 채로",
    "fix(chat): e2e 가 흔들리던 로케이터",
    "Merge branch 'main' into feat/x",
  ]) {
    assert.equal(humanizeTitle(t), null, t)
  }
})

test("머지 기록 → 최근 순 10건, 브랜치명은 쓰지 않고 서울 날짜", () => {
  const rec = (at: string, n: number, branch: string, title: string) => `${at}\x1fMerge pull request #${n} from HADDScience/${branch}\x1f${title}\n\x1e`
  const log = [
    rec("2026-11-11T16:19:38+09:00", 202, "feat/survey-chat-style", "feat(survey): 설문을 옴니스와의 대화로"),
    rec("2026-11-11T15:07:07+09:00", 199, "fix/chat-table-overflow", "fix(chat): 좁은 폭의 옴니스 답 표 — 잘림 대신 줄바꿈"),
    rec("2026-11-11T11:52:21+09:00", 189, "fix/kakao-dry-copy-keys-v2", "fix(kakao): 건식 사본"),
    "2026-11-10T23:30:00Z\x1fMerge branch 'main'\x1f\n\x1e",
    rec("2026-11-10T16:00:00Z", 150, "feat/x", "feat(chat): 같은 제목"),
    rec("2026-11-09T16:00:00Z", 149, "feat/y", "feat(chat): 같은 제목"),
  ].join("")
  const items = parseMergeLog(log)
  assert.deepEqual(items, [
    { date: "2026-11-11", kind: "새 기능", text: "설문을 옴니스와의 대화로" },
    { date: "2026-11-11", kind: "고침", text: "좁은 폭의 옴니스 답 표 — 잘림 대신 줄바꿈" },
    { date: "2026-11-11", kind: "새 기능", text: "같은 제목" },
  ])
  for (const i of items) assert.ok(!/feat\/|fix\/|HADDScience/.test(i.text))
  const many = Array.from({ length: 15 }, (_, i) => rec("2026-11-01T00:00:00Z", i, "f", `feat: 기능 ${i}`)).join("")
  assert.equal(parseMergeLog(many).length, 10)
})

test("라이선스 목록 — 이름 순, 모르는 라이선스는 「명시 없음」, 주소는 http(s) 만", () => {
  const rows = normalizeLicenses({
    MIT: [{ name: "zod", versions: ["4.6.5"], license: "MIT", homepage: "https://zod.dev" }],
    Unknown: [{ name: "a-lib", versions: ["1.0.0", "1.1.0"], license: "Unknown", homepage: "javascript:alert(1)" }],
  })
  assert.deepEqual(rows, [
    { name: "a-lib", version: "1.0.0, 1.1.0", license: "명시 없음", homepage: null },
    { name: "zod", version: "4.6.5", license: "MIT", homepage: "https://zod.dev" },
  ])
})
