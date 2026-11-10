// 옴니스가 만드는 파일 — docx · xlsx · pptx 를 함수 안에서 만들고, 다시 열어 검증한다.
// 순수 모듈(prisma · NAS 없음). 저장은 lib/agent/outputs.ts 가 storeVerified 에 실제 저장소를 넣어 부른다.
// 시험: lib/agent/doc-files.test.ts
//
// folding(codegate) agent/doc_writers.py 의 자기검증 쓰기를 옮겼다 — 새 파일로 저장 → 다시 열어 확인 → 실패면 결과를 지운다.
// 반쪽짜리 파일이 방에 붙어 「열리지 않는 파일」 을 사람이 내려받는 일이 없게 한다.
// 임의 코드 실행은 하지 않는다 — 모델은 내용(JSON)만 주고, 모양은 여기 코드가 정한다.
import { createHash } from "node:crypto"
import { z } from "zod"
import JSZip from "jszip"
import { XMLValidator } from "fast-xml-parser"
import * as XLSX from "xlsx"
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx"
import PptxGenJS from "pptxgenjs"

export const FILE_FORMATS = ["docx", "xlsx", "pptx"] as const
export type FileFormat = (typeof FILE_FORMATS)[number]

export const MIME: Record<FileFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export const FORMAT_LABEL: Record<FileFormat, string> = { docx: "워드 문서", xlsx: "엑셀 표", pptx: "파워포인트" }

/** 한 파일의 크기 한도 — 모델이 끝없는 표를 넣어 함수 시간을 다 쓰지 않게. 첨부 상한(4MB)보다 훨씬 작다 */
export const LIMITS = { bodyChars: 30_000, sheets: 10, rows: 2_000, cols: 40, cellChars: 2_000, slides: 30, bullets: 12, bulletChars: 400 }

const cell = z.union([z.string().max(LIMITS.cellChars), z.number(), z.boolean(), z.null()])

export const FileSpecSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("docx"),
    file_name: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    body: z.string().max(LIMITS.bodyChars),
  }),
  z.object({
    format: z.literal("xlsx"),
    file_name: z.string().min(1).max(120),
    title: z.string().max(200).optional(),
    sheets: z
      .array(z.object({ name: z.string().min(1).max(60), rows: z.array(z.array(cell).max(LIMITS.cols)).min(1).max(LIMITS.rows) }))
      .min(1)
      .max(LIMITS.sheets),
  }),
  z.object({
    format: z.literal("pptx"),
    file_name: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(300).optional(),
    slides: z
      .array(z.object({
        title: z.string().min(1).max(200),
        bullets: z.array(z.string().max(LIMITS.bulletChars)).max(LIMITS.bullets).default([]),
        notes: z.string().max(2_000).optional(),
      }))
      .min(1)
      .max(LIMITS.slides),
  }),
])
export type FileSpec = z.infer<typeof FileSpecSchema>

/** zod 오류를 사람이 읽을 한 줄로 */
export function specProblem(input: unknown): string | null {
  const r = FileSpecSchema.safeParse(input)
  if (r.success) return null
  const i = r.error.issues[0]
  return `파일 내용이 형식에 맞지 않습니다 (${i.path.join(".") || "입력"}: ${i.message})`
}

// ─── 이름 ─────────────────────────────────────────────────────────

/** 파일 이름 — 경로 · 금지 문자를 걷고 확장자를 형식에 맞춘다. NAS 키는 id 로 만들어 이 이름은 표시 · 내려받기용이다 */
export function safeFileName(raw: string, format: FileFormat): string {
  const base = raw
    .replace(/\.(docx|xlsx|pptx|doc|xls|ppt|hwp|hwpx|pdf|txt|md)$/i, "")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
  return `${base || "옴니스 문서"}.${format}`
}

