// 옴니스에 남기면 안 되는 카톡 줄 — 제외 목록.
//
// 인턴방처럼 대표님이 없는 방은 그 전제로 편하게 쓴 말이 섞여 있다(대표님 이야기·뒷말·비밀번호·사생활).
// 옴니스의 채팅방은 전원이 읽고 AI 검색도 그 말을 꺼낸다. 그래서 사람이 고른 줄을 목록에 두고
//   - 이식할 때는 세션에서 빼서 메시지로도, 구조화 입력으로도, 카드의 원문 기록으로도 가지 않게 하고 (ingest)
//   - 이미 들어간 것은 redact.ts 가 가린다.
//
// 목록은 KAKAO_DATA_DIR/exclude.json — 원문이 들어 있어 저장소(공개)에 넣지 않는다.
// 세션 id 는 첫 메시지로 정해지므로, 줄을 빼도 세션 경계와 id 는 그대로 둔다 — 바꾸면 이미 만든 카드와 짝이 끊긴다.
import { DATA_DIR, messageSourceId, readJson, type RawSession } from "./kakao-common"

export interface ExcludeEntry {
  /** "kakao:<sha1>" 카톡 원본 키, 또는 "msg:<ChatMessage.id>" 손으로 옮긴 사본처럼 키가 없는 글 */
  key: string
  room?: string; t?: string; u?: string; m?: string
  cat: string; reason: string
}

export const EXCLUDE_FILE = `${DATA_DIR}/exclude.json`

export function loadExclude(): ExcludeEntry[] {
  return readJson<ExcludeEntry[]>(EXCLUDE_FILE, [])
}

/** 제외 목록의 줄을 세션에서 뺀다. 세션 id·경계는 그대로, 다 빠진 세션은 버린다. */
export function dropExcluded(sessions: RawSession[], exclude: ExcludeEntry[]): { sessions: RawSession[]; dropped: number } {
  const keys = new Set(exclude.map((e) => e.key))
  let dropped = 0
  const out: RawSession[] = []
  for (const s of sessions) {
    const msgs = s.msgs.filter((m) => !keys.has(messageSourceId(s.room, m)))
    dropped += s.msgs.length - msgs.length
    if (msgs.length > 0) out.push(msgs.length === s.msgs.length ? s : { ...s, msgs, n: msgs.length })
  }
  return { sessions: out, dropped }
}
