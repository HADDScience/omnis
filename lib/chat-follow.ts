/**
 * 채팅 목록 — 새 글이 붙을 때 맨 아래로 따라 내려갈지(순수 함수).
 *
 * 예전에는 새 글이 붙으면 무조건 맨 아래로 내려갔다. 옛 대화를 올려 읽다가 남이 한 줄 쓰면 읽던 자리를 잃었다.
 * 맨 아래 근처에 있거나 내가 보낸 글이면 따라가고, 아니면 자리를 지키고 「새 메시지 N개」 를 센다.
 * 맨 아래 판정은 옴니스 방과 같은 기준을 쓴다(lib/agent/scroll-follow.ts).
 */

type Row = { id: string; author: { id: string } }

/**
 * 직전에 그린 목록 뒤로 새로 붙은 글. 앞에 붙은 옛 글(위로 무한 스크롤)은 세지 않는다.
 * 보내는 중 말풍선이 맨 끝에 있어도 그 앞에 끼워진 남의 글을 센다 — 끝 id 만 보면 놓친다.
 * 직전 목록이 없거나 하나도 남지 않았으면(처음 그림 · 목록을 갈아 끼움) null.
 * 새 글이 없으면(고친 글 갈아 끼우기) 빈 배열 — 스크롤을 건드리지 않는다
 */
export function arrivals<T extends Row>(prevIds: ReadonlySet<string> | null, messages: T[]): T[] | null {
  if (!prevIds || prevIds.size === 0) return null
  const firstKnown = messages.findIndex((m) => prevIds.has(m.id))
  if (firstKnown === -1) return null
  return messages.slice(firstKnown + 1).filter((m) => !prevIds.has(m.id))
}

/** 붙은 글을 보고 따라갈지, 못 본 글을 몇 개 더 셀지 */
export function followOnAppend(
  appended: Row[],
  stuckToBottom: boolean,
  isMine: (m: Row) => boolean,
): { follow: boolean; unseen: number } {
  if (appended.length === 0) return { follow: false, unseen: 0 }
  if (stuckToBottom || appended.some(isMine)) return { follow: true, unseen: 0 }
  return { follow: false, unseen: appended.length }
}

/** 알약 문구 — 99 를 넘으면 줄인다 */
export function unseenLabel(n: number): string {
  return `새 메시지 ${n > 99 ? "99+" : n}개`
}
