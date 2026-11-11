/**
 * 옴니스 답 · 카드 표를 클립보드로 — text/html(표는 표로) + text/plain(탭 · 줄바꿈) + text/rtf(표는 표로). 순수 함수 — 시험: answer-clipboard.test.ts
 *
 * 한글 · 워드 · 파워포인트는 붙여 넣을 때 <style> · class 를 읽지 않는다. 그래서 표의 테두리 · 칸 여백 · 머리 굵기를
 * 모두 inline style 로 적고, 표에는 HTML 속성(border=1 · cellspacing · cellpadding)도 함께 단다 — CSS 를 덜 읽는 붙여넣기도 칸 선이 남게.
 * html 은 완전한 문서(<html><body> · charset · StartFragment 표식)로 싣는다(wrapClipboardHtml).
 * 맥 한컴 한글은 웹 html 대신 글(text/plain)을 고를 때가 있어(2026-11-11 사용자 제보 — 탭 글로 들어감) RTF 표도 함께 싣는다.
 * RTF 를 받는 브라우저(파이어폭스 · 사파리)에서는 맥의 RTF 형식으로 넘어간다 — 크롬은 html · 글만 넘긴다.
 * 엑셀 · 메모장은 text/plain 의 탭 · 줄바꿈을 칸으로 나눈다.
 * 각주 [1] · [2, 3] 은 복사본에서 뺀다 — 붙여 넣은 문서에는 출처 목록이 없다.
 *
 * 화면의 선택(DOM)은 components/omnis/answer-copy.ts 가 아래 ClipNode 나무로 옮긴 뒤 여기서 정리한다.
 */

/** 화면 선택을 옮긴 나무 — DOM 을 몰라도 시험할 수 있게 */
export type ClipNode =
  | { type: "text"; value: string }
  | { type: "el"; tag: string; className?: string; children: ClipNode[] }

export interface Clip {
  html: string
  text: string
  /** RTF 문서 — 없으면 싣지 않는다 */
  rtf?: string
}

const TABLE_STYLE = "border-collapse:collapse;border:1px solid #999;"
const CELL_STYLE = "border:1px solid #999;padding:4px 8px;vertical-align:top;"
const HEAD_STYLE = `${CELL_STYLE}font-weight:bold;background:#f2f2f2;`

/** 각주 토큰 — [1] · [1, 2] · [7-9]. 범위가 20 을 넘거나 번호가 maxCite 를 넘으면([2024-2025]) 글로 둔다 */
const CITE_TOKEN = /\s?\[(\d+(?:\s*[,，~–-]\s*\d+)*)\]/g

export function stripCitations(text: string, maxCite = 30): string {
  return text.replace(CITE_TOKEN, (whole, inner: string) => {
    for (const part of inner.split(/\s*[,，]\s*/)) {
      const range = /^(\d+)\s*[~–-]\s*(\d+)$/.exec(part)
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])]
        if (b < a || b - a > 20 || a < 1 || b > maxCite) return whole
      } else if (!/^\d+$/.test(part) || Number(part) < 1 || Number(part) > maxCite) return whole
    }
    return ""
  })
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** 칸 하나의 글 — 각주를 빼고 공백을 한 칸으로 */
function cellText(s: string): string {
  return stripCitations(s).replace(/\s+/g, " ").trim()
}

