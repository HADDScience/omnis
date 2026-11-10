// 옴니스 방 화면이 「답을 못 받았다」 고 말할지 정하는 순수 함수. 시험: lib/agent/room-view.test.ts
//
// 2026-10-29 작업지시자 제보 — 답이 정상으로 오는데도 「이 질문에 아직 답을 받지 못했어요 · 다시 묻기」 가 떴다.
// 원인: 화면이 「스트림을 읽는 중인가(live · pending)」 만 보고 판정했다. 폰에서 앱을 바꿨다 오거나 새로고침하면
// 페이지가 새로 열리는데, 그때 서버의 실행은 RUNNING 이고 방의 마지막 글은 내 질문이다. 다시 붙기 스트림의
// 첫 바이트가 오기 전까지(로컬 실측 11초, 운영도 첫 응답까지 수 초) live 가 null 이라 「답을 못 받음」 으로 보였다.
// 연결이 끊긴 경우(화면 꺼짐 · 망 전환)도 같다 — 스트림만 끊겼고 서버는 답을 끝까지 쓴다.
// 그래서 판정에 「서버에 돌고 있는 실행이 있는가」 를 넣는다.

export interface RoomViewMessage {
  id: string
  fromOmnis: boolean
  createdAt: string
}

export interface RoomViewCard {
  status: string
  createdAt: string
}

/**
 * 답을 못 받은 내 글 — 「다시 묻기」 를 붙일 글. 없으면 null.
 * - 화면이 스트림을 읽는 중(busy)이거나, 서버에 돌고 있는 실행이 있으면(running) 아직 답하는 중이다
 * - 확인을 기다리는 카드가 있거나, 내 글 뒤에 카드가 생겼으면 답을 받은 것이다(카드가 답이다)
 * - 내가 멈춘 질문(stopped — 질문 id 가 키)은 못 받은 것이 아니다. 글 없이 멈췄어도 「답을 멈췄어요」 로 보인다
 */
export function unansweredQuestion<M extends RoomViewMessage>(input: {
  messages: M[]
  cards: RoomViewCard[]
  busy: boolean
  running: boolean
  stopped?: Record<string, string | null>
}): M | null {
  const last = input.messages.at(-1)
  if (!last || last.fromOmnis || input.busy || input.running) return null
  if (input.stopped && last.id in input.stopped) return null
  if (input.cards.some((c) => c.status === "PENDING")) return null
  if (input.cards.some((c) => c.createdAt > last.createdAt)) return null
  return last
}

/** 이 질문 뒤에 옴니스 글이 있는가 — 스트림이 오류로 끝났어도 답이 남았으면 오류를 띄우지 않는다 */
export function answeredAfter(messages: RoomViewMessage[], questionId: string | null): boolean {
  if (!questionId) return false
  const i = messages.findIndex((m) => m.id === questionId)
  return i >= 0 && messages.slice(i + 1).some((m) => m.fromOmnis)
}

/**
 * 보내는 중인 글을 따로 그릴지. 서버가 질문 글 id(x-question-id)를 주면 그 id 가 방 글에 들어왔는지로 본다.
 * 예전에는 글 내용과 「화면을 연 시각 뒤에 쓴 글인가」 로 대조했다 — 같은 말을 두 번 보내거나 폰 시계가
 * 서버보다 빠르면 틀렸다.
 */
export function showPendingBubble(messages: RoomViewMessage[], pending: { questionId: string | null } | null): boolean {
  if (!pending) return false
  if (!pending.questionId) return true
  return !messages.some((m) => m.id === pending.questionId)
}

/**
 * 방을 다시 읽은 최근 페이지(latest)에, 위로 올려 이미 받아 둔 앞 글(prev 중 latest 보다 앞)을 붙인다.
 * 다시 읽을 때마다 앞 글을 버리면 올려 보던 자리가 사라진다. 최근 페이지가 비면(방의 글을 다 지웠다) 그것을 따른다
 */
export function mergeLatest<M extends RoomViewMessage>(prev: M[], latest: M[]): M[] {
  if (latest.length === 0) return latest
  const first = latest[0].createdAt
  const ids = new Set(latest.map((m) => m.id))
  return [...prev.filter((m) => m.createdAt < first && !ids.has(m.id)), ...latest]
}

/** 위로 올려 받은 앞 페이지를 앞에 붙인다 — 겹치는 글은 한 번만 */
export function prependOlder<M extends RoomViewMessage>(prev: M[], older: M[]): M[] {
  const ids = new Set(prev.map((m) => m.id))
  return [...older.filter((m) => !ids.has(m.id)), ...prev]
}