/** 엑셀 시트 이름 규칙 — 31자 · []:*?/\ 금지 · 겹치지 않게 */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw, i) => {
    let n = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || `시트${i + 1}`
    let k = 2
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)}(${k++})`
    used.add(n.toLowerCase())
    return n
  })
}

// ─── 마크다운 → 문단 (docx 본문) ──────────────────────────────────────

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; n: number; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "paragraph"; text: string }

/** 모델이 쓰는 마크다운의 흔한 모양만 — 제목 · 목록 · 표 · 문단. 나머지는 글 그대로 둔다 */
export function markdownBlocks(md: string): Block[] {
  const out: Block[] = []
  const lines = md.replace(/\r\n?/g, "\n").split("\n")
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ type: "paragraph", text: para.join("\n") })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t) {
      flush()
      continue
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flush()
      out.push({ type: "heading", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2].trim() })
      continue
    }
    const b = t.match(/^[-*•]\s+(.*)$/)
    if (b) {
      flush()
      out.push({ type: "bullet", text: b[1] })
      continue
    }
    const n = t.match(/^(\d+)[.)]\s+(.*)$/)
    if (n) {
      flush()
      out.push({ type: "numbered", n: Number(n[1]), text: n[2] })
      continue
    }
    if (t.startsWith("|")) {
      flush()
      const rows: string[][] = []
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
        // 구분줄(|---|:--:|)은 건너뛴다
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
        rows.push(cells)
      }
      i--
      if (rows.length) out.push({ type: "table", rows })
      continue
    }
    para.push(t)
  }
  flush()
  return out
}

/** **굵게** 만 살린다. 나머지 기호는 글 그대로 */
function runs(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((p) =>
    p.startsWith("**") && p.endsWith("**")
      ? new TextRun({ text: p.slice(2, -2), bold: true, size: opts.size })
      : new TextRun({ text: p, bold: opts.bold, size: opts.size }),
  )
}

const FONT = "Malgun Gothic"

export async function buildDocx(spec: { title: string; body: string }): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: spec.title })] })]
  const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" }
  for (const b of markdownBlocks(spec.body)) {
    if (b.type === "heading") children.push(new Paragraph({ heading: HEADING[b.level], children: runs(b.text) }))
    else if (b.type === "bullet") children.push(new Paragraph({ bullet: { level: 0 }, children: runs(b.text) }))
    else if (b.type === "numbered") children.push(new Paragraph({ indent: { left: 360 }, children: runs(`${b.n}. ${b.text}`) }))
    else if (b.type === "paragraph") {
      b.text.split("\n").forEach((line) => children.push(new Paragraph({ spacing: { after: 120 }, children: runs(line) })))
    } else {
      const width = Math.max(...b.rows.map((r) => r.length))
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map((r, ri) =>
            new TableRow({
              children: Array.from({ length: width }, (_, ci) =>
                new TableCell({
                  borders: { top: border, bottom: border, left: border, right: border },
                  children: [new Paragraph({ alignment: AlignmentType.LEFT, children: runs(r[ci] ?? "", { bold: ri === 0 }) })],
                }),
              ),
            }),
          ),
        }),
      )
      children.push(new Paragraph({ children: [] }))
    }
  }
  const doc = new Document({
    creator: "Omnis",
    title: spec.title,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ children }],
  })
  return Packer.toBuffer(doc)
}

export function buildXlsx(spec: { sheets: { name: string; rows: (string | number | boolean | null)[][] }[] }): Buffer {
  const wb = XLSX.utils.book_new()
  const names = sheetNames(spec.sheets.map((s) => s.name))
  spec.sheets.forEach((s, i) => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((c) => (c === null ? "" : c))))
    // 열 너비 — 가장 긴 칸에 맞추되 60자에서 자른다(한글은 두 칸으로 센다)
    const width = Math.max(...s.rows.map((r) => r.length))
    ws["!cols"] = Array.from({ length: width }, (_, ci) => ({
      wch: Math.min(60, Math.max(6, ...s.rows.map((r) => String(r[ci] ?? "").replace(/[^\x00-\x7f]/g, "aa").length + 2))),
    }))
    XLSX.utils.book_append_sheet(wb, ws, names[i])
  })
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer
}

export async function buildPptx(spec: { title: string; subtitle?: string; slides: { title: string; bullets: string[]; notes?: string }[] }): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE"
  pptx.title = spec.title
  pptx.author = "Omnis"
  const cover = pptx.addSlide()
  cover.addText(spec.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.2, fontFace: FONT, fontSize: 36, bold: true, color: "1F2937" })
  if (spec.subtitle) cover.addText(spec.subtitle, { x: 0.8, y: 3.7, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 18, color: "6B7280" })
  for (const s of spec.slides) {
    const slide = pptx.addSlide()
    slide.addText(s.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: "111827" })
    if (s.bullets.length) {
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.5, w: 11.7, h: 5.4, fontFace: FONT, fontSize: 18, color: "1F2937", valign: "top", paraSpaceAfter: 6 },
      )
    }
    if (s.notes) slide.addNotes(s.notes)
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer
}

export async function buildFile(spec: FileSpec): Promise<Buffer> {
  if (spec.format === "docx") return buildDocx(spec)
  if (spec.format === "xlsx") return buildXlsx(spec)
  return buildPptx({ ...spec, slides: spec.slides.map((s) => ({ ...s, bullets: s.bullets ?? [] })) })
}

/** 만든 뒤 다시 열었을 때 있어야 하는 것 */
export interface Expect {
  format: FileFormat
  /** xlsx — 시트 이름(순서대로) */
  sheets?: string[]
  /** pptx — 슬라이드 수(표지 포함) */
  slides?: number
  /** docx · pptx — 본문 어딘가에 있어야 하는 글(제목) */
  text?: string
}

export function expectOf(spec: FileSpec): Expect {
  if (spec.format === "xlsx") return { format: "xlsx", sheets: sheetNames(spec.sheets.map((s) => s.name)) }
  if (spec.format === "pptx") return { format: "pptx", slides: spec.slides.length + 1, text: spec.title }
  return { format: "docx", text: spec.title }
}

// ─── 다시 열어 검증 ─────────────────────────────────────────────────

export interface Verified {
  bytes: number
  sha256: string
  /** zip 안 파일 수 · 그중 XML 로 읽은 수 */
  entries: number
  xmlParts: number
  sheets?: string[]
  slides?: number
}

const REQUIRED: Record<FileFormat, string> = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" }

const xmlText = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) => m[1]).join("")

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

/**
 * 파일을 처음부터 다시 열어 본다 — zip(CRC 포함) · 필수 부품 · 모든 XML 파싱 · 시트/슬라이드 수 · 제목 글.
 * 하나라도 어긋나면 던진다(이유는 사람에게 그대로 보일 한국어).
 */
export async function verifyOfficeFile(buf: Buffer, expect: Expect): Promise<Verified> {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("zip 파일이 아닙니다")
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: true })
  } catch (e) {
    throw new Error(`zip 을 열지 못했습니다: ${e instanceof Error ? e.message : e}`)
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  for (const need of ["[Content_Types].xml", REQUIRED[expect.format]]) {
    if (!zip.file(need)) throw new Error(`필수 부품 ${need} 가 없습니다`)
  }
  const xml: Record<string, string> = {}
  for (const n of names) {
    if (!/\.(xml|rels)$/i.test(n)) continue
    const text = await zip.file(n)!.async("string")
    const ok = XMLValidator.validate(text)
    if (ok !== true) throw new Error(`XML 이 깨졌습니다: ${n} (${ok.err.msg})`)
    xml[n] = text
  }
  const out: Verified = {
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    entries: names.length,
    xmlParts: Object.keys(xml).length,
  }

  if (expect.format === "xlsx") {
    const wb = xml["xl/workbook.xml"]
    const declared = [...wb.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => unescape(m[1]))
    const parts = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    if (declared.length !== parts.length) throw new Error(`시트 수가 맞지 않습니다 (목록 ${declared.length} · 부품 ${parts.length})`)
    // 한 번 더 — 표 라이브러리로 읽어 본다(사람이 엑셀로 여는 것에 가깝다)
    const read = XLSX.read(buf, { type: "buffer" })
    if (read.SheetNames.join("\u0000") !== declared.join("\u0000")) throw new Error("시트 이름을 다시 읽지 못했습니다")
    if (expect.sheets && declared.join("\u0000") !== expect.sheets.join("\u0000")) {
      throw new Error(`시트가 요청과 다릅니다 (요청 ${expect.sheets.length} · 파일 ${declared.length})`)
    }
    out.sheets = declared
  }
  if (expect.format === "pptx") {
    const listed = [...xml["ppt/presentation.xml"].matchAll(/<p:sldId\s/g)].length
    const parts = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    if (listed !== parts.length) throw new Error(`슬라이드 수가 맞지 않습니다 (목록 ${listed} · 부품 ${parts.length})`)
    if (expect.slides !== undefined && parts.length !== expect.slides) {
      throw new Error(`슬라이드가 요청과 다릅니다 (요청 ${expect.slides} · 파일 ${parts.length})`)
    }
    if (expect.text) {
      const all = parts.map((p) => unescape(xmlText(xml[p], "a:t"))).join("\n")
      if (!all.includes(expect.text)) throw new Error("슬라이드에서 제목을 찾지 못했습니다")
    }
    out.slides = parts.length
  }
  if (expect.format === "docx" && expect.text) {
    const body = unescape(xmlText(xml["word/document.xml"], "w:t"))
    if (!body.includes(expect.text)) throw new Error("문서에서 제목을 찾지 못했습니다")
  }
  return out
}

// ─── 저장 → 다시 열기 → 실패면 지우기 ───────────────────────────────

export interface StoreOps {
  put: (key: string, body: Buffer, contentType: string) => Promise<void>
  /** 저장소에서 다시 읽은 바이트 전부 */
  get: (key: string) => Promise<Buffer>
  del: (key: string) => Promise<void>
}

/**
 * 저장소에 쓰고, 저장소에서 다시 읽어 같은 바이트인지 · 다시 검증해도 통과하는지 본다.
 * 하나라도 실패하면 저장한 것을 지우고 던진다 — 반쪽짜리를 남기지 않는다(NAS 에서 끝에 0 바이트가 붙어 잘린 사례가 있다).
 */
export async function storeVerified(ops: StoreOps, key: string, buf: Buffer, contentType: string, expect: Expect): Promise<Verified> {
  const first = await verifyOfficeFile(buf, expect)
  try {
    await ops.put(key, buf, contentType)
    const back = await ops.get(key)
    if (back.length !== buf.length || createHash("sha256").update(back).digest("hex") !== first.sha256) {
      throw new Error(`저장한 파일이 원본과 다릅니다 (${buf.length} → ${back.length} 바이트)`)
    }
    return await verifyOfficeFile(back, expect)
  } catch (e) {
    await ops.del(key).catch((err) => console.error("[agent/doc-files] 검증 실패한 파일을 지우지 못했습니다", { key, err }))
    throw e
  }
}

/** 확인 카드에 보일 내용 미리보기(글) — 무엇을 만들지 사람이 읽고 정한다 */
export function specPreviewText(spec: FileSpec): string {
  if (spec.format === "docx") return spec.body
  if (spec.format === "pptx") {
    return [
      `[표지] ${spec.title}${spec.subtitle ? ` — ${spec.subtitle}` : ""}`,
      ...spec.slides.map((s, i) => [`[${i + 2}] ${s.title}`, ...(s.bullets ?? []).map((b) => `  · ${b}`)].join("\n")),
    ].join("\n")
  }
  const names = sheetNames(spec.sheets.map((s) => s.name))
  return spec.sheets
    .map((s, i) => {
      const shown = s.rows.slice(0, 8).map((r) => r.map((c) => (c === null ? "" : String(c))).join(" | "))
      return [`[${names[i]}] ${s.rows.length}행`, ...shown, ...(s.rows.length > 8 ? [`… ${s.rows.length - 8}행 더`] : [])].join("\n")
    })
    .join("\n\n")
}

/** 구성 한 줄 — 「시트 2개(매출 13행 · 재고 5행)」 */
export function specShape(spec: FileSpec): string {
  if (spec.format === "docx") return `제목 「${spec.title}」 · 본문 ${spec.body.length.toLocaleString()}자`
  if (spec.format === "pptx") return `슬라이드 ${spec.slides.length + 1}장(표지 포함)`
  const names = sheetNames(spec.sheets.map((s) => s.name))
  return `시트 ${spec.sheets.length}개(${spec.sheets.map((s, i) => `${names[i]} ${s.rows.length}행`).join(" · ")})`
}
