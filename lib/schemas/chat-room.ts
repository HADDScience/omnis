import { z } from "zod"
import { ATTACH_MAX } from "@/lib/file-access"

// 채팅방 — 메신저 목록 · 옴니스 방 API 가 같은 규칙을 쓴다(브라우저에서도 불러온다, prisma 없음).
// 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md

/** prisma 의 enum ChatRoomKind 와 같은 값. 늘리면 둘 다 고친다 */
export const CHAT_ROOM_KINDS = ["COMPANY", "TASK", "OMNIS_DM", "GROUP", "DM"] as const
export const ChatRoomKindSchema = z.enum(CHAT_ROOM_KINDS)
export type ChatRoomKind = z.infer<typeof ChatRoomKindSchema>

/** 옴니스에게 보내는 글 한 줄 */
export const OMNIS_MESSAGE_MAX = 1000
const omnisContent = z
  .string()
  .trim()
  .min(2, "2자 이상 입력해 주세요")
  .max(OMNIS_MESSAGE_MAX, `${OMNIS_MESSAGE_MAX}자 이내로 입력해 주세요`)

/**
 * 참여자만 보는 방(옴니스 1:1 · 사람 1:1 · 단톡방)의 글에 붙이는 파일 — POST /api/files(·/nas) 에 scope=private 로 올려 받은 id.
 * 내 것 · 아직 안 붙은 것인지는 서버가 DB 로 본다(lib/file-access.ts checkAttachable). 여기서는 모양 · 개수 · 중복만
 */
export const AttachFileIdsSchema = z
  .array(z.string().uuid("잘못된 파일 id 입니다"))
  .max(ATTACH_MAX, `파일은 한 번에 ${ATTACH_MAX}개까지 붙일 수 있어요`)
  .refine((ids) => new Set(ids).size === ids.length, "같은 파일을 두 번 붙였어요")

/** 새 대화 — 첫 글과 함께 옴니스 1:1 방을 만든다(빈 방을 미리 만들지 않는다) */
export const CreateOmnisRoomSchema = z.object({ content: omnisContent })

/** 옴니스 방에 묻기. 답을 못 받은 내 글을 다시 물을 때는 retryOf 에 그 글 id */
export const AskOmnisRoomSchema = z.union([
  z.object({ content: omnisContent }),
  z.object({ retryOf: z.string().min(1) }),
])

// ─── 사람끼리 대화(5단계) ─────────────────────────────────
// 규칙(1명 → 1:1, 2명 이상 → 단톡방)은 lib/chat-people-rules.ts planPeopleRoom

const peopleRoomName = z.string().trim().min(1, "방 이름을 입력해 주세요").max(40, "40자 이내로 입력해 주세요")
const userIds = z.array(z.string().min(1).max(64)).min(1, "한 명 이상 골라 주세요").max(30, "한 번에 30명까지 고를 수 있어요")

/** 「사람과 대화」 — 고른 사람으로 방을 열거나(1:1 이 있으면 그 방) 만든다. name 은 단톡방만 */
export const CreatePeopleRoomSchema = z.object({ userIds, name: peopleRoomName.optional() })
/** 단톡방 이름 바꾸기 */
export const RenamePeopleRoomSchema = z.object({ name: peopleRoomName })
/** 단톡방에 초대 */
export const InvitePeopleSchema = z.object({ userIds })
