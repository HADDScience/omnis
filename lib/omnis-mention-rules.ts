// 사람 방(단톡 · 1:1)의 @옴니스 — 순수 규칙(prisma 없음). 서버 쪽은 lib/omnis-mention.ts.
// 계획: mydocs/plans/2026-11-10-omnis-mention-session.md
//
// 언급 뒤에 오는 글이 그대로 프롬프트다. 방에는 짧은 안내만 남긴다(시작 한 줄 · 끝 한 줄) — 긴 답은 세션에 있다.

/** 사람 방에서 옴니스를 부르는 말 */
export const OMNIS_MENTION = "@옴니스"

// 앞: 글 처음이거나 띄어쓰기 · 여는 괄호 · 따옴표. 뒤: 「님」 은 붙여도 되고, 그다음은 글 끝 · 띄어쓰기 · 문장부호.
// 「@옴니스트」 처럼 낱말이 이어지면 부른 것이 아니다
const MENTION_RE = /(^|[\s(（「『"'“‘])@옴니스(?:님)?(?=$|[\s,.:;!?，。、·)）」』"'”’~-])[,.:;!?，。、·~-]*/

export interface MentionSource {
  content: string
  /** 들여온 원본 식별자 — 카톡 이식(`kakao:…`) 글의 @옴니스 는 실행하지 않는다 */
  sourceId?: string | null
}

/**
 * 이 글이 옴니스를 불렀으면 그 프롬프트, 아니면 null.
 * 프롬프트는 언급 **뒤**의 글이다. 뒤가 비었으면(「이거 정리해 줘 @옴니스」) 앞의 글을 쓴다. 둘 다 비면 부르지 않는다.
 * 첫 언급만 본다 — 뒤에 또 나오는 @옴니스 는 프롬프트의 일부다.
 */
export function mentionPrompt(msg: MentionSource): string | null {
  if (msg.sourceId?.startsWith("kakao:")) return null
  const m = MENTION_RE.exec(msg.content)
  if (!m) return null
  const start = m.index + m[1].length
  const after = msg.content.slice(m.index + m[0].length).trim()
  if (after) return after
  const before = msg.content.slice(0, start).trim()
  return before || null
}

/** 세션 이름 — 누가 불렀는지 앞에 둔다(공유 세션은 여러 사람 목록에 보인다) */
export function sessionNameFrom(prompt: string, requesterName: string, max = 30): string {
  const flat = prompt.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || `${requesterName}님의 요청`
}

/** 답 요약 — 방에 남기는 끝 줄. 마크다운 기호 · 각주를 떼고 앞 두 줄을 이어 붙여 자른다 */
export function answerSummary(answer: string, max = 120): string {
  const lines = answer
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/, "")
        .replace(/\*\*|__|`|\|/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\s?\[\d+(?:\s*[,，~–-]\s*\d+)*\]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((l) => l && !/^[-=:| ]+$/.test(l))
  const flat = lines.slice(0, 2).join(" ")
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export type SessionEnd = "DONE" | "AWAITING_APPROVAL" | "LIMIT" | "FAILED" | "STOPPED"

/** 방에 남기는 안내 한 줄. 시스템 글이라 🤖 로 시작한다(가운데 알약으로 그린다) */
export function sessionNotice(
  e: { kind: "start"; requesterName: string } | { kind: "end"; status: SessionEnd; requesterName: string; answer?: string } | { kind: "refused"; error: string },
): string {
  if (e.kind === "start") return `🤖 옴니스가 ${e.requesterName}님의 요청을 처리하고 있어요`
  if (e.kind === "refused") return `🤖 옴니스를 부르지 못했어요 · ${e.error}`
  switch (e.status) {
    case "DONE": {
      const s = e.answer ? answerSummary(e.answer) : ""
      return s ? `🤖 옴니스 답 · ${s}` : "🤖 옴니스가 답했어요"
    }
    case "AWAITING_APPROVAL":
      return `🤖 옴니스가 ${e.requesterName}님의 확인을 기다려요`
    case "LIMIT":
      return "🤖 옴니스가 실행 한도에 닿아 멈췄어요"
    case "STOPPED":
      return `🤖 ${e.requesterName}님이 옴니스를 멈췄어요`
    case "FAILED":
      return "🤖 옴니스가 답하지 못했어요"
  }
}

/** 끝을 알린 뒤 다시 알리지 않는 상태 — 확인 대기는 알리되, 확인 뒤 끝날 때 한 번 더 알린다 */
export function closesNotice(status: SessionEnd): boolean {
  return status !== "AWAITING_APPROVAL"
}
