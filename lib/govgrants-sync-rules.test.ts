import { test } from "node:test"
import assert from "node:assert/strict"
import { noticeRow, type NoticeItem } from "./grants-import"
import { changedFields, keepKnownSizes, plan, sizeMap, updateData } from "./govgrants-sync-rules"

// 모든 값은 지어낸 것이다
const item = (over: Partial<NoticeItem> = {}): NoticeItem => ({
  key: "n1", title: "시험 공고", org_ministry: "부처", org_agency: "기관",
  members: [{ source: "bizinfo", url: "https://example.com/p/1", url_kind: "detail" }],
  attachments: [{ name: "공고문.hwp", url: "https://example.com/f/1" }],
  deadline_at: "2026-12-10T00:00:00+09:00", last_seen: "2026-11-27T07:30:00Z",
  judgements: { rules: { sole: { verdict: "해당", reasons: [{ claim: "지역 일치", quote: "경기" }] } } },
  ...over,
})
const asExisting = (r: ReturnType<typeof noticeRow>) => ({ ...r, attachments: JSON.parse(JSON.stringify(r.attachments ?? null)) })

test("같은 공고면 바뀐 칸이 없다 — 날짜 · JSON 키 순서는 같은 값으로 본다", () => {
  const r = noticeRow(item())
  const cur = asExisting(r)
  // DB 에서 읽은 JSON 은 키 순서가 다를 수 있다
  cur.attachments = (cur.attachments as Record<string, unknown>[]).map((a) => Object.fromEntries(Object.entries(a).reverse()))
  assert.deepEqual(changedFields(cur, r), [])
})

test("바뀐 칸만 고친다 — 마감 · 마지막으로 본 때", () => {
  const cur = asExisting(noticeRow(item()))
  const next = noticeRow(item({ deadline_at: "2026-12-12T00:00:00+09:00", last_seen: "2026-12-11T07:30:00Z" }))
  const f = changedFields(cur, next)
  assert.deepEqual(f, ["deadlineAt", "lastSeen"])
  assert.deepEqual(Object.keys(updateData(next, f)), ["deadlineAt", "lastSeen"])
})

test("새 행이 비운 근거 · 첨부(undefined)는 그대로 둔다 — 지우지 않는다", () => {
  const cur = asExisting(noticeRow(item()))
  const next = noticeRow(item({ attachments: [], judgements: {} }))
  assert.equal(next.attachments, undefined)
  assert.equal(next.reasonsSole, undefined)
  assert.ok(!changedFields(cur, next).includes("attachments"))
  assert.ok(!changedFields(cur, next).includes("reasonsSole"))
})

test("첨부 크기 — 아는 크기를 지키고, 새로 안 크기는 받는다", () => {
  const known = noticeRow(item(), new Map([["https://example.com/f/1", 1234]]))
  const cur = asExisting(known)
  const blank = noticeRow(item())
  assert.deepEqual(changedFields(cur, keepKnownSizes(blank, cur.attachments)), [])
  const bigger = noticeRow(item(), new Map([["https://example.com/f/1", 999]]))
  assert.deepEqual(changedFields(cur, keepKnownSizes(bigger, cur.attachments)), ["attachments"])
})

test("계획 — 새 · 고침 · 그대로", () => {
  const a = noticeRow(item({ key: "a" }))
  const b = noticeRow(item({ key: "b" }))
  const c = noticeRow(item({ key: "c", title: "바뀐 제목" }))
  const existing = new Map([["b", asExisting(b)], ["c", asExisting(noticeRow(item({ key: "c" })))]])
  const p = plan([a, b, c], existing)
  assert.deepEqual(p.creates.map((r) => r.externalKey), ["a"])
  assert.deepEqual(p.updates.map((u) => [u.key, u.fields]), [["c", ["title"]]])
  assert.deepEqual(p.counts, { items: 3, new: 1, updated: 1, unchanged: 1, fieldCounts: { title: 1 } })
})

test("첨부 크기 jsonb → Map — 숫자만", () => {
  assert.deepEqual([...sizeMap({ u1: 10, u2: "20", u3: "x", u4: -1 })], [["u1", 10], ["u2", 20]])
  assert.equal(sizeMap(null).size, 0)
  assert.equal(sizeMap([1, 2]).size, 0)
})
