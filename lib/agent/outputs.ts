// 옴니스 결과물 — 문서 초안 · 파일 만들기 · 대화 → 기록 제안. 계획서 4단계(mydocs/plans/2026-10-28-omnis-messenger-agent.md 「4. 결과물」).
// 서버 전용(prisma · NAS). Workflow 단계(store.ts)에서만 부른다.
//
// 셋 다 쓰기(위험 등급 CAUTION)라 3단계의 확인 흐름을 그대로 탄다 — 확인 카드(planHash) · 조건부 갱신 · 비밀 차단 · 한도 · 중지.
// 여기는 카드의 모양(buildOutputPreview)과 확인 뒤 실행(executeOutput)만 있다.
//
//   draft_document  보고서 · 메일 회신 초안 → [저장] 하면 워드 파일로 이 방에. 메일은 보내지 않는다(복사 단추)
//   create_file     docx · xlsx · pptx → [만들기] 하면 만들고 · 다시 열어 검증하고 · 이 방에 파일로
//   propose_records 대화에서 연혁 후보 → [제안 올리기] 하면 기존 연혁 제안 큐(RecordProposal, 사람이 채택)로
// 주간보고 초안은 기존 write_weekly_report(MCP 와 같은 함수)를 쓴다 — 카드 모양만 tools.ts buildPreview 에 있다.
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { PUBLIC_MESSAGE_WHERE } from "@/lib/chat-rooms"
import { getSystemUserId, SYSTEM_USER_ID } from "@/lib/system-user"
import { IS_DEMO, DEMO_STORAGE_MESSAGE } from "@/lib/demo"
import { RECORD_KINDS, RECORD_KIND_LABEL } from "@/lib/schemas/company"
import { isSameEvent, isSecretSignal } from "@/lib/record-proposals"
import {
  FILE_FORMATS, FORMAT_LABEL, FileSpecSchema, MIME, expectOf, buildFile, safeFileName, specPreviewText, specProblem, specShape, storeVerified,
  type FileSpec,
} from "./doc-files"
import { DraftSchema, RecordItemSchema, RecordItemsSchema, draftAsFile, evidenceSnippet, mailCopyText, type RecordItem } from "./output-rules"
import type { AgentToolSpec, PreviewChange, WritePreview } from "./tools"

export const OUTPUT_TOOLS = ["draft_document", "create_file", "propose_records"] as const
export type OutputTool = (typeof OUTPUT_TOOLS)[number]
export const isOutputTool = (name: string): name is OutputTool => (OUTPUT_TOOLS as readonly string[]).includes(name)

const WRITE_SUFFIX = " — 쓰기 도구다. 부르면 바로 실행되지 않고 사용자에게 확인 카드가 뜬다. 사용자가 확인한 뒤에만 실행된다."

const cellSchema = { type: ["string", "number", "boolean", "null"] }

