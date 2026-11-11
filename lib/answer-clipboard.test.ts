import { test } from "node:test"
import assert from "node:assert/strict"
import { clipFromTree, rangeClip, sheetRangeClip, stripCitations, tableToHtml, tableToTsv, type ClipNode } from "./answer-clipboard"
import { anchoredMessageId, answerLink, answerTimeLabel } from "./answer-actions"

const el = (tag: string, children: ClipNode[] = [], className?: string): ClipNode => ({ type: "el", tag, className, children })
const t = (value: string): ClipNode => ({ type: "text", value })

test("각주를 뺀다 — 연도 · 큰 범위 · 0 은 글로 둔다", () => {
  assert.equal(stripCitations("출원했습니다 [1]."), "출원했습니다.")
  assert.equal(stripCitations("A[1, 3-5] B"), "A B")
  assert.equal(stripCitations("기간 [2024-2025]"), "기간 [2024-2025]")
  assert.equal(stripCitations("[0] [31]"), "[0] [31]")
  assert.equal(stripCitations("[1-30]"), "[1-30]")
})

test("표 html — 머리 굵게 · 테두리 · 칸 여백이 inline style, 글은 이스케이프", () => {
  const html = tableToHtml(["이름", "단계 [1]"], [["A<b>", "출원"], ["B", "등록 [2]"]])
  assert.match(html, /^<table style="border-collapse:collapse;[^"]*">/)
  assert.match(html, /<thead><tr><th style="[^"]*font-weight:bold;[^"]*">이름<\/th><th [^>]*>단계<\/th><\/tr><\/thead>/)
  assert.match(html, /<td style="border:1px solid #999;padding:4px 8px;[^"]*">A&lt;b&gt;<\/td>/)
  assert.ok(!html.includes("[2]"))
  assert.ok(!html.includes("class="))
})

test("표 TSV — 탭 · 줄바꿈, 칸 안의 탭 · 줄바꿈은 한 칸", () => {
  assert.equal(tableToTsv(["a", "b"], [["1", "2\t3"], ["x\ny", "z [1]"]]), "a\tb\n1\t2 3\nx y\tz")
  assert.equal(tableToTsv([], [["1", "2"]]), "1\t2")
})

test("칸 범위 — 두 칸 이상이면 고른 열의 머리를 붙이고, 칸 하나는 값만", () => {
  const headers = ["이름", "단계", "날짜"]
  const rows = [["A", "출원", "1/1"], ["B", "등록", "2/2"], ["C", "심사", "3/3"]]
  const r = rangeClip(headers, rows, { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } })
  assert.equal(r.text, "단계\t날짜\n등록\t2/2\n심사\t3/3")
  assert.match(r.html, /<th[^>]*>단계<\/th><th[^>]*>날짜<\/th>/)
  assert.ok(!r.html.includes(">A<"))
  // 거꾸로 끈 범위도 같다
  assert.deepEqual(rangeClip(headers, rows, { start: { row: 2, column: 2 }, end: { row: 1, column: 1 } }), r)
  assert.deepEqual(rangeClip(headers, rows, { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } }), { html: "A", text: "A" })
  // 표 밖은 자른다
  assert.equal(rangeClip(headers, rows, { start: { row: 2, column: 2 }, end: { row: 9, column: 9 } }).text, "3/3")
})

test("화면 선택 정리 — 표 밖 글과 함께 고르면 글은 꾸밈을 지키고 표는 표로, 각주 배지는 빠진다", () => {
  const tree: ClipNode[] = [
    el("div", [
      el("p", [t("특허는 "), el("strong", [t("두 건")]), t("입니다 "), el("button", [t("1")], "omnis-citation omnis-citation--link"), t(".")]),
      t("\n"),
      el("div", [
        el("table", [
          el("tbody", [
            el("tr", [el("th", [t("건")]), el("th", [t("단계")])]),
            el("tr", [el("td", [el("span", [t("ADD [1]")], "Spreadsheet__data-viewer")]), el("td", [t("출원")])]),
          ]),
        ]),
      ], "omnis-spreadsheet Spreadsheet"),
      el("ul", [el("li", [t("하나")]), el("li", [t("둘")])]),
    ], "omnis-md"),
  ]
  const clip = clipFromTree(tree)
  assert.ok(clip.html.includes("<p>특허는 <strong>두 건</strong>입니다.</p><div><table"), clip.html)
  assert.match(clip.html, /<table style="[^"]+"><thead><tr><th [^>]*>건<\/th><th [^>]*>단계<\/th><\/tr><\/thead><tbody><tr><td [^>]*>ADD<\/td><td [^>]*>출원<\/td><\/tr><\/tbody><\/table>/)
  assert.ok(clip.html.includes("<ul><li>하나</li><li>둘</li></ul>"))
  assert.ok(!/class=|button|\[1\]|>1</.test(clip.html), clip.html)
  assert.equal(clip.text, "특허는 두 건입니다.\n\n건\t단계\nADD\t출원\n\n- 하나\n- 둘")
})

