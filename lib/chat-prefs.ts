// 메신저 목록의 내 설정 — 읽음 · 즐겨찾기 · 폴더. 전부 사람마다 따로이고 남에게 보이지 않는다.
// 규칙(순수 함수): lib/chat-list.ts · 입력 검사: lib/schemas/chat-folder.ts
import { prisma } from "@/lib/db"
import {
  decideRoomKeyAccess,
  FOLDER_LIMIT,
  parseRoomKey,
  READ_BASELINE_KEY,
  RULE_FOLDER_INFO,
  FOLDER_NAME_MAX,
  FOLDER_RULES,
  isLiveFolderRule,
  type ChatFolderView,
  type FolderRule,
} from "@/lib/chat-list"
import type { CreateFolderInput } from "@/lib/schemas/chat-folder"

export type PrefResult<T = undefined> = { ok: true; value: T } | { ok: false; status: number; error: string }

const fail = (status: number, error: string) => ({ ok: false as const, status, error })

/** 이 사람이 이 방 키를 쓸 수 있는가 — 남의 1:1 방 · 없는 방 · 잘못된 키는 거부 */
export async function checkRoomKey(userId: string, key: string): Promise<ReturnType<typeof decideRoomKeyAccess>> {
  const parsed = parseRoomKey(key)
  if (!parsed) return "invalid"
  if (parsed.type === "task") {
    const task = await prisma.task.findUnique({ where: { id: parsed.id }, select: { id: true } })
    return decideRoomKeyAccess({ key, taskExists: !!task })
  }
  const room = await prisma.chatRoom.findUnique({
    where: { id: parsed.id },
    select: { kind: true, members: { where: { userId }, select: { userId: true } } },
  })
  return decideRoomKeyAccess({ key, room: room ? { kind: room.kind, isMember: room.members.length > 0 } : null })
}

/**
 * 거부 사유를 응답으로. 남의 1:1 방은 「없는 방」 과 같은 404 로 답한다 —
 * 403 과 404 가 갈리면 그 id 의 방이 있다는 것이 샌다.
 */
function keyRefusal(access: Exclude<Awaited<ReturnType<typeof checkRoomKey>>, "ok">) {
  return access === "invalid" ? fail(400, "잘못된 방입니다") : fail(404, "방을 찾을 수 없습니다")
}

// ─── 읽음 · 즐겨찾기 ─────────────────────────────────────

/**
 * 안 읽음을 세기 시작한 시각. 처음 목록을 연 순간 한 줄을 만든다.
 * 이 줄이 없으면 한 번도 안 연 전사방(글 1만 5천 건)이 전부 안 읽은 글이 된다.
 */
export async function ensureReadBaseline(userId: string): Promise<Date> {
  const row = await prisma.chatRoomPref.upsert({
    where: { userId_roomKey: { userId, roomKey: READ_BASELINE_KEY } },
    create: { userId, roomKey: READ_BASELINE_KEY, lastReadAt: new Date() },
    update: {},
    select: { lastReadAt: true },
  })
  return row.lastReadAt ?? new Date()
}

export async function setRoomPref(
  userId: string,
  input: { roomKey: string; favorite?: boolean; read?: true },
): Promise<PrefResult<{ favorite: boolean; lastReadAt: string | null }>> {
  const access = await checkRoomKey(userId, input.roomKey)
  if (access !== "ok") return keyRefusal(access)
  const data = {
    ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
    ...(input.read ? { lastReadAt: new Date() } : {}),
  }
  const row = await prisma.chatRoomPref.upsert({
    where: { userId_roomKey: { userId, roomKey: input.roomKey } },
    create: { userId, roomKey: input.roomKey, ...data },
    update: data,
    select: { favorite: true, lastReadAt: true },
  })
  return { ok: true, value: { favorite: row.favorite, lastReadAt: row.lastReadAt?.toISOString() ?? null } }
}

// ─── 폴더 ────────────────────────────────────────────────

/**
 * 보이는 폴더 — 수동 폴더와 지금 규칙(내 업무 · 프로젝트). 옛 규칙(전사방 · 업무방 · 단톡방) 폴더는 행을 남기고
 * 여기서 거른다. 목록 · 칩 · 순서 · 한도 · 이름 바꾸기 · 지우기가 모두 이 조건을 쓴다 — 숨긴 폴더는 없는 폴더와 같다
 */
const visibleFolders = (userId: string) => ({ userId, OR: [{ rule: null }, { rule: { in: [...FOLDER_RULES] } }] })

export async function listFolders(userId: string): Promise<ChatFolderView[]> {
  const rows = await prisma.chatFolder.findMany({
    where: visibleFolders(userId),
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, rule: true, order: true, projectId: true,
      project: { select: { name: true, archived: true } },
      rooms: { select: { roomKey: true }, orderBy: { addedAt: "asc" } },
    },
  })
  return rows.flatMap((f) =>
    isLiveFolderRule(f.rule)
      ? [{ id: f.id, name: f.name, rule: f.rule, order: f.order, projectId: f.projectId, project: f.project, roomKeys: f.rule ? [] : f.rooms.map((r) => r.roomKey) }]
      : [],
  )
}