export const OUTPUT_TOOL_SPECS: AgentToolSpec[] = [
  {
    name: "draft_document",
    description:
      "보고서 · 메일 회신 초안. 초안 카드(본문 미리보기)가 뜨고, 사용자가 [저장] 하면 이 대화방에 워드 파일(docx)로 남는다(방 주인만 본다). " +
      "메일은 보내지 않는다 — 사용자가 카드의 [복사] 로 메일 프로그램에 붙여 넣는다. 주간보고는 이 도구가 아니라 write_weekly_report." +
      WRITE_SUFFIX,
    schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["report", "mail_reply"], description: "report 보고서 · mail_reply 메일 회신" },
        title: { type: "string", description: "보고서 제목. 메일이면 짧은 이름(예: 「○○ 견적 회신」)" },
        body: { type: "string", description: "본문 마크다운. 제목(#) · 목록(-) · 표(|) 를 쓸 수 있다" },
        to: { type: "string", description: "메일 회신 — 받는 사람(이름 · 기관 · 주소)" },
        subject: { type: "string", description: "메일 회신 — 제목(예: 「RE: …」)" },
        file_name: { type: "string", description: "저장할 파일 이름(확장자 없이). 생략하면 title" },
      },
      required: ["kind", "title", "body"],
    },
    risk: "write",
  },
  {
    name: "create_file",
    description:
      "워드(docx) · 엑셀(xlsx) · 파워포인트(pptx) 파일을 만든다. 내용만 JSON 으로 주면 모양은 서버가 정한다. " +
      "[만들기] 하면 파일을 만들고 다시 열어 검증한 뒤 이 대화방에 붙인다(방 주인만 본다). " +
      "docx: title · body(마크다운). xlsx: sheets=[{ name, rows: [[머리줄…], [값…]] }] (첫 줄은 열 이름). pptx: title · subtitle · slides=[{ title, bullets[], notes }] (표지는 자동). " +
      "숫자는 문자열이 아니라 숫자로 넣는다. 도구 결과에 있는 값만 넣는다." +
      WRITE_SUFFIX,
    schema: {
      type: "object",
      properties: {
        format: { type: "string", enum: [...FILE_FORMATS] },
        file_name: { type: "string", description: "파일 이름(확장자 없이)" },
        title: { type: "string", description: "docx · pptx 제목" },
        body: { type: "string", description: "docx 본문 마크다운" },
        subtitle: { type: "string", description: "pptx 표지 부제" },
        sheets: {
          type: "array",
          description: "xlsx 시트들",
          items: {
            type: "object",
            properties: { name: { type: "string" }, rows: { type: "array", items: { type: "array", items: cellSchema } } },
            required: ["name", "rows"],
          },
        },
        slides: {
          type: "array",
          description: "pptx 본문 슬라이드(표지 뒤)",
          items: {
            type: "object",
            properties: { title: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, notes: { type: "string" } },
            required: ["title"],
          },
        },
      },
      required: ["format", "file_name"],
    },
    risk: "write",
  },
  {
    name: "propose_records",
    description:
      "대화에서 회사 연혁(수상 · 선정 · 협약 · 행사 참석 · 교육 · 위촉 …)으로 남길 만한 것을 연혁 제안으로 올린다. " +
      "근거는 이 대화방의 글이나 전사방 · 업무방 글(list_chat · get_task 로 읽은 것)에서 **문장 그대로** 옮긴다 — 서버가 대화에서 그 문장을 찾지 못하면 그 항목은 올리지 않는다. " +
      "[제안 올리기] 하면 연혁 제안 목록(옴니스 › AI 제안 › 연혁)에 올라가고, 연혁에 넣을지는 거기서 사람이 정한다. " +
      "특허 · 상표, 영업 미팅, 결과 없는 신청, 확정되지 않은 계획은 연혁이 아니다." +
      WRITE_SUFFIX,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "최대 10개",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...RECORD_KINDS], description: RECORD_KINDS.map((k) => `${k} ${RECORD_KIND_LABEL[k]}`).join(" · ") },
              grade: { type: "string", enum: ["MAJOR", "GENERAL"], description: "MAJOR 외부에 내세울 기관 확정 성과(선정 · 수상 · 협약 · 인증 · 위촉) · GENERAL 상세 연혁" },
              title: { type: "string", description: "연혁 한 줄 — 「기관 + 사건」" },
              date: { type: "string", description: "사건 날짜 YYYY-MM-DD. 모르면 생략" },
              period: { type: "string", description: "기간 원문(예: 2026.12.02~12.05)" },
              organizer: { type: "string", description: "주관 기관" },
              confidential: { type: "boolean", description: "대화에 「대외비 · 아직 비밀」 이 걸려 있으면 true" },
              evidence: { type: "string", description: "근거 문장 — 대화의 글에서 그대로 옮긴 부분(20~120자)" },
              reason: { type: "string", description: "왜 연혁인지 한 줄" },
            },
            required: ["kind", "grade", "title", "evidence"],
          },
        },
      },
      required: ["items"],
    },
    risk: "write",
  },
]

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const clip = (t: string, n = 400) => (t.length > n ? `${t.slice(0, n)}…` : t)

// ─── 초안 ───────────────────────────────────────────────────────────




const PRIVATE_FILE = "이 대화방에 파일로 붙고, 방 주인(나)만 목록 · 내려받기 할 수 있습니다."