test("표 일부만 고른 선택(tr · td 조각)도 표가 된다", () => {
  const clip = clipFromTree([el("table", [el("tbody", [el("tr", [el("td", [t("1")]), el("td", [t("2")])])])])])
  assert.match(clip.html, /^<table[^>]*><tbody><tr><td[^>]*>1<\/td><td[^>]*>2<\/td><\/tr><\/tbody><\/table>$/)
  assert.equal(clip.text, "1\t2")
})

test("응답 시각 — 서울 기준 「11월 10일, 오후 2:47」", () => {
  assert.equal(answerTimeLabel("2026-11-10T05:47:00Z"), "11월 10일, 오후 2:47")
  assert.equal(answerTimeLabel("2026-10-24T16:39:00Z"), "10월 25일, 오전 1:39")
  assert.equal(answerTimeLabel("nope"), "")
})

test("사내 링크 — 그 대화 · 그 답, 해시로 다시 읽는다", () => {
  assert.equal(answerLink("https://omnis.haddscience.com/", "room-1", "msg-9"), "https://omnis.haddscience.com/chat/room-1#m-msg-9")
  assert.equal(answerLink("https://x.test", "r", "m", "/omnis"), "https://x.test/omnis/chat/r#m-m")
  assert.equal(anchoredMessageId("#m-msg-9"), "msg-9")
  assert.equal(anchoredMessageId("#other"), null)
})

test("표 좌표(머리글 = 0 줄) — 머리글 칸도 고르고, 본문만 고르면 머리를 붙인다", () => {
  const headers = ["이름", "단계", "날짜"]
  const rows = [["A", "출원", "1/1"], ["B", "등록", "2/2"]]
  const at = (r0: number, c0: number, r1: number, c1: number) => sheetRangeClip(headers, rows, { start: { row: r0, column: c0 }, end: { row: r1, column: c1 } })
  assert.deepEqual(at(0, 1, 0, 1), { html: "단계", text: "단계" })
  assert.equal(at(0, 0, 0, 1).text, "이름\t단계")
  assert.match(at(0, 0, 0, 1).html, /<thead><tr><th[^>]*>이름<\/th><th[^>]*>단계<\/th><\/tr><\/thead><\/table>$/)
  // 머리글 한 칸 + 그 아래 한 칸도 표
  assert.equal(at(0, 2, 1, 2).text, "날짜\n1/1")
  assert.equal(at(1, 0, 2, 1).text, "이름\t단계\nA\t출원\nB\t등록")
  assert.equal(at(2, 1, 0, 0).text, "이름\t단계\nA\t출원\nB\t등록")
  assert.deepEqual(at(2, 2, 2, 2), { html: "2/2", text: "2/2" })
  // 머리글 없는 표는 그대로
  assert.equal(sheetRangeClip([], rows, { start: { row: 0, column: 0 }, end: { row: 0, column: 1 } }).text, "A\t출원")
})

test("읽기 표의 머리글 칸(td.omnis-sheet-head)도 표 머리가 된다", () => {
  const clip = clipFromTree([el("table", [el("tbody", [
    el("tr", [el("td", [t("건")], "Spreadsheet__cell omnis-sheet-head"), el("td", [t("단계")], "omnis-sheet-head")]),
    el("tr", [el("td", [t("ADD")]), el("td", [t("출원")])]),
  ])])])
  assert.match(clip.html, /<thead><tr><th[^>]*>건<\/th><th[^>]*>단계<\/th><\/tr><\/thead><tbody><tr><td[^>]*>ADD<\/td>/)
  assert.equal(clip.text, "건\t단계\nADD\t출원")
})
