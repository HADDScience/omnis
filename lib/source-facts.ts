/**
 * 옴니스 답의 출처 글(CHAT_MESSAGE) — 어디서 쓴 글인지, 바로가기 주소, 첨부 · 첨부 없는 자리표시.
 * 순수 함수(시험: source-facts.test.ts). DB 를 읽는 쪽은 lib/source-messages.ts.
 * 쓰는 곳: 답의 각주 [n] 바로가기 · 답 아래 파일 카드(components/omnis/source-files.tsx), 옴니스 도구 결과(lib/omnis-mcp.ts search_knowledge).
 */
import { canSeeFile } from "@/lib/file-access"
import { kakaoMissingAttachment, missingAttachmentToolNote, type MissingAttachment } from "@/lib/kakao-placeholder"

export interface SourceFile {
  id: string
  name: string
  size: number
  mimeType: string | null
}

export interface SourceFact {
  /** 글 id */
  id: string
  /** 그 글로 가는 주소 — 방이나 업무방, 해시는 그 글(#m-<id>)이라 도착하면 그 글을 가운데 두고 강조한다 */
  href: string
  /** 「업무 「이름」」 · 「전사방」 · 방 이름 · 「1:1」 · 「옴니스 대화」 */
  place: string
  author: string
  createdAt: string
  /** 볼 수 있는 첨부만(방 참여자 · 전용 첨부 규칙을 지난 것) */
  files: SourceFile[]
  /** 카톡에서 옮길 때 실물을 받지 못한 자리표시 글이면 그 첨부 */
  missing: MissingAttachment | null
  /**
   * 첨부 없는 글이 본문에서 이름을 댄 파일 중, 이름이 똑같은 다른 곳의 첨부(볼 수 있는 것만). 이 글의 첨부가 아니다.
   * 글이 파일 이름만 말하고 실물은 다른 글에 붙어 있어 찾아가지 못하던 일 때문에 둔다(기능 요청 #232)
   */
  mentioned: MentionedFile[]
}

/** 이름이 같은 다른 곳의 첨부 — href 는 그 파일이 붙은 글(없으면 업무, 그것도 없으면 null) */
export interface MentionedFile extends SourceFile {
  href: string | null
}

export interface SourceRow {
  id: string
  roomId: string
  taskId: string | null
  sourceId: string | null
  content: string
  createdAt: Date
  author: string
  room: { kind: string; name: string | null }
  task: { name: string } | null
  /** 볼 수 있는 첨부 */
  files: SourceFile[]
  /** 이 글의 첨부 전체 수(못 보는 것 포함) — 못 보는 첨부가 있는 글을 「첨부 없음」 으로 잘못 말하지 않게. 없으면 files 수 */
  fileCount?: number
  /** pickMentionedFiles 가 고른 것 */
  mentioned?: MentionedFile[]
}

/** 글 하나로 가는 주소 — 업무에 묶인 글은 업무방, 아니면 그 방 */
export function sourceHref(row: { id: string; roomId: string; taskId: string | null }): string {
  const anchor = `#m-${encodeURIComponent(row.id)}`
  return row.taskId ? `/chat/task/${encodeURIComponent(row.taskId)}${anchor}` : `/chat/${encodeURIComponent(row.roomId)}${anchor}`
}

/** 어디서 쓴 글인지 사람이 읽을 이름 */
export function sourcePlace(row: Pick<SourceRow, "room" | "task">): string {
  if (row.task) return `업무 「${row.task.name}」`
  switch (row.room.kind) {
    case "COMPANY":
      return "전사방"
    case "DM":
      return "1:1 대화"
    case "OMNIS_DM":
      return "옴니스 대화"
    default:
      return row.room.name ? `「${row.room.name}」` : "단톡방"
  }
}

export function sourceFact(row: SourceRow): SourceFact {
  return {
    id: row.id,
    href: sourceHref(row),
    place: sourcePlace(row),
    author: row.author,
    createdAt: row.createdAt.toISOString(),
    files: row.files,
    missing: (row.fileCount ?? row.files.length) > 0 ? null : kakaoMissingAttachment({ sourceId: row.sourceId, content: row.content, files: [] }),
    mentioned: row.mentioned ?? [],
  }
}

/** 도구 결과(search_knowledge)에 붙일 한 줄 — 원문 자리 · 바로가기, 그리고 첨부(파일 ID) 또는 「첨부 없음」, 이름이 같은 파일 */
export function sourceFactToolLine(f: SourceFact): string {
  const head = `↳ 원문: ${f.place} · ${f.author} · 바로가기 ${f.href}`
  // 모델이 「이 글의 첨부」 로 말하지 않게 이름부터 갈라 적는다. 파일 ID 는 read_file 에 그대로 넘긴다
  const mentioned = f.mentioned.length
    ? ` · [이름이 같은 파일(이 글의 첨부 아님): ${f.mentioned.map((x) => `${x.name} (${x.id})${x.href ? ` 올린 곳 ${x.href}` : ""}`).join(", ")}]`
    : ""
  if (f.files.length) return `${head} · [첨부: ${f.files.map((x) => `${x.name} (${x.id})`).join(", ")}]`
  if (f.missing) return `${head} · ${missingAttachmentToolNote(f.missing)}${mentioned}`
  return head + mentioned
}

// ─── 본문이 이름을 댄 파일 ───────────────────────────────────────────────

