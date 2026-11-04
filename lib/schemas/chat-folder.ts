import { z } from "zod"
import { FOLDER_NAME_MAX, FOLDER_RULES, parseRoomKey } from "@/lib/chat-list"

// 메신저 목록 — 폴더 · 즐겨찾기 · 읽음 API 의 입력(브라우저에서도 불러온다, prisma 없음).
// 규칙: lib/chat-list.ts · 서버: lib/chat-prefs.ts

/** room:<id> · task:<id>. `*`(안 읽음 기준 줄)은 받지 않는다 */
export const RoomKeySchema = z.string().refine((k) => parseRoomKey(k) !== null, "잘못된 방입니다")

export const FolderNameSchema = z
  .string()
  .trim()
  .min(1, "폴더 이름을 입력해 주세요")
  .max(FOLDER_NAME_MAX, `폴더 이름은 ${FOLDER_NAME_MAX}자 이내로 입력해 주세요`)

export const FolderRuleSchema = z.enum(FOLDER_RULES)

/**
 * 폴더 만들기 — { name } 은 수동 폴더, { rule: "MY_TASKS" } 는 내 업무,
 * { rule: "PROJECT", projectId, name? } 은 프로젝트 폴더(이름을 비우면 프로젝트 이름).
 * 옛 규칙(COMPANY · TASK · GROUP)은 받지 않는다
 */
export const CreateFolderSchema = z.union([
  z.object({ name: FolderNameSchema }).strict(),
  z.object({ rule: z.literal("MY_TASKS") }).strict(),
  z.object({ rule: z.literal("PROJECT"), projectId: z.string().min(1).max(64), name: FolderNameSchema.optional() }).strict(),
])
export type CreateFolderInput = z.infer<typeof CreateFolderSchema>

/** 폴더 순서 바꾸기 — 내 폴더 id 전부를 새 순서로 */
export const ReorderFoldersSchema = z.object({ order: z.array(z.string().min(1)).min(1).max(100) })

export const RenameFolderSchema = z.object({ name: FolderNameSchema })

export const FolderRoomSchema = z.object({ roomKey: RoomKeySchema })

/**
 * 방 하나에 대한 내 설정. read: true 면 지금까지 읽은 것으로, hidden: true 면 내 목록에서 지운다(옴니스 1:1 = 대화 삭제 ·
 * 사람 1:1 = 숨기기). 숨김을 받는 방 종류는 lib/chat-list.ts acceptsHidden — 서버가 방 종류를 보고 거부한다.
 * muted 는 이 방의 채팅 푸시 끄기(2026-10-29) — 어느 방이든 받는다(멘션 푸시 · 벨은 그대로)
 */
export const RoomPrefSchema = z
  .object({
    roomKey: RoomKeySchema,
    favorite: z.boolean().optional(),
    read: z.literal(true).optional(),
    hidden: z.literal(true).optional(),
    muted: z.boolean().optional(),
  })
  .refine(
    (v) => v.favorite !== undefined || v.read !== undefined || v.hidden !== undefined || v.muted !== undefined,
    "바꿀 것이 없습니다",
  )