function draftPreview(args: Record<string, unknown>): WritePreview {
  const r = DraftSchema.safeParse(args)
  const isMail = args.kind === "mail_reply"
  if (!r.success) {
    const i = r.error.issues[0]
    return { title: isMail ? "메일 회신 초안" : "보고서 초안", target: s(args.title) || "(제목 없음)", changes: [], risk: "", problem: `초안 형식이 맞지 않습니다 (${i.path.join(".")}: ${i.message})` }
  }
  const d = r.data
  const file = draftAsFile(d)
  if (d.kind === "mail_reply") {
    return {
      title: "메일 회신 초안",
      target: [d.to?.trim() && `받는 사람 ${d.to.trim()}`, d.subject?.trim() && `제목 ${d.subject.trim()}`].filter(Boolean).join(" · ") || d.title,
      changes: [{ label: "저장하면", before: null, after: `워드 파일 ${file.file_name}` }],
      draft: { body: d.body, copy: mailCopyText(d) },
      confirmLabel: "저장",
      risk: `메일은 보내지 않습니다 — [복사] 해서 메일 프로그램에 붙여 넣으세요. [저장] 하면 ${PRIVATE_FILE}`,
      ...(IS_DEMO ? { problem: DEMO_STORAGE_MESSAGE } : {}),
    }
  }
  return {
    title: "보고서 초안",
    target: d.title,
    changes: [{ label: "저장하면", before: null, after: `워드 파일 ${file.file_name}` }],
    draft: { body: d.body, copy: d.body },
    confirmLabel: "저장",
    risk: `${PRIVATE_FILE} 지식 카드처럼 구성원 모두에게 열리지 않습니다.`,
    ...(IS_DEMO ? { problem: DEMO_STORAGE_MESSAGE } : {}),
  }
}

function filePreview(args: Record<string, unknown>): WritePreview {
  const format = FILE_FORMATS.find((f) => f === args.format)
  const title = format ? `${FORMAT_LABEL[format]} 만들기` : "파일 만들기"
  const problem = specProblem(args)
  if (problem || !format) return { title, target: s(args.file_name) || "(이름 없음)", changes: [], risk: "", problem: problem ?? "형식은 docx · xlsx · pptx 중 하나입니다" }
  const spec = FileSpecSchema.parse(args)
  return {
    title,
    target: safeFileName(spec.file_name, spec.format),
    changes: [
      { label: "형식", before: null, after: `${spec.format.toUpperCase()} · ${FORMAT_LABEL[spec.format]}` },
      { label: "구성", before: null, after: specShape(spec) },
    ],
    draft: { body: specPreviewText(spec) },
    confirmLabel: "만들기",
    risk: `파일을 만든 뒤 다시 열어 검증하고(깨졌으면 지웁니다) ${PRIVATE_FILE}`,
    ...(IS_DEMO ? { problem: DEMO_STORAGE_MESSAGE } : {}),
  }
}

// ─── 기록 제안 ───────────────────────────────────────────────────────



interface Found {
  id: string
  content: string
  at: Date
  author: string
  where: "room" | "company"
}

/**
 * 근거 문장을 대화에서 찾는다 — 이 옴니스 방, 그다음 전사방 · 업무방(COMPANY 방) 글.
 * 사람끼리 방(DM · GROUP) · 남의 옴니스 방은 보지 않는다(기존 방침 — 참여자만 보는 대화는 기록 제안으로 나가지 않는다).
 */
async function findEvidence(roomId: string, evidence: string): Promise<Found | null> {
  const snip = evidenceSnippet(evidence)
  if (snip.length < 4) return null
  const select = { id: true, content: true, createdAt: true, author: { select: { name: true } } } as const
  const inRoom = await prisma.chatMessage.findFirst({
    // 사람이 쓴 글만 — 옴니스가 카드 앞에 남긴 요약 글을 근거로 삼지 않게
    where: { roomId, deletedAt: null, authorId: { not: SYSTEM_USER_ID }, content: { contains: snip } },
    orderBy: { createdAt: "desc" },
    select,
  })
  if (inRoom) return { id: inRoom.id, content: inRoom.content, at: inRoom.createdAt, author: inRoom.author.name, where: "room" }
  const pub = await prisma.chatMessage.findFirst({
    where: { ...PUBLIC_MESSAGE_WHERE, kind: "NORMAL", deletedAt: null, authorId: { not: SYSTEM_USER_ID }, content: { contains: snip } },
    orderBy: { createdAt: "desc" },
    select,
  })
  return pub ? { id: pub.id, content: pub.content, at: pub.createdAt, author: pub.author.name, where: "company" } : null
}

