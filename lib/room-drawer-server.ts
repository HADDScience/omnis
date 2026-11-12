// 방 서랍 · 「N개 받기」 의 DB 쪽 — /api/chat/drawer(목록) · /api/chat/drawer/download(받을 주소)가 부른다.
// 권한: 방은 roomAccess(채팅 글과 같다), 파일은 canSeeFile(lib/file-access.ts). 지운 글 · 시스템 글의 첨부는 없다.
// 규칙(기간 · 종류 · 링크)은 lib/room-drawer.ts 의 순수 함수.
import { prisma } from "@/lib/db"
import { roomAccess } from "@/lib/chat-rooms"
import { canSeeFile } from "@/lib/file-access"
import { displayAuthor, EXTERNAL_SPEAKER_SELECT } from "@/lib/external-speaker"
import { kakaoMissingAttachment, missingAttachmentLabel, KAKAO_SOURCE_PREFIX } from "@/lib/kakao-placeholder"
import { MAX_UPLOAD_BYTES } from "@/lib/constants"
import { fileResponseHeaders } from "@/lib/file-serving"
import { r2Config, signedGetUrl } from "@/lib/r2/server"
import {
  DOWNLOAD_MAX_FILES,
  extractLinks,
  linkHost,
  matchesKind,
  periodStart,
  type DrawerKind,
  type DrawerPeriod,
  type MissingItem,
} from "@/lib/room-drawer"

/** 한 번에 읽는 글 수 — 종류 필터는 읽은 뒤 거르므로 넉넉히 */
const FILE_PAGE = 120
const LINK_PAGE = 60
const MISSING_MAX = 500

export interface DrawerFile {
  fileId: string
  name: string
  size: number
  mimeType: string
  messageId: string
  createdAt: string
  author: { id: string; name: string }
  /** zip 안 이름에 쓰는 짧은 이름(외부 발화자는 소속 · 직급을 뺀다) */
  authorShort: string
  mine: boolean
}

export interface DrawerLink {
  url: string
  host: string
  messageId: string
  createdAt: string
  author: { id: string; name: string }
}

export interface DrawerMember {
  id: string
  name: string
  position: string | null
  /** 카톡에서 옮긴 글에만 나오는 사람(옴니스 계정 없음) */
  external?: boolean
}

/** 사람이 쓴 보통 글 — 지운 글 제외. 시스템 글(__ · 🤖 로 시작)은 읽은 뒤 isSystemContent 로 거른다 */
const NORMAL_MESSAGE = { kind: "NORMAL" as const, deletedAt: null }
/**
 * SQL 로 거르지 않는다 — Prisma startsWith 는 LIKE 이고 `_` 는 「아무 글자 하나」 라서 "__" 가 두 글자 이상인 모든 글을 뺀다
 * (2026-11-12 서랍 시험에서 글자 있는 글의 첨부가 통째로 빠졌다). /api/chat/photos 도 같은 이유로 JS 에서 거른다
 */
const isSystemContent = (content: string) => content.startsWith("__") || content.startsWith("🤖")

export type DrawerGate = { ok: true; kind: string; name: string } | { ok: false; status: number; error: string }

/** 방을 열 수 있는가 — 전사방은 구성원 모두, 나머지는 참여자만. 옴니스 1:1 · 업무방은 서랍이 없다 */
export async function drawerGate(roomId: string, userId: string): Promise<DrawerGate> {
  const access = await roomAccess(roomId, userId)
  if (access !== "ok") return { ok: false, status: access === "missing" ? 404 : 403, error: "이 방을 볼 수 없습니다" }
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { kind: true, name: true } })
  if (!room || !["COMPANY", "GROUP", "DM"].includes(room.kind)) return { ok: false, status: 404, error: "서랍이 없는 방입니다" }
  return { ok: true, kind: room.kind, name: room.name }
}