/** 파일로 볼 확장자 — 사내에서 오가는 문서 · 표 · 발표 · 그림 · 압축. 「v2.0」 같은 판 번호를 파일로 읽지 않게 목록으로 둔다 */
const FILE_EXT = "pdf|hwpx|hwp|docx|doc|xlsx|xlsm|xls|csv|pptx|ppt|key|txt|md|rtf|zip|7z|png|jpeg|jpg|gif|heic|webp|svg|ai|psd|mp4|mov"
// 이름 칸: 빈칸 · 따옴표 · 꺾쇠 · 쉼표 · 경로 구분자가 아닌 것. 확장자 뒤에 영문 · 숫자가 이어지면 파일이 아니다(「보고서.pdfs」).
// 한글 조사(「보고서.pdf를」)는 이어져도 된다
const FILE_TOKEN = new RegExp(`[^\\s"'\`「」『』<>,，、/\\\\]+\\.(?:${FILE_EXT})(?![A-Za-z0-9_])`, "giu")

/** 한 글에서 찾아볼 이름 수 · 이어 붙일 파일 수 — 결과 한 줄이 길어지지 않게 */
export const MENTION_NAMES_MAX = 5
export const MENTION_FILES_MAX = 5

/** 맞대 보는 꼴 — 맥에서 올린 파일은 한글이 풀어진 꼴(NFD)이라 모아 쓴 꼴(NFC)로 맞추고, 대소문자는 가리지 않는다 */
export const fileNameKey = (name: string) => name.normalize("NFC").trim().toLowerCase()

/**
 * 첨부 없는 글이 이름을 댄 파일들. 첨부가 있는 글(못 보는 첨부 포함)은 그 첨부가 답이라 찾지 않는다.
 * 카톡 자리표시(「File: 이름」)는 빈칸이 든 이름도 통째로 쓴다. 본문의 이름은 빈칸에서 끊는다 —
 * 빈칸 든 이름을 앞말과 가를 수 없어서고, 잘못 끊긴 이름은 아래 정확히 같은 이름 대조에서 걸러진다.
 * 앞에 붙은 여는 괄호(「(견적서.xlsx」)는 뗀 이름도 함께 본다.
 */
export function mentionedFileNames(row: { content: string; sourceId: string | null; fileCount: number }): string[] {
  if (row.fileCount > 0) return []
  const out = new Map<string, string>()
  const add = (name: string) => {
    const n = name.normalize("NFC").trim()
    if (n && !out.has(fileNameKey(n))) out.set(fileNameKey(n), n)
  }
  const placeholder = kakaoMissingAttachment({ sourceId: row.sourceId, content: row.content, files: [] })
  if (placeholder?.kind === "file") add(placeholder.name)
  for (const m of row.content.matchAll(FILE_TOKEN)) {
    add(m[0])
    const bare = m[0].replace(/^[([{（［]+/u, "")
    if (bare !== m[0]) add(bare)
  }
  return [...out.values()].slice(0, MENTION_NAMES_MAX)
}

/** 이름이 같은지 DB 에서 찾아 온 첨부 하나 — 권한 판정에 쓸 칸까지 */
export interface MentionCandidate extends SourceFile {
  createdAt: Date
  privateToUserId: string | null
  taskId: string | null
  /** 붙은 글. 안 붙었으면 null */
  message: { id: string; roomId: string; taskId: string | null; deleted: boolean; roomMemberIds: string[] } | null
}

/**
 * 이름을 댄 파일 중 이어 붙일 것 — 이름이 똑같고(대소문자 · 한글 꼴만 무시) 이 사람이 볼 수 있는 것만, 새것부터 MENTION_FILES_MAX 개.
 * DB 쿼리도 visibleFileWhere 로 거르지만 여기서 canSeeFile 을 한 번 더 본다 — 쿼리를 고치다 권한이 빠져도 새지 않게.
 * publicOnly: 질문 경로(lib/omnis-ask.ts)처럼 답이 여러 사람 앞에 남는 자리 — 참여자 전용 파일은 잇지 않는다.
 * 지운 글에 붙은 파일, 출처 글 자신의 첨부(exclude)는 뺀다.
 */
export function pickMentionedFiles(
  names: readonly string[],
  candidates: readonly MentionCandidate[],
  opts: { userId: string; exclude?: ReadonlySet<string>; publicOnly?: boolean },
): MentionedFile[] {
  const wanted = new Set(names.map(fileNameKey))
  if (wanted.size === 0) return []
  const seen = new Set<string>()
  return [...candidates]
    .filter((c) => {
      if (seen.has(c.id) || opts.exclude?.has(c.id)) return false
      if (!wanted.has(fileNameKey(c.name))) return false
      if (c.message?.deleted) return false
      if (opts.publicOnly && c.privateToUserId !== null) return false
      const access = { privateToUserId: c.privateToUserId, messageId: c.message?.id ?? null, roomMemberIds: c.message ? c.message.roomMemberIds : null }
      if (!canSeeFile(access, opts.userId)) return false
      seen.add(c.id)
      return true
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MENTION_FILES_MAX)
    .map((c) => ({
      id: c.id,
      name: c.name,
      size: c.size,
      mimeType: c.mimeType,
      href: c.message ? sourceHref(c.message) : c.taskId ? `/tasks/${encodeURIComponent(c.taskId)}` : null,
    }))
}
