/**
 * 카톡에서 옮긴 글 중 첨부 실물을 못 받아 본문이 자리표시로만 남은 글 — 화면이 「흐린 첨부 칸」 으로 그린다.
 * DB 본문은 그대로 두고 그릴 때만 가른다. 순수 함수 — 시험: kakao-placeholder.test.ts
 *
 * 자리표시 꼴(~/work/omnis-reports/kakao-placeholder.md 1절, import-tools/steps/media-match.ts 의 ATTACHMENT_LINE 과 같은 말):
 *   `Photo` · `N photos` · `Video` · `File: 이름`. 뒤에 `The message has been deleted.` 가 붙은 글도 있다
 *   (CSV 는 다음 줄, 휴대폰 txt 는 같은 줄 뒤 — import-tools/kakao-common.ts).
 * `Emoticon` · `Voice Call` · `KakaoTalk Profile` 은 받을 실물이 없어 글 그대로 둔다.
 * 자리표시가 사람이 쓴 글과 한 글에 섞인 경우는 없다(마스터 0건) — 그래서 글 전체가 자리표시일 때만 가른다.
 */

export type MissingAttachment =
  | { kind: "photo"; count: number; deleted: boolean }
  | { kind: "video"; deleted: boolean }
  | { kind: "file"; name: string; deleted: boolean }

export const KAKAO_SOURCE_PREFIX = "kakao:"
export const KAKAO_DELETED_LINE = "The message has been deleted."
/** 흐린 칸 아래 작은 글씨 */
export const MISSING_ATTACHMENT_NOTE = "카톡 원본에만 있음"

const DELETED_TAIL = /\s*The message has been deleted\.\s*$/

interface MessageLike {
  sourceId?: string | null
  content: string
  files?: readonly unknown[] | null
}

/** 카톡에서 왔고 첨부가 없고 본문 전체가 자리표시인 글이면 그 첨부. 아니면 null */
export function kakaoMissingAttachment(m: MessageLike): MissingAttachment | null {
  if (!m.sourceId?.startsWith(KAKAO_SOURCE_PREFIX)) return null
  if ((m.files?.length ?? 0) > 0) return null
  const raw = m.content.replace(/\r\n/g, "\n").trim()
  const deleted = DELETED_TAIL.test(raw)
  const body = (deleted ? raw.replace(DELETED_TAIL, "") : raw).trim()
  if (!body || body.includes("\n")) return null
  if (body === "Photo") return { kind: "photo", count: 1, deleted }
  const photos = body.match(/^(\d+) photos$/)
  if (photos) {
    const count = Number(photos[1])
    return count > 0 ? { kind: "photo", count, deleted } : null
  }
  if (body === "Video") return { kind: "video", deleted }
  const file = body.match(/^File: (.+)$/)
  if (file && file[1].trim()) return { kind: "file", name: file[1].trim(), deleted }
  return null
}

/** 칸에 쓰는 이름 — 「사진」 · 「사진 3장」 · 「동영상」 · 파일 이름 */
export function missingAttachmentLabel(a: MissingAttachment): string {
  if (a.kind === "photo") return a.count > 1 ? `사진 ${a.count}장` : "사진"
  if (a.kind === "video") return "동영상"
  return a.name
}

/** 칸과 함께 남길 본문 — 자리표시 줄을 뺀 나머지(삭제 표시만 남는다). 없으면 빈 글 */
export function missingAttachmentRest(a: MissingAttachment): string {
  return a.deleted ? KAKAO_DELETED_LINE : ""
}

/**
 * 도구 결과(옴니스 · MCP)에 붙일 말 — 자리표시 글을 「첨부가 있다」 로 잘못 읽지 않게(2026-11-12 기능 요청:
 * 「File: …pdf」 를 찾아 「첨부 있음」 이라 했다가 「조회되지 않음」 으로 정정한 일). 대괄호 한 덩어리로 글 끝에 붙인다.
 */
export function missingAttachmentToolNote(a: MissingAttachment): string {
  const what = a.kind === "file" ? `「${a.name}」 파일` : missingAttachmentLabel(a)
  return `[첨부 없음 — ${what}은 카톡에서 옮길 때 받지 못해 옴니스에 원본이 없다. 열기 · 내려받기 불가. 카톡 원본이나 보낸 사람에게 요청해야 한다]`
}

/** 원본 파일이 없을 때 화면 · 답에 쓰는 한 줄 */
export const MISSING_ATTACHMENT_ADVICE = "원본 파일이 옴니스에 없습니다 — 카톡 원본이나 보낸 사람에게 요청하세요"