export async function listDrawerFiles(input: {
  roomId: string
  userId: string
  tab: "photos" | "files"
  period: DrawerPeriod
  kind: DrawerKind
  before: string | null
  now?: Date
}): Promise<{ files: DrawerFile[]; nextBefore: string | null; missing: MissingItem[] | null }> {
  const since = periodStart(input.period, input.now ?? new Date())
  const createdAt = { ...(since ? { gte: since } : {}), ...(input.before ? { lt: new Date(input.before) } : {}) }
  const rows = await prisma.file.findMany({
    where: {
      ...(input.tab === "photos" ? { mimeType: { startsWith: "image/" } } : { OR: [{ NOT: { mimeType: { startsWith: "image/" } } }, { mimeType: "image/svg+xml" }] }),
      message: { roomId: input.roomId, ...NORMAL_MESSAGE, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
    },
    orderBy: [{ message: { createdAt: "desc" } }, { createdAt: "asc" }],
    take: FILE_PAGE + 1,
    select: {
      id: true, name: true, size: true, mimeType: true, privateToUserId: true, messageId: true,
      message: {
        select: {
          id: true, createdAt: true, content: true,
          author: { select: { id: true, name: true } },
          externalSpeaker: EXTERNAL_SPEAKER_SELECT,
          room: { select: { members: { select: { userId: true } } } },
        },
      },
    },
  })
  const more = rows.length > FILE_PAGE
  // 한 글의 첨부가 페이지 경계에서 갈리지 않게, 넘친 글은 통째로 다음 페이지로
  const cut = more ? rows[FILE_PAGE].message!.createdAt.getTime() : null
  const files = rows
    .slice(0, FILE_PAGE)
    .filter((f) => cut === null || f.message!.createdAt.getTime() > cut)
    .filter((f) => !isSystemContent(f.message!.content))
    .filter((f) => matchesKind(input.tab, input.kind, f))
    .filter((f) => canSeeFile({ privateToUserId: f.privateToUserId, messageId: f.messageId, roomMemberIds: f.message!.room.members.map((m) => m.userId) }, input.userId))
    .map((f) => {
      const m = f.message!
      return {
        fileId: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        messageId: m.id,
        createdAt: m.createdAt.toISOString(),
        author: displayAuthor(m.author, m.externalSpeaker),
        authorShort: m.externalSpeaker?.name ?? m.author.name,
        mine: m.author.id === input.userId && !m.externalSpeaker,
      }
    })
  // 원본 없는 카톡 자리표시는 첫 페이지에서 한 번에(기간 · 탭 기준) — 받기 전에 「N개는 원본 없음」 을 알린다
  const missing = input.before ? null : await listMissing(input.roomId, input.tab, since)
  return { files, nextBefore: more ? new Date(cut!).toISOString() : null, missing }
}

async function listMissing(roomId: string, tab: "photos" | "files", since: Date | null): Promise<MissingItem[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      roomId,
      kind: "NORMAL",
      deletedAt: null,
      sourceId: { startsWith: KAKAO_SOURCE_PREFIX },
      files: { none: {} },
      ...(since ? { createdAt: { gte: since } } : {}),
      OR: tab === "photos" ? [{ content: { startsWith: "Photo" } }, { content: { contains: " photos" } }] : [{ content: { startsWith: "File: " } }, { content: { startsWith: "Video" } }],
    },
    orderBy: { createdAt: "desc" },
    take: MISSING_MAX,
    select: { id: true, sourceId: true, content: true, createdAt: true, author: { select: { id: true, name: true } }, externalSpeaker: EXTERNAL_SPEAKER_SELECT },
  })
  const out: MissingItem[] = []
  for (const m of rows) {
    const a = kakaoMissingAttachment({ sourceId: m.sourceId, content: m.content, files: [] })
    if (!a) continue
    if (tab === "photos" ? a.kind !== "photo" : a.kind === "photo") continue
    out.push({ messageId: m.id, createdAt: m.createdAt.toISOString(), authorName: m.externalSpeaker?.name ?? m.author.name, label: missingAttachmentLabel(a), kind: a.kind })
  }
  return out
}

