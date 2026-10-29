import { z } from "zod"
import { AskOmnisRoomSchema, CreateOmnisRoomSchema } from "@/lib/schemas/chat-room"

// 에이전트 API 입력 — 화면(components/messenger/omnis-room.tsx)과 라우트(app/api/agent/**)가 같은 규칙을 쓴다

/** 새 대화 · 방에 묻기는 2단계와 같은 글 규칙 */
export const StartAgentRoomSchema = CreateOmnisRoomSchema
export const AgentTurnSchema = AskOmnisRoomSchema

/** 확인 카드 — planHash 는 화면이 받은 카드의 해시. 서버의 것과 다르면 승인하지 않는다 */
export const DecideAgentStepSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  planHash: z.string().regex(/^[0-9a-f]{64}$/, "잘못된 제안 해시입니다"),
})
