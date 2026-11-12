/**
 * 옴니스 답의 출처 글(CHAT_MESSAGE) — 어디서 쓴 글인지, 바로가기 주소, 첨부 · 첨부 없는 자리표시.
 * 순수 함수(시험: source-facts.test.ts). DB 를 읽는 쪽은 lib/source-messages.ts.
 * 쓰는 곳: 답의 각주 [n] 바로가기 · 답 아래 파일 카드(components/omnis/source-files.tsx), 옴니스 도구 결과(lib/omnis-mcp.ts search_knowledge).
 */
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
  }
}

/** 도구 결과(search_knowledge)에 붙일 한 줄 — 원문 자리 · 바로가기, 그리고 첨부(파일 ID) 또는 「첨부 없음」 */
export function sourceFactToolLine(f: SourceFact): string {
  const head = `↳ 원문: ${f.place} · ${f.author} · 바로가기 ${f.href}`
  if (f.files.length) return `${head} · [첨부: ${f.files.map((x) => `${x.name} (${x.id})`).join(", ")}]`
  if (f.missing) return `${head} · ${missingAttachmentToolNote(f.missing)}`
  return head
}
