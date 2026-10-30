// 결과물 도구의 입력 규칙 — 순수 모듈(prisma · NAS 없음). 서버 쪽은 lib/agent/outputs.ts. 시험: lib/agent/outputs.test.ts
import { z } from "zod"
import { RECORD_KINDS } from "@/lib/schemas/company"
import { safeFileName, type FileSpec } from "./doc-files"

export const DraftSchema = z.object({
  kind: z.enum(["report", "mail_reply"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(30_000),
  to: z.string().max(300).optional(),
  subject: z.string().max(300).optional(),
  file_name: z.string().max(120).optional(),
})
export type Draft = z.infer<typeof DraftSchema>

/** 메일을 붙여 넣을 글 — 제목과 본문. 받는 사람은 메일 프로그램에서 고른다 */
export function mailCopyText(d: { subject?: string; body: string }): string {
  return d.subject?.trim() ? `제목: ${d.subject.trim()}\n\n${d.body.trim()}` : d.body.trim()
}

/** 초안을 워드 파일로 — 메일이면 머리에 받는 사람 · 제목을 적는다 */
export function draftAsFile(d: Draft): FileSpec {
  const isMail = d.kind === "mail_reply"
  const head = isMail ? [d.to?.trim() && `받는 사람: ${d.to.trim()}`, d.subject?.trim() && `제목: ${d.subject.trim()}`].filter(Boolean).join("\n") : ""
  return {
    format: "docx",
    file_name: safeFileName(d.file_name?.trim() || (isMail ? `메일 회신 초안 - ${d.title}` : d.title), "docx"),
    title: d.title,
    body: head ? `${head}\n\n${d.body}` : d.body,
  }
}

export const RecordItemSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  grade: z.enum(["MAJOR", "GENERAL"]),
  title: z.string().trim().min(2).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.string().max(100).optional(),
  organizer: z.string().max(200).optional(),
  confidential: z.boolean().optional(),
  evidence: z.string().trim().min(4).max(1_000),
  reason: z.string().max(300).optional(),
})
export const RecordItemsSchema = z.object({ items: z.array(z.unknown()).min(1).max(10) })
export type RecordItem = z.infer<typeof RecordItemSchema>

/**
 * 근거 문장에서 대화를 찾을 조각 — 따옴표 · 말줄임을 뗀 첫 줄(4자 이상)의 앞 40자.
 * 줄을 넘기지 않는다 — DB 의 글에는 줄바꿈이 그대로 있어, 이어 붙인 조각은 contains 로 찾지 못한다
 */
export function evidenceSnippet(evidence: string): string {
  const strip = (s: string) => s.replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』.…]+$/g, "")
  const line = evidence.split(/\n+/).map(strip).find((l) => l.length >= 4) ?? ""
  return line.slice(0, 40).trim()
}