export async function listDrawerLinks(input: { roomId: string; period: DrawerPeriod; before: string | null; now?: Date }): Promise<{ links: DrawerLink[]; nextBefore: string | null }> {
  const since = periodStart(input.period, input.now ?? new Date())
  const createdAt = { ...(since ? { gte: since } : {}), ...(input.before ? { lt: new Date(input.before) } : {}) }
  const rows = await prisma.chatMessage.findMany({
    where: { roomId: input.roomId, ...NORMAL_MESSAGE, content: { contains: "http" }, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
    orderBy: { createdAt: "desc" },
    take: LINK_PAGE + 1,
    select: { id: true, content: true, createdAt: true, author: { select: { id: true, name: true } }, externalSpeaker: EXTERNAL_SPEAKER_SELECT },
  })
  const page = rows.slice(0, LINK_PAGE)
  const links = page.filter((m) => !isSystemContent(m.content)).flatMap((m) =>
    extractLinks(m.content).map((url) => ({ url, host: linkHost(url), messageId: m.id, createdAt: m.createdAt.toISOString(), author: displayAuthor(m.author, m.externalSpeaker) })),
  )
  return { links, nextBefore: rows.length > LINK_PAGE ? page.at(-1)!.createdAt.toISOString() : null }
}

export async function listDrawerMembers(roomId: string, kind: string): Promise<DrawerMember[]> {
  const users =
    kind === "COMPANY"
      ? await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true } })
      : (await prisma.chatRoomMember.findMany({ where: { roomId }, orderBy: { joinedAt: "asc" }, select: { user: { select: { id: true, name: true, position: true } } } })).map((m) => m.user)
  // 카톡에서 옮긴 방 — 옴니스 계정 없이 글만 남은 사람
  const speakers = await prisma.externalSpeaker.findMany({
    where: { messages: { some: { roomId } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, title: true },
  })
  return [...users, ...speakers.map((s) => ({ id: `external:${s.id}`, name: s.name, position: s.title, external: true }))]
}

export interface DownloadTarget {
  fileId: string
  name: string
  size: number
  mimeType: string
  createdAt: string
  authorName: string
  /** 브라우저가 바로 받는 주소 — R2 는 짧은 서명 주소, 나머지는 /api/files/:id/raw(앞에 basePath 를 붙인다) */
  url: string
  /** url 이 같은 오리진 경로인가 */
  local: boolean
}

/**
 * 받을 파일의 주소. 이 방 글에 붙은 파일 · 내가 볼 수 있는 파일만 돌려주고 나머지는 skipped 로 센다(이유는 말하지 않는다 —
 * 남의 파일이 있다는 것도 새지 않게). 순서는 고른 순서.
 */
export async function resolveDownload(roomId: string, userId: string, fileIds: string[]): Promise<{ files: DownloadTarget[]; skipped: number }> {
  const ids = [...new Set(fileIds)].slice(0, DOWNLOAD_MAX_FILES)
  const rows = await prisma.file.findMany({
    where: { id: { in: ids }, message: { roomId, ...NORMAL_MESSAGE } },
    select: {
      id: true, name: true, size: true, mimeType: true, privateToUserId: true, messageId: true,
      r2Object: { select: { key: true } },
      message: {
        select: {
          createdAt: true, content: true,
          author: { select: { name: true } },
          externalSpeaker: { select: { name: true } },
          room: { select: { members: { select: { userId: true } } } },
        },
      },
    },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const useR2 = !!r2Config()
  const files: DownloadTarget[] = []
  for (const id of ids) {
    const f = byId.get(id)
    if (!f || isSystemContent(f.message!.content) || !canSeeFile({ privateToUserId: f.privateToUserId, messageId: f.messageId, roomMemberIds: f.message!.room.members.map((m) => m.userId) }, userId)) continue
    const r2Key = useR2 && f.size > MAX_UPLOAD_BYTES ? f.r2Object?.key : undefined
    const url = r2Key
      ? await signedGetUrl(r2Key, fileResponseHeaders({ mimeType: f.mimeType, name: f.name, attachment: true }), { isPrivate: f.privateToUserId !== null })
      : `/api/files/${f.id}/raw`
    files.push({
      fileId: f.id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      createdAt: f.message!.createdAt.toISOString(),
      authorName: f.message!.externalSpeaker?.name ?? f.message!.author.name,
      url,
      local: !r2Key,
    })
  }
  return { files, skipped: fileIds.length - files.length }
}
