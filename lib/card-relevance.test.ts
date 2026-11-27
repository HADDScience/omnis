import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildCardInput, buildPrompt, checkRename, decide, maskContact, maskDeep, parseOutput, worthCalling,
  type CardInput, type TimelineMessage,
} from "./card-relevance"

// 모든 값은 지어낸 것이다(이름 · 번호 · 메일 · 파일명)
const T0 = Date.UTC(2026, 10, 20, 1, 0) // 10:00 KST
const msg = (i: number, text: string, extra: Partial<TimelineMessage> = {}): TimelineMessage => ({
  id: `id${i}`, ms: T0 + i * 60_000, at: `2026-11-20 10:${String(i).padStart(2, "0")}`, who: i % 2 ? "가나다" : "라마바", text, files: [], ...extra,
})

test("전화번호 · 메일을 가린다 — 날짜 · 시각 · 금액 · 사업자번호는 그대로", () => {
  const c = { phone: 0, mail: 0 }
  const out = maskContact("연락처 010-1234-5678, 01098765432, 02-123-4567, 031.123.4567, +82 10-2222-3333, 대표 1588-1234 / 메일 hong.gil@example.co.kr", c)
  assert.equal(out, "연락처 (전화번호 가림), (전화번호 가림), (전화번호 가림), (전화번호 가림), (전화번호 가림), 대표 (전화번호 가림) / 메일 (메일 가림)")
  assert.deepEqual(c, { phone: 6, mail: 1 })
  const keep = "2026-11-25 14:00 회의, 견적 1,500,000원, 사업자 123-45-67890, 파일 20261125_113725_1.jpeg, 2구 박스 3,000개"
  assert.equal(maskContact(keep), keep)
  // 링크 속 16진 id 는 번호가 아니다
  const link = "https://example.com/d/3f9bbf9e18-2345-6789 · /x/aa6-5123-4567 · /y/d9e95199-1234"
  assert.equal(maskContact(link), link)
  assert.equal(maskContact("유선번호: 031-123-4567\n대표 전화번호는 1669-1234 · T.010-1234-5678"), "유선번호: (전화번호 가림)\n대표 전화번호는 (전화번호 가림) · T.(전화번호 가림)")
})

test("maskDeep 은 id · at 을 건드리지 않는다", () => {
  const v = maskDeep({ id: "010-1111-2222", at: "2026-11-20 10:00", text: "010-1111-2222", files: [{ desc: "a@b.com 이 적힌 명함" }] })
  assert.equal(v.id, "010-1111-2222")
  assert.equal(v.text, "(전화번호 가림)")
  assert.equal(v.files[0].desc, "(메일 가림) 이 적힌 명함")
})

test("buildCardInput — 앞뒤 2글 · sameCard · 30분 안 파일", () => {
  const tl = [
    msg(0, "File: 리플렛_시안_v2.ai"),
    msg(1, "잡담"),
    msg(2, "점심 뭐 먹죠"),
    msg(3, "리플렛 시안 고쳐 주세요"),
    msg(4, "넵"),
    msg(5, "", { files: [{ name: "20261120_1.jpeg", mime: "image/jpeg", desc: "리플렛 표지 사진" }] }),
    msg(6, "퇴근합니다"),
    msg(7, "내일 봬요"),
    msg(80, "File: 늦은파일.pdf"),
  ]
  const card = buildCardInput({ key: "t1", room: "전사방", title: "디자인 수정", background: null, allowRename: true, timeline: tl, candidateIds: ["id5", "id3", "id4", "없는글"] })
  assert.deepEqual(card.messages.map((m) => m.id), ["id3", "id4", "id5"])
  const m3 = card.messages[0]
  assert.deepEqual(m3.before.map((b) => b.id), ["id1", "id2"])
  assert.deepEqual(m3.after.map((a) => [a.id, a.sameCard]), [["id4", true], ["id5", true]])
  assert.deepEqual(m3.nearBefore.map((f) => f.name), ["리플렛_시안_v2.ai"])
  // 맨 뒤 글은 70분 뒤라 30분 밖이다
  assert.deepEqual(card.messages[2].nearAfter, [])
})