export async function createFolder(userId: string, input: CreateFolderInput): Promise<PrefResult<ChatFolderView>> {
  const [count, last] = await Promise.all([
    prisma.chatFolder.count({ where: visibleFolders(userId) }),
    prisma.chatFolder.findFirst({ where: { userId }, orderBy: { order: "desc" }, select: { order: true } }),
  ])
  if (count >= FOLDER_LIMIT) return fail(400, `폴더는 ${FOLDER_LIMIT}개까지 만들 수 있어요`)

  let data: { name: string; rule: FolderRule | null; projectId: string | null }
  if (!("rule" in input)) {
    data = { name: input.name, rule: null, projectId: null }
  } else if (input.rule === "MY_TASKS") {
    // projectId 가 NULL 이라 DB 유일 제약이 걸러 주지 않는다 — 여기서 하나만
    if (await prisma.chatFolder.findFirst({ where: { userId, rule: "MY_TASKS" }, select: { id: true } })) {
      return fail(409, "「내 업무」 폴더가 이미 있어요")
    }
    data = { name: RULE_FOLDER_INFO.MY_TASKS.name, rule: "MY_TASKS", projectId: null }
  } else {
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { name: true, archived: true } })
    if (!project || project.archived) return fail(404, "프로젝트를 찾을 수 없습니다")
    if (await prisma.chatFolder.findFirst({ where: { userId, rule: "PROJECT", projectId: input.projectId }, select: { id: true } })) {
      return fail(409, `「${project.name}」 프로젝트 폴더가 이미 있어요`)
    }
    data = { name: (input.name ?? project.name).slice(0, FOLDER_NAME_MAX), rule: "PROJECT", projectId: input.projectId }
  }

  const f = await prisma.chatFolder.create({
    data: { userId, ...data, order: (last?.order ?? -1) + 1 },
    select: { id: true, name: true, order: true, projectId: true, project: { select: { name: true, archived: true } } },
  })
  return { ok: true, value: { ...f, rule: data.rule, roomKeys: [] } }
}

/** 내 보이는 폴더만 찾는다 — 남의 폴더 · 숨긴 옛 규칙 폴더 id 는 없는 폴더와 같다 */
async function ownFolder(userId: string, folderId: string) {
  return prisma.chatFolder.findFirst({ where: { id: folderId, ...visibleFolders(userId) }, select: { id: true, rule: true } })
}

export async function renameFolder(userId: string, folderId: string, name: string): Promise<PrefResult> {
  if (!(await ownFolder(userId, folderId))) return fail(404, "폴더를 찾을 수 없습니다")
  await prisma.chatFolder.update({ where: { id: folderId }, data: { name } })
  return { ok: true, value: undefined }
}

export async function deleteFolder(userId: string, folderId: string): Promise<PrefResult> {
  const { count } = await prisma.chatFolder.deleteMany({ where: { id: folderId, ...visibleFolders(userId) } })
  return count ? { ok: true, value: undefined } : fail(404, "폴더를 찾을 수 없습니다")
}

/** 새 순서는 내 보이는 폴더 id 전부여야 한다 — 빠지거나 남의 것이 섞이면 거부 */
export async function reorderFolders(userId: string, order: string[]): Promise<PrefResult> {
  const mine = await prisma.chatFolder.findMany({ where: visibleFolders(userId), select: { id: true } })
  const ids = new Set(mine.map((f) => f.id))
  if (order.length !== ids.size || new Set(order).size !== order.length || !order.every((id) => ids.has(id))) {
    return fail(400, "폴더 목록이 바뀌었습니다. 다시 불러온 뒤 순서를 바꿔 주세요")
  }
  await prisma.$transaction(order.map((id, i) => prisma.chatFolder.update({ where: { id }, data: { order: i } })))
  return { ok: true, value: undefined }
}

const RULE_FOLDER_REFUSAL = "자동 폴더는 규칙으로만 채워져요 — 방을 넣거나 빼려면 직접 만든 폴더를 쓰세요"

export async function addRoomToFolder(userId: string, folderId: string, roomKey: string): Promise<PrefResult> {
  const folder = await ownFolder(userId, folderId)
  if (!folder) return fail(404, "폴더를 찾을 수 없습니다")
  if (folder.rule) return fail(400, RULE_FOLDER_REFUSAL)
  const access = await checkRoomKey(userId, roomKey)
  if (access !== "ok") return keyRefusal(access)
  await prisma.chatFolderRoom.upsert({
    where: { folderId_roomKey: { folderId, roomKey } },
    create: { folderId, roomKey },
    update: {},
  })
  return { ok: true, value: undefined }
}

export async function removeRoomFromFolder(userId: string, folderId: string, roomKey: string): Promise<PrefResult> {
  const folder = await ownFolder(userId, folderId)
  if (!folder) return fail(404, "폴더를 찾을 수 없습니다")
  if (folder.rule) return fail(400, RULE_FOLDER_REFUSAL)
  await prisma.chatFolderRoom.deleteMany({ where: { folderId, roomKey } })
  return { ok: true, value: undefined }
}
