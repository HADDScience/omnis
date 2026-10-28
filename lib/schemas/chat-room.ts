import { z } from "zod"

// 채팅방 — 메신저 목록 · 옴니스 방 API 가 같은 규칙을 쓴다(브라우저에서도 불러온다, prisma 없음).
// 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md

/** prisma 의 enum ChatRoomKind 와 같은 값. 늘리면 둘 다 고친다 */
export const CHAT_ROOM_KINDS = ["COMPANY", "TASK", "OMNIS_DM", "GROUP"] as const
export const ChatRoomKindSchema = z.enum(CHAT_ROOM_KINDS)
export type ChatRoomKind = z.infer<typeof ChatRoomKindSchema>

/** 옴니스에게 보내는 글 한 줄 */
export const OMNIS_MESSAGE_MAX = 1000
const omnisContent = z
  .string()
  .trim()
  .min(2, "2자 이상 입력해 주세요")
  .max(OMNIS_MESSAGE_MAX, `${OMNIS_MESSAGE_MAX}자 이내로 입력해 주세요`)

/** 새 대화 — 첫 글과 함께 옴니스 1:1 방을 만든다(빈 방을 미리 만들지 않는다) */
export const CreateOmnisRoomSchema = z.object({ content: omnisContent })

/** 옴니스 방에 묻기. 답을 못 받은 내 글을 다시 물을 때는 retryOf 에 그 글 id */
export const AskOmnisRoomSchema = z.union([
  z.object({ content: omnisContent }),
  z.object({ retryOf: z.string().min(1) }),
])
