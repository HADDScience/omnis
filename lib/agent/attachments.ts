// 옴니스 질문에 붙은 파일 → 모델이 읽는 질문. 순수 함수 — 파일을 여는 쪽은 lib/agent/attachments-server.ts.
//
// 이미지는 이미지 그대로(모델 입력의 file part), 글 파일(텍스트 · 엑셀 · PDF)은 본문을 뽑아 질문 글 뒤에 붙인다.
// 본문은 비밀 차단 규칙(lib/agent/secrets.ts)으로 값을 가린 뒤 길이를 자른다 — 모델에 비밀 값이 가지 않고,
// 한 질문이 실행당 상한(OMNIS_AGENT_MAX_KRW)을 첨부만으로 다 먹지 않게.
import { redactSecrets, findSecretsInText } from "./secrets"

export type AttachmentKind = "image" | "text" | "sheet" | "pdf" | "other"

/** 파일 하나에서 모델에 넣는 글자 수 상한. 한국어 1글자 ≈ 1토큰 안팎 */
export const ATTACH_TEXT_PER_FILE = 8_000
/** 한 질문의 첨부 글 전체 상한 — gpt-6.1-sol 로 첫 호출 약 45원(캐시 없이), 이어지는 호출은 캐시로 그 1/10 안팎 */
export const ATTACH_TEXT_TOTAL = 16_000
/** 한 질문에 넣는 이미지 수 */
export const ATTACH_IMAGE_MAX = 4
/** 모델에 보내는 이미지 긴 변 — lib/photo-describe.ts 와 같은 값(문서 사진의 글자를 읽을 만하고 토큰은 2천 안쪽) */
export const ATTACH_IMAGE_SIDE = 1280
/** 이보다 큰 파일은 열지 않는다(시놀로지 연결은 4MB 상한이 없다) */
export const ATTACH_READ_MAX_BYTES = 20 * 1024 * 1024

export function attachmentKind(name: string, mimeType: string): AttachmentKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const m = mimeType.split(";")[0].trim().toLowerCase()
  if (/^image\/(png|jpeg|gif|webp)$/.test(m) || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image"
  if (m === "application/pdf" || ext === "pdf") return "pdf"
  if (ext === "xlsx" || ext === "xls") return "sheet"
  if (m.startsWith("text/") || m === "application/json" || ["md", "txt", "csv", "tsv", "json", "log", "xml", "yaml", "yml"].includes(ext)) return "text"
  return "other"
}

export interface PreparedText {
  text: string
  /** 원문 글자 수(가리기 전) */
  chars: number
  clipped: boolean
  /** 가린 비밀 값 수 */
  redacted: number
}

/** 비밀 값을 먼저 가리고 → 상한까지 자른다. 자른 뒤 가리면 잘린 꼬리의 값이 남는다 */
export function prepareAttachmentText(raw: string, limit: number): PreparedText {
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim()
  const redacted = findSecretsInText(normalized).length
  const safe = redacted ? redactSecrets(normalized) : normalized
  const max = Math.max(0, limit)
  const clipped = safe.length > max
  return { text: clipped ? safe.slice(0, max) : safe, chars: normalized.length, clipped, redacted }
}

/** 파일 하나를 읽은 결과 — 서버 쪽이 채운다 */
export type ReadAttachment =
  | { name: string; kind: "image"; image: { base64: string; mediaType: string } | null; note?: string }
  | { name: string; kind: Exclude<AttachmentKind, "image">; raw: string | null; note?: string }

export interface AttachmentPart {
  type: "file"
  mediaType: string
  data: string
}

const KIND_LABEL: Record<AttachmentKind, string> = { image: "이미지", text: "텍스트", sheet: "엑셀(시트별 CSV)", pdf: "PDF 본문", other: "파일" }

/**
 * 질문 글 + 첨부 → 모델에 보내는 user 메시지 내용.
 * 글 첨부는 「<<<첨부 n」 … 「첨부 n>>>」 사이에 넣는다 — 그 안의 글은 자료이지 지시가 아니다(prompt.ts 「첨부 파일」).
 * 파일마다 PER_FILE, 전체 TOTAL 을 넘지 않게 앞에서부터 나눠 준다. 이미지는 IMAGE_MAX 개까지
 */
export function questionWithAttachments(question: string, files: ReadAttachment[]): { text: string; images: AttachmentPart[] } {
  if (files.length === 0) return { text: question, images: [] }
  let left = ATTACH_TEXT_TOTAL
  const images: AttachmentPart[] = []
  const blocks: string[] = []
  files.forEach((f, i) => {
    const n = i + 1
    const head = `[첨부 ${n}] ${f.name} — ${KIND_LABEL[f.kind]}`
    if (f.kind === "image") {
      if (f.image && images.length < ATTACH_IMAGE_MAX) {
        images.push({ type: "file", mediaType: f.image.mediaType, data: f.image.base64 })
        blocks.push(`${head}: 이 메시지에 이미지로 붙였습니다(${images.length}번째 이미지).`)
      } else {
        blocks.push(`${head}: ${f.note ?? `이미지는 한 번에 ${ATTACH_IMAGE_MAX}장까지만 봅니다 — 이 이미지는 보지 못했습니다.`}`)
      }
      return
    }
    if (f.raw === null) {
      blocks.push(`${head}: ${f.note ?? "본문을 읽지 못했습니다."}`)
      return
    }
    const p = prepareAttachmentText(f.raw, Math.min(ATTACH_TEXT_PER_FILE, left))
    left -= p.text.length
    if (!p.text) {
      blocks.push(`${head}: ${p.chars === 0 ? "본문에 글자가 없습니다(스캔한 PDF 이면 글자를 뽑지 못합니다)." : "글자 상한에 닿아 본문을 넣지 못했습니다."}`)
      return
    }
    const notes = [
      `${p.chars.toLocaleString()}자`,
      p.clipped ? `앞 ${p.text.length.toLocaleString()}자만 넣음 — 나머지는 읽지 못했다고 밝히세요` : null,
      p.redacted ? `비밀로 보이는 값 ${p.redacted}개는 가림` : null,
    ].filter(Boolean)
    blocks.push(`${head} (${notes.join(" · ")})\n<<<첨부 ${n}\n${p.text}\n첨부 ${n}>>>`)
  })
  return { text: `${question}\n\n---\n사용자가 이 질문에 파일 ${files.length}개를 붙였습니다.\n\n${blocks.join("\n\n")}`, images }
}

/** 앞선 질문에 붙었던 파일 — 다음 질문의 대화 문맥에는 이름만 남긴다(본문 · 이미지는 그 질문에서만 읽는다) */
export function historyWithAttachmentNames(content: string, names: string[]): string {
  return names.length ? `${content}\n(첨부: ${names.join(" · ")} — 내용은 그 질문 때만 읽었습니다)` : content
}