interface Evaluated {
  item: RecordItem | null
  title: string
  /** 올리지 않는 이유 — 없으면 올린다 */
  skip: string | null
  found: Found | null
  confidential: boolean
}

const kstDay = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

/** 항목마다 형식 · 근거 · 겹침을 본다. 카드(미리보기)와 실행이 같은 것을 부른다 — 그사이 같은 제안이 생겼으면 실행 때 걸러진다 */
async function evaluateRecordItems(roomId: string, raw: unknown[]): Promise<Evaluated[]> {
  const [records, proposals] = await Promise.all([
    prisma.companyRecord.findMany({ select: { title: true, startsOn: true, kind: true } }),
    prisma.recordProposal.findMany({
      where: { status: { in: ["PENDING", "ACCEPTED", "REJECTED", "AUTO_APPLIED"] } },
      select: { title: true, occurredOn: true, kind: true },
    }),
  ])
  const out: Evaluated[] = []
  for (const r of raw) {
    const p = RecordItemSchema.safeParse(r)
    const title = s((r as { title?: unknown })?.title) || "(제목 없음)"
    if (!p.success) {
      const i = p.error.issues[0]
      out.push({ item: null, title, skip: `형식이 맞지 않음(${i.path.join(".")})`, found: null, confidential: false })
      continue
    }
    const item = p.data
    const date = item.date ? new Date(`${item.date}T00:00:00Z`) : null
    const found = await findEvidence(roomId, item.evidence)
    const me = { title: item.title, date, kind: item.kind, proxy: found?.at ?? null }
    let skip: string | null = null
    if (!found) skip = "근거 문장을 이 대화방 · 전사방에서 찾지 못함"
    else if (records.some((x) => isSameEvent(me, { title: x.title, date: x.startsOn, kind: x.kind }))) skip = "이미 있는 연혁"
    else if (proposals.some((x) => isSameEvent(me, { title: x.title, date: x.occurredOn, kind: x.kind }))) skip = "이미 올린 제안"
    else if (out.some((o) => !o.skip && o.item && isSameEvent(me, { title: o.item.title, date: o.item.date ? new Date(`${o.item.date}T00:00:00Z`) : null, kind: o.item.kind }))) skip = "같은 요청 안에서 겹침"
    // 모델이 놓쳐도 근거 글에 비밀 표시가 있으면 대외비로 올린다 — 놓치면 밖으로 나간다(record-proposals 와 같은 규칙)
    const confidential = item.confidential === true || (!!found && isSecretSignal(found.content))
    out.push({ item, title: item.title, skip, found, confidential })
  }
  return out
}

function recordLine(e: Evaluated): string {
  const it = e.item
  if (!it) return e.title
  const head = [it.date ?? it.period ?? "날짜 모름", RECORD_KIND_LABEL[it.kind], it.grade === "MAJOR" ? "주요" : "일반", e.confidential ? "대외비" : null]
    .filter(Boolean)
    .join(" · ")
  const src = e.found ? `${e.found.where === "room" ? "이 대화" : "전사방"} · ${e.found.author} ${kstDay(e.found.at)}` : null
  return [head, it.title, it.organizer ? `주관 ${it.organizer}` : null, `근거${src ? `(${src})` : ""}: 「${clip(it.evidence, 120)}」`].filter(Boolean).join("\n")
}

