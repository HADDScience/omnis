import { z } from "zod"
import { AskOmnisRoomSchema, CreateOmnisRoomSchema } from "@/lib/schemas/chat-room"
import { ATTACH_MAX } from "@/lib/file-access"

// 에이전트 API 입력 — 화면(components/messenger/omnis-room.tsx)과 라우트(app/api/agent/**)가 같은 규칙을 쓴다

/**
 * 질문에 붙이는 파일 — POST /api/files(·/nas) 에 scope=private 로 올려 받은 id. 내 것 · 아직 안 붙은 것인지는
 * 서버가 DB 로 본다(lib/file-access.ts checkAttachable). 여기서는 모양 · 개수 · 중복만
 */
export const AgentFileIdsSchema = z
  .array(z.string().uuid("잘못된 파일 id 입니다"))
  .max(ATTACH_MAX, `파일은 한 번에 ${ATTACH_MAX}개까지 붙일 수 있어요`)
  .refine((ids) => new Set(ids).size === ids.length, "같은 파일을 두 번 붙였어요")

/** 새 대화 · 방에 묻기는 2단계와 같은 글 규칙 + 첨부 */
export const StartAgentRoomSchema = CreateOmnisRoomSchema.extend({ fileIds: AgentFileIdsSchema.optional() })
export const AgentTurnSchema = z.union([
  AskOmnisRoomSchema.options[0].extend({ fileIds: AgentFileIdsSchema.optional() }),
  AskOmnisRoomSchema.options[1],
])

/** 확인 카드 — planHash 는 화면이 받은 카드의 해시. 서버의 것과 다르면 승인하지 않는다 */
export const DecideAgentStepSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  planHash: z.string().regex(/^[0-9a-f]{64}$/, "잘못된 제안 해시입니다"),
})
