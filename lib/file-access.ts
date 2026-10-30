// 첨부 파일을 누가 보는가 — 판정은 이 파일 한 곳이다(2026-10-30, 옴니스 방 · 사람끼리 방 첨부).
//
//   File.privateToUserId = null  → 전사방 · 업무 첨부. 로그인한 구성원 모두(예전 그대로)
//   File.privateToUserId = 올린 사람
//     · 메시지에 붙기 전 → 올린 사람만
//     · 메시지에 붙은 뒤 → 그 방의 지금 참여자만(옴니스 1:1 은 방 주인, 사람 방은 나간 사람 제외 · 초대받은 사람 포함)
//
// 참여자만 보는 방의 파일은 반드시 privateToUserId 를 달고 올라온다(POST /api/files · /api/files/nas 의 scope=private).
// 붙이는 쪽(lib/agent/service.ts · lib/chat-people.ts)은 privateToUserId = 나 · 아직 안 붙은 파일만 받고(checkAttachable),
// 공개 쪽(전사방 글 · 업무 · MCP post_message)은 privateToUserId = null 인 파일만 잇는다(PUBLIC_FILE_WHERE).
// 그래서 「privateToUserId 가 있다 ⇔ 참여자만 보는 방의 파일」 이 늘 지켜진다.
//
// DB 를 읽는 쪽은 lib/file-access-server.ts(findVisibleFile). 여기는 순수 함수만 — 단위 시험이 DB 없이 돈다.

export interface FileAccessRow {
  privateToUserId: string | null
  messageId: string | null
  /** 붙은 메시지의 방 참여자 id. 메시지에 안 붙었으면 null */
  roomMemberIds: string[] | null
}

/** 이 사람이 이 파일을 볼 수 있는가 — 목록 · 내려받기 · 미리보기 · MCP read_file 이 같은 답을 쓴다 */
export function canSeeFile(file: FileAccessRow, userId: string): boolean {
  if (file.privateToUserId === null) return true
  if (file.messageId === null) return file.privateToUserId === userId
  return (file.roomMemberIds ?? []).includes(userId)
}

/** 목록 쿼리용 — canSeeFile 과 같은 규칙을 Prisma where 로 */
export function visibleFileWhere(userId: string) {
  return {
    OR: [
      { privateToUserId: null },
      { privateToUserId: userId, messageId: null },
      { privateToUserId: { not: null }, message: { room: { members: { some: { userId } } } } },
    ],
  }
}

/** 전사방 · 업무 · MCP 쪽에서 잇는 파일 — 참여자만 보는 방의 파일은 공개 자리로 옮기지 않는다 */
export const PUBLIC_FILE_WHERE = { privateToUserId: null } as const

/** 한 글에 붙일 수 있는 파일 수 */
export const ATTACH_MAX = 5

export type AttachCheck = { ok: true } | { ok: false; status: number; error: string }

/**
 * 참여자만 보는 방의 글에 붙이기 전 — 고른 id 가 모두 「내가 그 방에 붙이려고 올린, 아직 아무 데도 안 붙은」 파일인가.
 * 없는 파일 · 남의 파일 · 공개 파일은 같은 404(남의 파일이 있다는 것도 새지 않게), 이미 붙은 것은 409
 */
export function checkAttachable(
  ids: string[],
  rows: { id: string; privateToUserId: string | null; messageId: string | null; taskId: string | null }[],
  userId: string,
): AttachCheck {
  if (ids.length > ATTACH_MAX) return { ok: false, status: 400, error: `파일은 한 번에 ${ATTACH_MAX}개까지 붙일 수 있어요` }
  for (const id of ids) {
    const row = rows.find((r) => r.id === id)
    if (!row || row.privateToUserId !== userId) return { ok: false, status: 404, error: "첨부 파일을 찾을 수 없습니다 — 다시 올려 주세요" }
    if (row.messageId || row.taskId) return { ok: false, status: 409, error: "이미 다른 글에 붙은 파일입니다 — 다시 올려 주세요" }
  }
  return { ok: true }
}