async function recordsPreview(args: Record<string, unknown>, roomId: string): Promise<WritePreview> {
  const base = { title: "연혁 제안 올리기", risk: "" }
  const parsed = RecordItemsSchema.safeParse(args)
  if (!parsed.success) return { ...base, target: "", changes: [], problem: "items(1~10개)가 필요합니다" }
  const evaluated = await evaluateRecordItems(roomId, parsed.data.items)
  const ok = evaluated.filter((e) => !e.skip)
  const changes: PreviewChange[] = evaluated.map((e, i) => ({
    label: e.skip ? `${i + 1} · 올리지 않음` : `${i + 1}`,
    before: null,
    after: e.skip ? `${e.title}\n— ${e.skip}` : recordLine(e),
  }))
  return {
    title: "연혁 제안 올리기",
    target: `${ok.length}건 올림${evaluated.length > ok.length ? ` · ${evaluated.length - ok.length}건 뺌` : ""}`,
    changes,
    confirmLabel: "제안 올리기",
    risk:
      "연혁 제안 목록(옴니스 › AI 제안 › 연혁)에 올라갑니다. 구성원 모두가 보는 목록이고, 근거 문장이 함께 보입니다. " +
      "연혁에 넣을지는 그 목록에서 사람이 채택 · 제외로 정합니다(바로 연혁이 되지 않습니다).",
    ...(ok.length === 0 ? { problem: "올릴 제안이 없습니다" } : {}),
  }
}

// ─── 카드 · 실행 ─────────────────────────────────────────────────────

export async function buildOutputPreview(name: OutputTool, args: Record<string, unknown>, ctx: { roomId: string }): Promise<WritePreview> {
  if (name === "draft_document") return draftPreview(args)
  if (name === "create_file") return filePreview(args)
  return recordsPreview(args, ctx.roomId)
}

export interface OutputCtx {
  runId: string
  roomId: string
  userId: string
}

/** 저장소 — 실제는 NAS(lib/storage). 시험은 바꿔 끼운다 */
async function nasOps() {
  const { putObject, getObject, deleteObject } = await import("@/lib/storage")
  return {
    put: putObject,
    get: async (key: string) => {
      const res = await getObject(key)
      const chunks: Buffer[] = []
      for await (const c of res.body) chunks.push(Buffer.from(c))
      return Buffer.concat(chunks)
    },
    del: deleteObject,
  }
}

const kb = (n: number) => (n < 1024 ? `${n}B` : `${Math.round(n / 1024)}KB`)

/**
 * 파일을 만들어 이 방에 붙인다 — 만들기 → 검증 → NAS 저장 → 다시 읽어 검증(실패면 지움) → 옴니스 글 + File 행.
 * File 은 옴니스 글(방 = 이 옴니스 1:1 방)에 붙고 privateToUserId = 방 주인이다 — 사람이 올린 옴니스 방 첨부와 같은 규칙(lib/file-access.ts canSeeFile:
 * 비공개 파일 · 메시지에 붙음 → 그 방 참여자만)을 탄다. 목록 · 내려받기 · MCP read_file 이 따로 판정하지 않는다.
 * DB 기록이 실패하면 NAS 의 파일도 지운다.
 */
export async function saveFileToRoom(spec: FileSpec, ctx: OutputCtx, note: string): Promise<{ ok: true; text: string; fileId: string } | { ok: false; text: string }> {
  if (IS_DEMO) return { ok: false, text: DEMO_STORAGE_MESSAGE }
  const name = safeFileName(spec.file_name, spec.format)
  const buf = await buildFile(spec)
  const { objectKeyFor, MAX_UPLOAD_BYTES } = await import("@/lib/storage")
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, text: `만든 파일이 너무 큽니다(${kb(buf.length)}). 내용을 줄여 다시 요청해 주세요.` }
  const id = randomUUID()
  const key = objectKeyFor(id, name)
  const ops = await nasOps()
  let verified
  try {
    verified = await storeVerified(ops, key, buf, MIME[spec.format], expectOf(spec))
  } catch (e) {
    return { ok: false, text: `파일을 저장하지 않았습니다 — 다시 열어 검증하다 실패해 지웠습니다: ${e instanceof Error ? e.message : e}` }
  }
  try {
    const systemId = await getSystemUserId()
    const now = new Date()
    await prisma.$transaction([
      prisma.chatMessage.create({ data: { roomId: ctx.roomId, authorId: systemId, content: note, createdAt: now, files: { create: { id, name, path: `/api/files/${id}/raw`, size: buf.length, mimeType: MIME[spec.format], privateToUserId: ctx.userId } } } }),
      prisma.chatRoom.update({ where: { id: ctx.roomId }, data: { lastMessageAt: now } }),
    ])
  } catch (e) {
    await ops.del(key).catch(() => {})
    throw e
  }
  const shape = verified.sheets ? ` · 시트 ${verified.sheets.length}개` : verified.slides ? ` · 슬라이드 ${verified.slides}장` : ""
  return {
    ok: true,
    fileId: id,
    text: `만들었습니다: ${name} (${kb(verified.bytes)}${shape}). 저장한 뒤 다시 열어 확인 — zip · XML ${verified.xmlParts}개 모두 정상. 이 대화방에 붙였습니다(파일 ID ${id}).`,
  }
}

