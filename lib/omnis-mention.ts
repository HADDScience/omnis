// 사람 방(단톡 · 1:1)의 @옴니스 — 세션을 열고, 방에 짧은 안내를 남기고, 세션 참여자를 방과 맞춘다.
// 규칙(프롬프트 · 안내 글)은 lib/omnis-mention-rules.ts. 계획: mydocs/plans/2026-11-10-omnis-mention-session.md
//
// 세션 = 옴니스 1:1 방(OMNIS_DM) 하나. 방에서 연 세션은 originRoomId 로 그 방을 가리키고, 참여자 행을 그 방과 같게 둔다 —
// 그래서 roomAccess · 목록 · 검색 · 첨부 · MCP 가 고칠 것 없이 「그 방 참여자만」 을 지킨다.
// 실행(AgentRun)은 글을 쓴 사람의 것이다: 확인 카드는 그 사람만 누르고(checkDecision 의 ownerId), 비용도 그 사람에게 잡힌다.
import { prisma } from "@/lib/db"
import { postNotice } from "@/lib/omnis-mention-notice"
import { startAgentRoom } from "@/lib/agent/service"
import { agentOffReason } from "@/lib/agent/http"
import { mentionPrompt, sessionNameFrom, sessionNotice } from "@/lib/omnis-mention-rules"

export type MentionOutcome = { sessionId: string } | { refused: string } | null

/**
 * 사람 방에 막 올라간 글이 옴니스를 불렀으면 세션을 연다. 부르지 않았으면 null.
 * 방 참여자 확인은 부른 쪽(글 API)이 이미 했다. 카톡 이식 글은 이 길로 오지 않지만 규칙도 한 번 더 거른다.
 * 시작 안내는 실행을 열기 **전에** 남긴다 — 답이 빨리 끝나면 끝 안내가 시작 안내보다 먼저 쓰일 수 있다.
 */
export async function callOmnisFromRoom(input: {
  room: { id: string; memberIds: string[] }
  message: { content: string; sourceId?: string | null }
  requester: { id: string; name: string }
}): Promise<MentionOutcome> {
  const prompt = mentionPrompt(input.message)
  if (!prompt) return null
  const { room, requester } = input
  // 에이전트 라우트와 같은 조건 — 꺼져 있으면 방에 그렇게만 알린다
  const off = agentOffReason()
  if (off) {
    await postNotice(room.id, sessionNotice({ kind: "refused", error: off }), null)
    return { refused: off }
  }
  let noticeId: string | null = null
  const r = await startAgentRoom(requester.id, prompt, [], {
    origin: {
      roomId: room.id,
      memberIds: room.memberIds,
      name: sessionNameFrom(prompt, requester.name),
      beforeStart: async (sessionId) => {
        noticeId = await postNotice(room.id, sessionNotice({ kind: "start", requesterName: requester.name }), sessionId)
      },
    },
  })
  if (!r.ok) {
    // 시작 안내를 남긴 뒤 막혔으면(드문 경합) 그 줄의 「열기」 를 뗀다 — 빈 세션은 지워진다
    if (noticeId) await prisma.chatMessage.update({ where: { id: noticeId }, data: { sessionRoomId: null } }).catch(() => {})
    await postNotice(room.id, sessionNotice({ kind: "refused", error: r.error }), null)
    return { refused: r.error }
  }
  // 아무도 이 스트림을 읽지 않는다 — 실행은 Workflow 가 끝까지 돌리고, 답은 세션 방에 남는다
  void r.stream.cancel().catch(() => {})
  return { sessionId: r.roomId }
}
