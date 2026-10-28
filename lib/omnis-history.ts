// 옴니스 1:1 방의 이전 글 → 모델에 넣을 대화 문맥. 순수 함수(prisma 없음) — 시험: lib/omnis-history.test.ts
//
// 길이 상한을 두는 이유: 방이 길어질수록 질문마다 앞의 대화 전부를 다시 보내 입력 토큰이 늘어난다.
// 오래된 글부터 버리고, 한 글이 너무 길면(표 · 긴 답) 앞부분만 남긴다.

export interface OmnisTurn {
  role: "user" | "model"
  text: string
}

export interface HistoryMessage {
  /** 옴니스가 쓴 글이면 true */
  fromOmnis: boolean
  content: string
}

/** 문맥에 넣는 최대 글 수(질문 · 답 합쳐) — 10 왕복 */
export const HISTORY_MAX_MESSAGES = 20
/** 문맥 전체 글자 수 상한. 한국어 1글자 ≈ 1토큰 안팎이라 대략 1만 2천 토큰 */
export const HISTORY_MAX_CHARS = 12_000
/** 글 하나의 상한 */
export const HISTORY_MESSAGE_MAX_CHARS = 3_000

/** 답에 붙은 각주 [1] · [1, 3] — 그 번호는 그때의 검색 결과를 가리켜 이번 질문에서는 뜻이 없다 */
const CITATIONS = /\s?\[\d+(?:\s*[,，~–-]\s*\d+)*\]/g

function clip(text: string): string {
  return text.length > HISTORY_MESSAGE_MAX_CHARS ? `${text.slice(0, HISTORY_MESSAGE_MAX_CHARS)}…(이하 생략)` : text
}

/**
 * 오래된 것 → 최근 순으로 받은 이전 글을 Gemini contents 로 바꾼다.
 * 결과는 user 로 시작해 model 로 끝나고 번갈아 온다 — 그 뒤에 이번 질문(user)이 붙는다.
 *  - 같은 쪽 글이 이어지면 한 턴으로 합친다
 *  - 답을 못 받은 질문(끝의 user)은 뺀다 — 실패한 질문 뒤에 새 질문이 오면 user 가 두 번 이어진다
 *  - 상한을 넘으면 오래된 턴부터 버린다
 */
export function buildOmnisHistory(messages: HistoryMessage[]): OmnisTurn[] {
  const recent = messages.slice(-HISTORY_MAX_MESSAGES)
  const turns: OmnisTurn[] = []
  for (const m of recent) {
    const raw = m.fromOmnis ? m.content.replace(CITATIONS, "") : m.content
    const text = clip(raw.trim())
    if (!text) continue
    const role = m.fromOmnis ? "model" : "user"
    const prev = turns.at(-1)
    if (prev && prev.role === role) prev.text = `${prev.text}\n\n${text}`
    else turns.push({ role, text })
  }

  while (turns.length > 0 && turns.at(-1)!.role === "user") turns.pop()

  let total = turns.reduce((n, t) => n + t.text.length, 0)
  // 왕복(user + model) 단위로 버려 순서가 깨지지 않게 한다
  while (total > HISTORY_MAX_CHARS && turns.length > 0) {
    const dropped = turns.splice(0, turns[0].role === "user" ? 2 : 1)
    total -= dropped.reduce((n, t) => n + t.text.length, 0)
  }
  while (turns.length > 0 && turns[0].role === "model") turns.shift()
  return turns
}
