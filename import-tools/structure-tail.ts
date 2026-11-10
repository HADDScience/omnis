// 구조화의 「늘어난 뒷부분」 — 동기화가 사진과 그 지시 사이에서 끊겨도 지시어의 대상을 볼 수 있게 앞 메시지를 함께 준다.
// 순수 함수만 둔다(DB 없음). 실행: pnpm test:unit
import type { RawMessage, RawSession } from "./kakao-common"

/** 뒷부분 앞에 맥락으로 붙이는 메시지 수 */
export const TAIL_CONTEXT = 6

/**
 * 구조화한 뒤 늘어난 세션의 뒷부분. 앞 메시지는 `before` 로 따로 둔다 —
 * `msgs` 에 섞으면 structuredCounts 가 받은 수를 잘못 세고, 이미 처리한 대화로 카드가 또 생긴다.
 * 예: 16:36 사진까지 동기화 → 16:39 「요것을 카드에 넣으세요」 부터 뒷부분이면 사진이 입력에서 사라져
 *     뒤따라온 무관한 유튜브 링크가 대상이 됐다(2026-10-30 수상자 강연 카드).
 */
export function tailSession(s: RawSession, from: number): RawSession {
  const msgs = s.msgs.slice(from)
  return { ...s, id: `${s.id}@${from}`, start: msgs[0].t, n: msgs.length, msgs, before: s.msgs.slice(Math.max(0, from - TAIL_CONTEXT), from) }
}

/** 첨부 자리표시인가 — 앞 맥락에서 카드로 가져올 수 있는 것은 첨부뿐이다 */
export const isAttachment = (m: string) => /^(Photo|Video|\d+ photos)\s*$/.test(m.trim()) || m.startsWith("File: ")

/**
 * 업무가 고른 메시지. 번호가 없으면 세션 전체(예전 캐시), 있으면 범위 안의 것만 시간순으로.
 * 세션 안에서 업무 이야기와 잡담·다른 일이 1~2분 간격으로 섞이므로 세션을 통째로 붙이면 안 된다.
 * 음수 번호는 앞 맥락(`before`, -1 이 바로 앞)이고 첨부만 받는다 — 이미 처리한 대화가 다른 카드로 끌려오지 않게.
 */
export function pickMessages(d: { messages?: number[] }, s: RawSession): RawMessage[] {
  if (!Array.isArray(d.messages)) return s.msgs
  const before = s.before ?? []
  return [...new Set(d.messages)]
    .filter((i) => Number.isInteger(i) && i >= -before.length && i < s.msgs.length && (i >= 0 || isAttachment(before[before.length + i].m)))
    .sort((a, b) => a - b)
    .map((i) => (i < 0 ? before[before.length + i] : s.msgs[i]))
}
