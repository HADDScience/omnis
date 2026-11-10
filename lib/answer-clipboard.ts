/**
 * 옴니스 답 · 카드 표를 클립보드로 — text/html(표는 표로) + text/plain(탭 · 줄바꿈). 순수 함수 — 시험: answer-clipboard.test.ts
 *
 * 한글 · 워드 · 파워포인트는 붙여 넣을 때 <style> · class 를 읽지 않는다. 그래서 표의 테두리 · 칸 여백 · 머리 굵기를
 * 모두 inline style 로 적는다. 엑셀 · 메모장은 text/plain 의 탭 · 줄바꿈을 칸으로 나눈다.
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
  return `<table style="${TABLE_STYLE}">${head}${body}</table>`
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
  return { html: tableToHtml(head, body), text: tableToTsv(head, body) }
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
  if (lines.length && lines[0].every((c) => c.tag === "th")) headers = lines.shift()!.map(textOf)
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

/** 화면에서 고른 것(나무) → 클립보드 두 형식 */
export function clipFromTree(nodes: ClipNode[]): Clip {
  const html = tidyCut(nodes.map(toHtml).join("")).trim()
  const out: string[] = []
  nodes.forEach((n) => toText(n, out))
  const text = tidyCut(out.join(""))
    .replace(/[  ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { html, text }
}

/** 클립보드 html 을 붙여 넣는 프로그램이 한글을 깨뜨리지 않게 감싼다 */
export function wrapClipboardHtml(fragment: string): string {
  return `<meta charset="utf-8">${fragment}`
}
