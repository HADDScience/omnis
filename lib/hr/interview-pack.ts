// 면접자료 PDF — 지원자마다 「지원서 요약」 1쪽(A4) + 이력서 원본 + 포트폴리오 원본, 묶음은 표지 + 지원자별 자료. 책갈피(지원자 · 문서)를 단다.
// 기준 모양: ~/work/omnis-reports/intern-interview-pack/build.py(2026-11-26, 로컬 스크립트). 옴니스는 서버에서 즉석으로 만들고 저장하지 않는다.
// 접수 창구가 PDF 만 받으므로(lib/hr/rules.ts fileMeta) 변환은 없다. 열리지 않는 PDF · 못 읽은 파일 · 포트폴리오 링크는 요약 장 첨부 표에 이유와 함께 적는다.
// prisma · 저장소를 들이지 않는다 — 단위 시험이 가짜 지원서로 돈다. 읽기는 lib/hr/interview-pack-server.ts.
import fontkit from "@pdf-lib/fontkit"
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from "pdf-lib"
import { interestLabel } from "./rules"

export { BUNDLE_STAGES, PACK_STAGES, canPack } from "./stage-label"

export interface PackApplicant {
  id: string
  code: string
  name: string
  department: string | null
  studentId: string | null
  grade: string | null
  graduation: string | null
  phone: string | null
  email: string | null
  portfolioUrl: string | null
  interests: string[]
  motivation: string | null
  receivedAt: Date
}

export interface PackFile {
  label: string
  fileName: string | null
  size: number
  /** 원본 — 못 읽었으면 null 과 reason */
  bytes: Uint8Array | null
  reason?: string
}

export interface PackFonts {
  regular: Uint8Array
  bold: Uint8Array
  extraBold: Uint8Array
}

export interface Bookmark {
  title: string
  page: number
  children?: Bookmark[]
}

// ─── 모양 ───

const MM = 72 / 25.4
const A4: [number, number] = [210 * MM, 297 * MM]
const MARGIN = 16 * MM
const BLUE = rgb(4 / 255, 74 / 255, 191 / 255)
const INK = rgb(0x19 / 255, 0x1f / 255, 0x28 / 255)
const SUB = rgb(0x4e / 255, 0x59 / 255, 0x69 / 255)
const MUTED = rgb(0x8b / 255, 0x95 / 255, 0xa1 / 255)
const LINE = rgb(0xe5 / 255, 0xe8 / 255, 0xeb / 255)
const TH_BG = rgb(0xf2 / 255, 0xf6 / 255, 0xfd / 255)
const BOX_BG = rgb(0xf9 / 255, 0xfa / 255, 0xfb / 255)
const CHIP_BG = rgb(0xe8 / 255, 0xef / 255, 0xfb / 255)
const MISS = rgb(0xc0 / 255, 0x39 / 255, 0x2b / 255)
const WHITE = rgb(1, 1, 1)
const FOOT = "개인정보 — 면접 외 사용 금지"

interface Fonts {
  r: PDFFont
  b: PDFFont
  eb: PDFFont
}

async function embedFonts(doc: PDFDocument, f: PackFonts): Promise<Fonts> {
  doc.registerFontkit(fontkit)
  const [r, b, eb] = await Promise.all([
    doc.embedFont(f.regular, { subset: false }),
    doc.embedFont(f.bold, { subset: false }),
    doc.embedFont(f.extraBold, { subset: false }),
  ])
  return { r, b, eb }
}