/** 표 → inline style 표. headers 가 비면 머리 없이 */
export function tableToHtml(headers: string[], rows: string[][]): string {
  const head = headers.length
    ? `<thead><tr>${headers.map((h) => `<th style="${HEAD_STYLE}">${escapeHtml(cellText(h))}</th>`).join("")}</tr></thead>`
    : ""
  const body = rows.length
    ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="${CELL_STYLE}">${escapeHtml(cellText(c))}</td>`).join("")}</tr>`).join("")}</tbody>`
    : ""
  return `<table border="1" cellspacing="0" cellpadding="4" style="${TABLE_STYLE}">${head}${body}</table>`
}

// ─── RTF ─────────────────────────────────────────────────

/** RTF 글 — \ { } 를 이스케이프하고, ASCII 밖의 글자는 \uN?(16비트 부호 있는 수 · 서로게이트 쌍은 둘) */
export function rtfEscape(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    const ch = s[i]
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`
    else if (ch === "\n") out += "\\line "
    else if (ch === "\t") out += "\\tab "
    else if (code < 0x20) continue
    else if (code < 0x80) out += ch
    else out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`
  }
  return out
}

const RTF_HEAD = "{\\rtf1\\ansi\\ansicpg949\\deff0{\\fonttbl{\\f0\\fnil\\fcharset129 Apple SD Gothic Neo;}{\\f1\\fnil\\fcharset129 Malgun Gothic;}}{\\colortbl;\\red242\\green242\\blue242;}\\uc1\\f0\\fs20 "
const RTF_BORDER = "\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10"

/** 글자 수로 칸 폭(twip) — 한글은 넓게 친다. 1~4 인치 */
function rtfColWidth(texts: string[]): number {
  const units = Math.max(4, ...texts.map((t) => [...t].reduce((n, c) => n + (c.charCodeAt(0) > 0xff ? 2 : 1), 0)))
  return Math.min(5760, Math.max(1440, units * 110))
}

/** 표 → RTF 줄들(문서 머리 없이). 머리 줄은 굵게 · 회색 바탕 */
export function tableToRtfBody(headers: string[], rows: string[][]): string {
  const lines = headers.length ? [headers, ...rows] : rows
  if (!lines.length) return ""
  const width = Math.max(...lines.map((r) => r.length))
  const cols = Array.from({ length: width }, (_, c) => rtfColWidth(lines.map((r) => cellText(r[c] ?? ""))))
  const out: string[] = []
  lines.forEach((r, i) => {
    const head = headers.length > 0 && i === 0
    let x = 0
    const defs = cols.map((w) => `${RTF_BORDER}${head ? "\\clcbpat1" : ""}\\cellx${(x += w)}`).join("")
    const cells = cols.map((_, c) => `\\pard\\intbl ${head ? "{\\b " : ""}${rtfEscape(cellText(r[c] ?? ""))}${head ? "}" : ""}\\cell`).join(" ")
    out.push(`\\trowd\\trgaph80\\trleft0${defs} ${cells} \\row`)
  })
  return `${out.join("\n")}\n\\pard `
}

/** RTF 조각 → 문서. 머리 줄의 회색은 색표 1번 */
export function wrapRtf(body: string): string {
  return `${RTF_HEAD}${body}}`
}

export function tableToRtf(headers: string[], rows: string[][]): string {
  return wrapRtf(tableToRtfBody(headers, rows))
}

/** 표 → 탭 · 줄바꿈(엑셀 · 메모장). 칸 안의 탭 · 줄바꿈은 한 칸으로 */
export function tableToTsv(headers: string[], rows: string[][]): string {
  const lines = headers.length ? [headers, ...rows] : rows
  return lines.map((r) => r.map(cellText).join("\t")).join("\n")
}

/** 칸 범위(0 부터, 끝 포함) — react-spreadsheet 의 PointRange 와 같은 꼴 */
export interface CellRange {
  start: { row: number; column: number }
  end: { row: number; column: number }
}

/**
 * 표에서 고른 칸 범위만. 두 칸 이상이면 고른 열의 머리를 붙인다 — 칸 하나는 그 값만.
 * 범위는 표 크기 안으로 자른다
 */
export function rangeClip(headers: string[], rows: string[][], range: CellRange): Clip {
  const width = Math.max(headers.length, ...rows.map((r) => r.length), 0)
  const r0 = Math.max(0, Math.min(range.start.row, range.end.row))
  const r1 = Math.min(rows.length - 1, Math.max(range.start.row, range.end.row))
  const c0 = Math.max(0, Math.min(range.start.column, range.end.column))
  const c1 = Math.min(width - 1, Math.max(range.start.column, range.end.column))
  if (r1 < r0 || c1 < c0) return { html: "", text: "" }
  const body = rows.slice(r0, r1 + 1).map((r) => Array.from({ length: c1 - c0 + 1 }, (_, i) => r[c0 + i] ?? ""))
  if (body.length === 1 && body[0].length === 1) {
    const v = cellText(body[0][0])
    return { html: escapeHtml(v), text: v }
  }
  const head = headers.length ? Array.from({ length: c1 - c0 + 1 }, (_, i) => headers[c0 + i] ?? "") : []
  return { html: tableToHtml(head, body), text: tableToTsv(head, body), rtf: tableToRtf(head, body) }
}

/**
 * 표 칸 범위 — 머리글을 첫 줄(0)로 둔 표 좌표(components/omnis/copyable-sheet.tsx). 머리글 칸도 고르고 복사할 수 있다.
 * 머리글 줄을 포함하면 그 머리를 표 머리로, 본문만 골랐으면 rangeClip 처럼 고른 열의 머리를 붙인다
 */
export function sheetRangeClip(headers: string[], rows: string[][], range: CellRange): Clip {
  if (!headers.length) return rangeClip(headers, rows, range)
  const r0 = Math.min(range.start.row, range.end.row)
  const r1 = Math.max(range.start.row, range.end.row)
  const cols = { start: Math.min(range.start.column, range.end.column), end: Math.max(range.start.column, range.end.column) }
  if (r0 > 0) return rangeClip(headers, rows, { start: { row: r0 - 1, column: cols.start }, end: { row: r1 - 1, column: cols.end } })
  const width = Math.max(headers.length, ...rows.map((r) => r.length))
  const c0 = Math.max(0, cols.start)
  const c1 = Math.min(width - 1, cols.end)
  if (c1 < c0) return { html: "", text: "" }
  const pick = (r: string[]) => Array.from({ length: c1 - c0 + 1 }, (_, i) => r[c0 + i] ?? "")
  const head = pick(headers)
  const body = rows.slice(0, Math.min(r1, rows.length)).map(pick)
  if (!body.length && head.length === 1) {
    const v = cellText(head[0])
    return { html: escapeHtml(v), text: v }
  }
  return { html: tableToHtml(head, body), text: tableToTsv(head, body), rtf: tableToRtf(head, body) }
}

// ─── 화면 선택 정리 ─────────────────────────────────────

/** 남기는 꾸밈. 나머지 요소(div · span · a …)는 벗기고 속만 남긴다 */
const KEEP = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre", "hr"])
/** 통째로 버리는 것 — 단추(각주 배지) · 그림 · 입력칸 */
const DROP = new Set(["button", "svg", "input", "textarea", "select", "script", "style", "img", "video", "audio", "template"])
const BLOCK = new Set(["p", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr", "table", "div"])

function isCitation(n: ClipNode): boolean {
  return n.type === "el" && /(^|\s)omnis-citation(\s|$)/.test(n.className ?? "")
}

function textOf(n: ClipNode): string {
  if (n.type === "text") return n.value
  if (isCitation(n) || DROP.has(n.tag)) return ""
  if (n.tag === "br") return " "
  return n.children.map(textOf).join("")
}

/** 표 요소의 줄 · 칸. 머리 줄은 th 만으로 된 첫 줄 */
function readTable(table: ClipNode & { type: "el" }): { headers: string[]; rows: string[][] } {
  const trs: (ClipNode & { type: "el" })[] = []
  const walk = (n: ClipNode) => {
    if (n.type !== "el") return
    if (n.tag === "tr") trs.push(n)
    else if (n.tag !== "table" || n === table) n.children.forEach(walk)
  }
  walk(table)
  const lines = trs
    .map((tr) => tr.children.filter((c): c is ClipNode & { type: "el" } => c.type === "el" && (c.tag === "td" || c.tag === "th")))
    .filter((cells) => cells.length > 0)
  let headers: string[] = []
  // 머리 줄 — th 만으로 된 첫 줄, 또는 머리글을 첫 줄 칸(td.omnis-sheet-head)으로 그린 읽기 표(copyable-sheet.tsx)
  const isHead = (c: ClipNode & { type: "el" }) => c.tag === "th" || /(^|\s)omnis-sheet-head(\s|$)/.test(c.className ?? "")
  if (lines.length && lines[0].every(isHead)) headers = lines.shift()!.map(textOf)
  return { headers, rows: lines.map((cells) => cells.map(textOf)) }
}

/** 뺀 각주 자리 — 앞의 빈칸을 함께 걷는다(「현황입니다 [1].」 → 「현황입니다.」) */
const CUT = "\u0000"
const tidyCut = (s: string) => s.replace(/[ \u00a0]*\u0000/g, "")

function toHtml(n: ClipNode): string {
  // 블록 사이의 줄바꿈뿐인 글(마크다운이 남긴 \n)은 버린다 — 붙여 넣은 문서에 빈칸이 생긴다
  if (n.type === "text") return /^\s*$/.test(n.value) && n.value.includes("\n") ? "" : escapeHtml(stripCitations(n.value))
  if (isCitation(n)) return CUT
  if (DROP.has(n.tag)) return ""
  if (n.tag === "table") {
    const t = readTable(n)
    return t.headers.length || t.rows.length ? tableToHtml(t.headers, t.rows) : ""
  }
  if (n.tag === "br") return "<br>"
  if (n.tag === "hr") return "<hr>"
  const inner = n.children.map(toHtml).join("")
  if (!KEEP.has(n.tag)) return n.tag === "div" && inner ? `<div>${inner}</div>` : inner
  const tag = n.tag === "b" ? "strong" : n.tag === "i" ? "em" : n.tag
  return `<${tag}>${inner}</${tag}>`
}

function toText(n: ClipNode, out: string[]): void {
  if (n.type === "text") {
    out.push(stripCitations(n.value))
    return
  }
  if (isCitation(n)) {
    out.push(CUT)
    return
  }
  if (DROP.has(n.tag)) return
  if (n.tag === "table") {
    const t = readTable(n)
    out.push(`\n${tableToTsv(t.headers, t.rows)}\n`)
    return
  }
  if (n.tag === "br") {
    out.push("\n")
    return
  }
  if (n.tag === "li") out.push("\n- ")
  else if (BLOCK.has(n.tag)) out.push("\n")
  n.children.forEach((c) => toText(c, out))
  if (BLOCK.has(n.tag) && n.tag !== "li") out.push("\n")
}

const RTF_BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"])

function toRtf(n: ClipNode): string {
  if (n.type === "text") return /^\s*$/.test(n.value) && n.value.includes("\n") ? "" : rtfEscape(stripCitations(n.value).replace(/\s+/g, " "))
  // 뺀 각주 자리 — 앞 빈칸을 tidyCut 이 함께 걷는다(html 과 같다)
  if (isCitation(n)) return CUT
  if (DROP.has(n.tag)) return ""
  if (n.tag === "table") {
    const t = readTable(n)
    return t.headers.length || t.rows.length ? `\\par ${tableToRtfBody(t.headers, t.rows)}` : ""
  }
  if (n.tag === "br") return "\\line "
  if (n.tag === "hr") return "\\par "
  const inner = n.children.map(toRtf).join("")
  if (n.tag === "strong" || n.tag === "b" || /^h[1-6]$/.test(n.tag)) return inner ? `{\\b ${inner}}${/^h/.test(n.tag) ? "\\par " : ""}` : ""
  if (n.tag === "em" || n.tag === "i") return inner ? `{\\i ${inner}}` : ""
  if (n.tag === "li") return `\\bullet  ${inner}\\par `
  if (RTF_BLOCK.has(n.tag)) return inner && !/\\par $/.test(inner) ? `${inner}\\par ` : inner
  return inner
}

/** 화면에서 고른 것(나무) → 클립보드 세 형식(html · 글 · rtf) */
export function clipFromTree(nodes: ClipNode[]): Clip {
  const html = tidyCut(nodes.map(toHtml).join("")).trim()
  const out: string[] = []
  nodes.forEach((n) => toText(n, out))
  const text = tidyCut(out.join(""))
    .replace(/[  ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  // 표 앞에 문단을 한 번만 끊는다(앞 문단이 이미 끊었으면 빈 줄이 생긴다)
  const rtfBody = tidyCut(nodes.map(toRtf).join("")).replace(/(\\par )+(?=\\par \\trowd)/g, "").replace(/^(\\par )+/, "").replace(/(\\par )+$/, "")
  return { html, text, ...(rtfBody ? { rtf: wrapRtf(rtfBody) } : {}) }
}

/**
 * 클립보드 html — 조각이 아니라 완전한 문서로 감싼다. 글자셋을 밝혀 한글이 깨지지 않게 하고,
 * StartFragment 표식을 두어 윈도 「HTML Format」 을 읽는 프로그램(한글 · 워드 · 엑셀)이 붙일 범위를 안다.
 */
export function wrapClipboardHtml(fragment: string): string {
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"></head><body><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`
}