const card4 = (over: Partial<CardInput> = {}): CardInput => buildCardInput({
  key: "t1", room: "전사방", title: over.title ?? "디자인 수정", background: over.background ?? null, allowRename: over.allowRename ?? true,
  timeline: [
    msg(0, "리플렛 시안 고쳐 주세요"),
    msg(1, "", { files: [{ name: "애드젤_리플렛_v3.pdf", mime: "application/pdf" }] }),
    msg(2, "넵"),
    msg(3, "오늘 저녁 회식 어디죠"),
    msg(4, "010-3333-4444 로 전화 주세요"),
  ],
  candidateIds: ["id0", "id1", "id2", "id3", "id4"],
})

test("buildPrompt — 짧은 번호 · 가림, 응답 번호를 원래 id 로 되짚는다", () => {
  const c = { phone: 0, mail: 0 }
  const { prompt, ids } = buildPrompt(card4(), c)
  assert.ok(prompt.includes('"id":"m1"'))
  assert.ok(!prompt.includes("010-3333-4444"))
  assert.ok(c.phone >= 1)
  assert.equal(ids.get("m1"), "id0")
  const out = parseOutput(JSON.stringify({ judgments: [{ id: "m1", v: "R", unsure: false }, { id: "m1", v: "U", unsure: false }, { id: "m9", v: "U", unsure: false }, { id: "m2", v: "X" }] }), ids, ["id0", "id1"])
  assert.deepEqual(out.judgments, [{ id: "id0", v: "R", unsure: false }])
  assert.throws(() => parseOutput("not json", ids, []))
})

test("decide — 무관만 떼고, 애매 · 빠진 판정은 붙여 둔다", () => {
  const c = card4()
  const plan = decide(c, {
    judgments: [
      { id: "id0", v: "R", unsure: false }, { id: "id1", v: "R", unsure: false },
      { id: "id2", v: "U", unsure: true }, { id: "id3", v: "U", unsure: false },
    ],
    title: null,
  })
  assert.deepEqual(plan.drop, ["id3"])
  assert.deepEqual(plan.keep, ["id0", "id1", "id2", "id4"])
  assert.deepEqual(plan.unsure, ["id2"])
  assert.deepEqual(plan.missing, ["id4"])
  assert.equal(plan.judged, true)
})

test("decide — 글이 4개 미만이면 떼지 않는다, 전부 무관이면 아무것도 떼지 않는다", () => {
  const small = { ...card4(), messages: card4().messages.slice(0, 3) }
  const allU = (c: CardInput) => ({ judgments: c.messages.map((m) => ({ id: m.id, v: "U" as const, unsure: false })), title: null })
  assert.deepEqual(decide(small, allU(small)).drop, [])
  assert.equal(decide(small, allU(small)).judged, false)
  const big = card4()
  const p = decide(big, allU(big))
  assert.equal(p.allUnrelated, true)
  assert.deepEqual(p.drop, [])
})

test("제목 — 글 · 파일명에 있는 대상만 받는다", () => {
  const c = card4()
  assert.deepEqual(checkRename(c, "애드젤 리플렛 디자인 수정"), { ok: true, name: "애드젤 리플렛 디자인 수정" })
  // 대상이 글 · 파일 어디에도 없다
  assert.equal(checkRename(c, "뉴로힐 포스터 디자인 수정").ok, false)
  // 원래 일 이름(디자인 · 수정)이 사라졌다
  assert.equal(checkRename(c, "애드젤 리플렛").ok, false)
  assert.equal(checkRename(c, "디자인 수정").ok, false)
  assert.equal(checkRename(card4({ allowRename: false }), "애드젤 리플렛 디자인 수정").ok, false)
  assert.equal(checkRename(c, "애드젤 리플렛 디자인 수정 ".repeat(5)).ok, false)
  const plan = decide(c, { judgments: [], title: { name: "애드젤 리플렛 디자인 수정", basis: "애드젤_리플렛_v3.pdf" } })
  assert.deepEqual(plan.rename, { from: "디자인 수정", to: "애드젤 리플렛 디자인 수정", basis: "애드젤_리플렛_v3.pdf" })
  const bad = decide(c, { judgments: [], title: { name: "뉴로힐 포스터 디자인 수정" } })
  assert.equal(bad.rename, null)
  assert.equal(bad.renameRejected, "더한 대상이 글 · 파일에 없음")
})

test("worthCalling — 작은 기존 카드는 부르지 않는다", () => {
  const small = { ...card4({ allowRename: false }), messages: card4().messages.slice(0, 2) }
  assert.equal(worthCalling(small), false)
  assert.equal(worthCalling({ ...small, allowRename: true }), true)
  assert.equal(worthCalling(card4({ allowRename: false })), true)
})