const KST = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
/** 2026.11.25(수) 14:03 */
export function kstStamp(d: Date): string {
  const p = Object.fromEntries(KST.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}.${p.month}.${p.day}(${p.weekday}) ${p.hour === "24" ? "00" : p.hour}:${p.minute}`
}
export const humanSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

/** 글꼴이 모르는 글자(이모지 등)는 빼고 그린다 — 남기면 pdf-lib 가 멈춘다 */
function drawable(font: PDFFont, s: string): string {
  const set = font.getCharacterSet()
  return [...s].filter((ch) => ch === "\n" || set.includes(ch.codePointAt(0)!)).join("")
}

/** 너비에 맞춰 줄을 나눈다 — 띄어쓰기 단위로 넘기고(한국어 keep-all), 한 낱말이 너비보다 길면 글자 단위로 자른다 */
export function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = []
  for (const para of drawable(font, text).replace(/\r\n?/g, "\n").split("\n")) {
    let line = ""
    for (const word of para.split(/(?<=\s)/)) {
      const next = line + word
      if (font.widthOfTextAtSize(next.trimEnd(), size) <= width) {
        line = next
        continue
      }
      if (line.trim()) out.push(line.trimEnd())
      line = ""
      let w = word
      while (font.widthOfTextAtSize(w.trimEnd(), size) > width) {
        let cut = w.length - 1
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--
        out.push(w.slice(0, cut))
        w = w.slice(cut)
      }
      line = w
    }
    out.push(line.trimEnd())
  }
  return out
}

/** 위에서 아래로 쓰는 붓 — y 는 PDF 좌표(아래가 0)로 바꿔 그린다. dry 면 그리지 않고 높이만 잰다 */
class Pen {
  y: number
  constructor(
    private page: PDFPage | null,
    private f: Fonts,
    top = 0,
  ) {
    this.y = top
  }
  private get h() {
    return A4[1]
  }
  text(s: string, x: number, size: number, font: PDFFont, color = INK, baseline = size) {
    this.page?.drawText(drawable(font, s), { x, y: this.h - this.y - baseline, size, font, color })
  }
  rect(x: number, y: number, w: number, hgt: number, color: ReturnType<typeof rgb>) {
    this.page?.drawRectangle({ x, y: this.h - y - hgt, width: w, height: hgt, color })
  }
  line(x1: number, x2: number, y: number, color = LINE, thickness = 0.75) {
    this.page?.drawLine({ start: { x: x1, y: this.h - y }, end: { x: x2, y: this.h - y }, color, thickness })
  }
  get fonts() {
    return this.f
  }
}

interface Scale {
  fs: number
  gap: number
  cell: number
}
const SCALES: Scale[] = [
  { fs: 10.5, gap: 7, cell: 2.2 },
  { fs: 10, gap: 6, cell: 1.9 },
  { fs: 9.5, gap: 5, cell: 1.7 },
  { fs: 9, gap: 4.5, cell: 1.5 },
  { fs: 8.5, gap: 4, cell: 1.3 },
  { fs: 8, gap: 3.5, cell: 1.2 },
]

function band(p: Pen, kicker: string, title: string[], sub: string, padTop: number, padBottom: number) {
  const { b, eb, r } = p.fonts
  const h = padTop + 9 + 2 * MM + title.length * 22 * 1.25 + 1.5 * MM + 12 + padBottom
  p.rect(0, 0, A4[0], h, BLUE)
  p.y = padTop
  p.text(kicker, MARGIN, 9, b, WHITE)
  p.y += 9 + 2 * MM
  for (const t of title) {
    p.text(t, MARGIN, 22, eb, WHITE, 22)
    p.y += 22 * 1.25
  }
  p.y += 1.5 * MM
  p.text(sub, MARGIN, 10, r, rgb(0.9, 0.93, 0.98))
  p.y = h
}

function heading(p: Pen, s: string, sc: Scale) {
  p.y += sc.gap * MM
  p.text(s, MARGIN, 11, p.fonts.eb, BLUE)
  p.y += 11 + 1.5 * MM
  p.line(MARGIN, A4[0] - MARGIN, p.y, BLUE, 1.1)
  p.y += 2.5 * MM
}

const CONTENT_W = A4[0] - 2 * MARGIN

/** 표 한 줄 — cells: [x, width, lines, font, color, background?] */
function row(p: Pen, sc: Scale, cells: { x: number; w: number; lines: string[]; font: PDFFont; color?: ReturnType<typeof rgb>; bg?: ReturnType<typeof rgb> }[]) {
  const lh = sc.fs * 1.6
  const pad = sc.cell * MM
  const height = Math.max(...cells.map((c) => Math.max(1, c.lines.length))) * lh + 2 * pad
  for (const c of cells) {
    if (c.bg) p.rect(c.x, p.y, c.w, height, c.bg)
    c.lines.forEach((l, i) => {
      const top = p.y
      p.y = top + pad + i * lh + (lh - sc.fs) / 2
      p.text(l, c.x + 3 * MM, sc.fs, c.font, c.color ?? INK)
      p.y = top
    })
  }
  p.y += height
  p.line(MARGIN, A4[0] - MARGIN, p.y)
}

export interface AttachRow {
  label: string
  name: string
  format: string
  size: string
  status: string
  missing: boolean
}

function profile(p: Pen, a: PackApplicant, jobTitle: string, attach: AttachRow[], sc: Scale) {
  const { r, b } = p.fonts
  band(p, "HADD SCIENCE · 지원서", [a.name], jobTitle, 9 * MM, 7 * MM)

  heading(p, "지원자 정보", sc)
  const th = 27 * MM
  const half = CONTENT_W / 2
  const tdW = half - th - 6 * MM
  const pairs: [string, string][] = [
    ["접수 번호", a.code],
    ["접수 시각", kstStamp(a.receivedAt)],
    ["학과", a.department ?? ""],
    ["학번", a.studentId ?? ""],
    ["학년", a.grade ? `${a.grade}학년` : ""],
    ["졸업 예정 시기", a.graduation ?? ""],
    ["연락처", a.phone ?? ""],
    ["이메일", a.email ?? ""],
  ]
  for (let i = 0; i < pairs.length; i += 2) {
    row(
      p,
      sc,
      pairs.slice(i, i + 2).flatMap(([k, v], j) => [
        { x: MARGIN + j * half, w: th, lines: [k], font: b, color: SUB, bg: TH_BG },
        { x: MARGIN + j * half + th, w: half - th, lines: wrap(r, sc.fs, v, tdW), font: r },
      ]),
    )
  }
  // 관심 있는 일 — 칩
  {
    const pad = sc.cell * MM
    const chipFs = sc.fs - 1
    const chipH = chipFs * 1.6
    const labels = a.interests.map((v) => interestLabel(v))
    const maxX = A4[0] - MARGIN - 3 * MM
    let cx = MARGIN + th + 3 * MM
    let lines = 1
    const placed: { x: number; line: number; s: string; w: number }[] = []
    for (const s of labels) {
      const w = p.fonts.b.widthOfTextAtSize(drawable(p.fonts.b, s), chipFs) + 6 * MM
      if (cx + w > maxX && cx > MARGIN + th + 3 * MM) {
        lines++
        cx = MARGIN + th + 3 * MM
      }
      placed.push({ x: cx, line: lines - 1, s, w })
      cx += w + 1.5 * MM
    }
    const lineH = chipH + 1.5 * MM
    const height = Math.max(sc.fs * 1.6, lines * lineH) + 2 * pad
    p.rect(MARGIN, p.y, th, height, TH_BG)
    const top = p.y
    p.y = top + pad + (sc.fs * 1.6 - sc.fs) / 2
    p.text("관심 있는 일", MARGIN + 3 * MM, sc.fs, b, SUB)
    if (!labels.length) p.text("고르지 않음", MARGIN + th + 3 * MM, sc.fs, r, MUTED)
    for (const c of placed) {
      const cy = top + pad + c.line * lineH
      p.rect(c.x, cy, c.w, chipH, CHIP_BG)
      p.y = cy + (chipH - chipFs) / 2
      p.text(c.s, c.x + 3 * MM, chipFs, b, BLUE)
    }
    p.y = top + height
    p.line(MARGIN, A4[0] - MARGIN, p.y)
  }

  heading(p, "지원 동기", sc)
  {
    const lh = sc.fs * 1.6
    const lines = wrap(r, sc.fs, (a.motivation ?? "").trim(), CONTENT_W - 10 * MM)
    const height = lines.length * lh + 7 * MM
    p.rect(MARGIN, p.y, CONTENT_W, height, BOX_BG)
    const top = p.y
    lines.forEach((l, i) => {
      p.y = top + 3.5 * MM + i * lh + (lh - sc.fs) / 2
      p.text(l, MARGIN + 5 * MM, sc.fs, r)
    })
    p.y = top + height
  }

  heading(p, "첨부", sc)
  const cols = [22 * MM, 62 * MM, 22 * MM, 18 * MM]
  const xs = [MARGIN, MARGIN + cols[0], MARGIN + cols[0] + cols[1], MARGIN + cols[0] + cols[1] + cols[2], MARGIN + cols[0] + cols[1] + cols[2] + cols[3]]
  const lastW = A4[0] - MARGIN - xs[4]
  row(
    p,
    sc,
    ["문서", "원본", "원본 형식", "크기", "묶음"].map((h, i) => ({ x: xs[i], w: i < 4 ? cols[i] : lastW, lines: [h], font: b, color: SUB, bg: TH_BG })),
  )
  if (!attach.length) row(p, sc, [{ x: MARGIN, w: CONTENT_W, lines: ["첨부 없음"], font: r, color: MUTED }])
  for (const at of attach) {
    row(p, sc, [
      { x: xs[0], w: cols[0], lines: wrap(r, sc.fs, at.label, cols[0] - 6 * MM), font: r },
      { x: xs[1], w: cols[1], lines: wrap(r, sc.fs, at.name, cols[1] - 6 * MM), font: r, color: at.name.startsWith("http") ? BLUE : INK },
      { x: xs[2], w: cols[2], lines: [at.format], font: r },
      { x: xs[3], w: cols[3], lines: [at.size], font: r },
      { x: xs[4], w: lastW, lines: wrap(at.missing ? b : r, sc.fs, at.status, lastW - 6 * MM), font: at.missing ? b : r, color: at.missing ? MISS : INK },
    ])
  }
}

function foot(p: Pen, left: string) {
  const y = A4[1] - 7 * MM - 8
  p.y = y
  p.text(left, MARGIN, 8, p.fonts.r, MUTED)
  const w = p.fonts.r.widthOfTextAtSize(FOOT, 8)
  p.text(FOOT, A4[0] - MARGIN - w, 8, p.fonts.r, MUTED)
}

const BOTTOM_LIMIT = A4[1] - 16 * MM

/** 지원서 요약 한 쪽 — 한 장에 들어갈 때까지 글자 · 간격을 줄인다. 8pt 로도 넘치면 지원 동기를 줄인다 */
function drawProfile(doc: PDFDocument, f: Fonts, a: PackApplicant, jobTitle: string, attach: AttachRow[]): number {
  let chosen = SCALES[SCALES.length - 1]
  for (const sc of SCALES) {
    const probe = new Pen(null, f)
    profile(probe, a, jobTitle, attach, sc)
    if (probe.y <= BOTTOM_LIMIT) {
      chosen = sc
      break
    }
  }
  let app = a
  for (let keep = (a.motivation ?? "").length; keep > 0; keep -= 100) {
    const probe = new Pen(null, f)
    profile(probe, app, jobTitle, attach, chosen)
    if (probe.y <= BOTTOM_LIMIT) break
    app = { ...a, motivation: `${(a.motivation ?? "").slice(0, keep - 100)}…` }
  }
  const page = doc.addPage(A4)
  const pen = new Pen(page, f)
  profile(pen, app, jobTitle, attach, chosen)
  foot(pen, `${a.code} · ${a.name}`)
  return chosen.fs
}

// ─── 책갈피 ───

/** 문서 목차(Outlines) — pdf-lib 에 고수준 함수가 없어 사전을 직접 만든다 */
export function setOutline(doc: PDFDocument, items: Bookmark[]) {
  const ctx = doc.context
  const pages = doc.getPages()
  const rootRef = ctx.nextRef()
  const build = (list: Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = list.map(() => ctx.nextRef())
    let count = 0
    list.forEach((it, i) => {
      const d = ctx.obj({}) as PDFDict
      d.set(PDFName.of("Title"), PDFHexString.fromText(it.title))
      d.set(PDFName.of("Parent"), parent)
      d.set(PDFName.of("Dest"), ctx.obj([pages[it.page].ref, PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull]))
      if (i > 0) d.set(PDFName.of("Prev"), refs[i - 1])
      if (i < list.length - 1) d.set(PDFName.of("Next"), refs[i + 1])
      count++
      if (it.children?.length) {
        const c = build(it.children, refs[i])
        d.set(PDFName.of("First"), c.first)
        d.set(PDFName.of("Last"), c.last)
        d.set(PDFName.of("Count"), PDFNumber.of(c.count))
        count += c.count
      }
      ctx.assign(refs[i], d)
    })
    return { first: refs[0], last: refs[refs.length - 1], count }
  }
  if (!items.length) return
  const top = build(items, rootRef)
  ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: top.first, Last: top.last, Count: PDFNumber.of(top.count) }))
  doc.catalog.set(PDFName.of("Outlines"), rootRef)
}

/** 시험 · 점검용 — 목차를 읽어 [{title, page, children}] */
export function readOutline(doc: PDFDocument): Bookmark[] {
  const pages = doc.getPages().map((p) => p.ref.toString())
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict)
  const walk = (first: PDFDict | undefined): Bookmark[] => {
    const out: Bookmark[] = []
    for (let d = first; d; d = d.lookupMaybe(PDFName.of("Next"), PDFDict)) {
      const title = (d.lookup(PDFName.of("Title")) as PDFHexString).decodeText()
      const dest = d.lookup(PDFName.of("Dest")) as unknown as { get(i: number): { toString(): string } }
      const kids = walk(d.lookupMaybe(PDFName.of("First"), PDFDict))
      out.push({ title, page: pages.indexOf(dest.get(0).toString()), ...(kids.length ? { children: kids } : {}) })
    }
    return out
  }
  return root ? walk(root.lookupMaybe(PDFName.of("First"), PDFDict)) : []
}

// ─── 지원자 한 명 · 묶음 ───

interface Placed {
  applicant: PackApplicant
  /** 이 문서 안에서 지원서 요약이 놓인 쪽(0부터) */
  start: number
  pages: number
  sections: Bookmark[]
  attach: AttachRow[]
}

async function place(doc: PDFDocument, f: Fonts, a: PackApplicant, files: PackFile[], jobTitle: string): Promise<Placed> {
  const loaded: { label: string; src: PDFDocument | null; row: AttachRow }[] = []
  for (const file of files) {
    const fmt = (file.fileName?.split(".").pop() ?? "?").toUpperCase()
    const base = { label: file.label, name: file.fileName ?? "", format: fmt, size: humanSize(file.size) }
    if (!file.bytes) {
      loaded.push({ label: file.label, src: null, row: { ...base, status: `못 넣음 — ${file.reason ?? "파일을 읽지 못함"}`, missing: true } })
      continue
    }
    try {
      const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false })
      if (src.isEncrypted) throw new Error("암호가 걸린 PDF")
      if (src.getPageCount() === 0) throw new Error("쪽이 없는 PDF")
      loaded.push({ label: file.label, src, row: { ...base, status: `${src.getPageCount()}쪽 수록`, missing: false } })
    } catch (e) {
      const why = e instanceof Error && /암호|쪽이 없는/.test(e.message) ? e.message : "PDF를 열 수 없음"
      loaded.push({ label: file.label, src: null, row: { ...base, status: `못 넣음 — ${why}`, missing: true } })
    }
  }
  const attach = loaded.map((l) => l.row)
  if (a.portfolioUrl)
    attach.push({ label: "포트폴리오 링크", name: a.portfolioUrl, format: "외부 링크", size: "—", status: "못 넣음 — 웹 주소라 PDF로 넣지 않음", missing: true })

  const start = doc.getPageCount()
  drawProfile(doc, f, a, jobTitle, attach)
  const sections: Bookmark[] = [{ title: "지원서 요약", page: start }]
  for (const l of loaded) {
    if (!l.src) continue
    const at = doc.getPageCount()
    const copied = await doc.copyPages(l.src, l.src.getPageIndices())
    copied.forEach((pg) => doc.addPage(pg))
    sections.push({ title: l.label, page: at })
  }
  return { applicant: a, start, pages: doc.getPageCount() - start, sections, attach }
}

export interface PackInput {
  applicant: PackApplicant
  files: PackFile[]
}

export interface PackResult {
  bytes: Uint8Array
  pages: number
  outline: Bookmark[]
}

/** 지원자 한 명 — 지원서 요약 · 이력서 · 포트폴리오 */
export async function buildApplicantPack(input: PackInput, jobTitle: string, fonts: PackFonts): Promise<PackResult> {
  const doc = await PDFDocument.create()
  const f = await embedFonts(doc, fonts)
  const placed = await place(doc, f, input.applicant, input.files, jobTitle)
  setOutline(doc, placed.sections)
  doc.setTitle(`면접 자료 — ${input.applicant.name} (${input.applicant.code})`)
  doc.setAuthor("HADD SCIENCE")
  return { bytes: await doc.save(), pages: doc.getPageCount(), outline: placed.sections }
}

/** 묶음 — 표지(공고 · 지원자 이름과 시작 쪽) + 지원자별 자료. 면접 일시 · 장소는 옴니스에 입력할 곳이 없어 표지에 넣지 않는다 */
export async function buildBundle(inputs: PackInput[], jobTitle: string, fonts: PackFonts, now = new Date()): Promise<PackResult> {
  const doc = await PDFDocument.create()
  const f = await embedFonts(doc, fonts)
  const placed: Placed[] = []
  for (const it of inputs) placed.push(await place(doc, f, it.applicant, it.files, jobTitle))
  // 표지는 맨 앞에 끼운다 — 쪽 번호가 하나씩 밀린다
  const cover = doc.insertPage(0, A4)
  const pen = new Pen(cover, f)
  band(pen, "HADD SCIENCE · 면접 자료", ["면접 지원자 묶음"], jobTitle, 22 * MM, 12 * MM)
  const sc = SCALES[0]
  heading(pen, `지원자 ${placed.length}명`, sc)
  const big: Scale = { fs: 13, gap: 7, cell: 3.5 }
  for (const pl of placed) {
    const w = CONTENT_W
    row(pen, big, [
      { x: MARGIN, w: w * 0.45, lines: [pl.applicant.name], font: f.b },
      { x: MARGIN + w * 0.45, w: w * 0.35, lines: [pl.applicant.code], font: f.r, color: MUTED },
      { x: MARGIN + w * 0.8, w: w * 0.2, lines: [`${pl.start + 2}쪽부터`], font: f.r, color: SUB },
    ])
  }
  foot(pen, `만든 때 ${kstStamp(now)}`)

  const outline: Bookmark[] = [
    { title: "표지", page: 0 },
    ...placed.map((pl) => ({
      title: `${pl.applicant.name} (${pl.applicant.code})`,
      page: pl.start + 1,
      children: pl.sections.map((s) => ({ ...s, page: s.page + 1 })),
    })),
  ]
  setOutline(doc, outline)
  doc.setTitle(`면접 지원자 묶음 — ${jobTitle}`)
  doc.setAuthor("HADD SCIENCE")
  return { bytes: await doc.save(), pages: doc.getPageCount(), outline }
}

/** 내려받는 파일 이름 */
export const packFileName = (a: { code: string; name: string }) => `면접자료_${a.code}_${a.name}.pdf`
export const bundleFileName = (slug: string) => `면접자료_서류합격_${slug}.pdf`