export async function executeOutput(name: OutputTool, args: Record<string, unknown>, ctx: OutputCtx): Promise<{ ok: boolean; text: string }> {
  if (name === "create_file") {
    const p = FileSpecSchema.safeParse(args)
    if (!p.success) return { ok: false, text: specProblem(args) ?? "파일 형식이 맞지 않습니다" }
    return saveFileToRoom(p.data, ctx, `${FORMAT_LABEL[p.data.format]}를 만들었습니다.`)
  }
  if (name === "draft_document") {
    const p = DraftSchema.safeParse(args)
    if (!p.success) return { ok: false, text: "초안 형식이 맞지 않습니다" }
    return saveFileToRoom(draftAsFile(p.data), ctx, p.data.kind === "mail_reply" ? "메일 회신 초안을 저장했습니다. 메일은 보내지 않았습니다." : "보고서 초안을 저장했습니다.")
  }

  // propose_records — 카드와 같은 판정을 다시 한다(그사이 같은 제안이 생겼을 수 있다)
  const parsed = RecordItemsSchema.safeParse(args)
  if (!parsed.success) return { ok: false, text: "items 가 필요합니다" }
  const evaluated = await evaluateRecordItems(ctx.roomId, parsed.data.items)
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } })
  let created = 0
  for (const e of evaluated) {
    if (e.skip || !e.item || !e.found) continue
    const it = e.item
    const fields = {
      kind: it.kind,
      grade: it.grade,
      confidential: e.confidential,
      title: it.title,
      occurredOn: it.date ? new Date(`${it.date}T00:00:00Z`) : null,
      periodRaw: it.period?.trim() || null,
      organizer: it.organizer?.trim() || null,
    }
    await prisma.recordProposal.create({
      data: {
        ...fields,
        // 사람이 대화에서 고르고 확인 카드로 한 번 더 본 것 — 모델 확신이 아니라 사람 확인이라 1 로 두지 않고 0.9
        confidence: 0.9,
        reason: `${clip(it.reason ?? "", 200)}${it.reason ? " · " : ""}옴니스 대화에서 ${user?.name ?? "구성원"} 요청`,
        sourceRefs: [{
          kind: "message",
          id: e.found.id,
          label: `${e.found.where === "room" ? "옴니스 대화" : "전사방"} · ${e.found.author} ${kstDay(e.found.at)}`,
          at: kstDay(e.found.at),
          quote: clip(it.evidence, 200),
        }] as unknown as Prisma.InputJsonValue,
        original: { ...fields, occurredOn: it.date ?? null } as unknown as Prisma.InputJsonValue,
        trigger: "omnis_room",
      },
    })
    created++
  }
  const skipped = evaluated.filter((e) => e.skip)
  // 자동 등록(canAutoApply)은 하지 않는다 — 사람이 판단하는 큐로 올리는 것까지가 이 도구의 일이다
  return {
    ok: created > 0,
    text: [
      created > 0 ? `연혁 제안 ${created}건을 올렸습니다. 옴니스 › AI 제안 › 연혁(/omnis/proposals?tab=records)에서 채택 · 제외합니다.` : "올린 제안이 없습니다.",
      ...skipped.map((e) => `- 올리지 않음: ${e.title} — ${e.skip}`),
    ].join("\n"),
  }
}
