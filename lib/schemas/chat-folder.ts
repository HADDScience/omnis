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

/** 방 하나에 대한 내 설정. read: true 면 지금까지 읽은 것으로 */
export const RoomPrefSchema = z
  .object({ roomKey: RoomKeySchema, favorite: z.boolean().optional(), read: z.literal(true).optional() })
  .refine((v) => v.favorite !== undefined || v.read !== undefined, "바꿀 것이 없습니다")
