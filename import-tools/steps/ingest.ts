// 1단계 — CSV(와 휴대폰 txt)를 읽어 마스터에 합치고 세션을 다시 자른다.
import { basename } from "path"
import {
  ROOMS, mergeRawMessages, parseKakaoCsv, parseKakaoMobileTxt, saveSessions, sessionize, type RawRow, type RawSession,
} from "../kakao-common"
import { EXCLUDE_FILE, dropExcluded, loadExclude } from "../redaction"

export interface IngestResult { sessions: RawSession[]; added: number; rooms: Map<string, number> }

export function ingest(csvPaths: string[], mobiles: { path: string; room: string }[] = []): IngestResult {
  const incoming: RawRow[] = []
  const rooms = new Map<string, number>()
  for (const p of csvPaths) {
    const rows = parseKakaoCsv(p)
    rooms.set(rows[0]?.room ?? basename(p), rows.length)
    incoming.push(...rows)
  }
  // 휴대폰 txt 는 PC CSV 뒤에 합친다 — 같은 줄이면 PC 줄(초까지 있는 것)이 남고, PC 에 없는 줄만 휴대폰에서 들어온다.
  for (const { path, room } of mobiles) {
    const rows = parseKakaoMobileTxt(path, room)
    rooms.set(room, (rooms.get(room) ?? 0) + rows.length)
    incoming.push(...rows)
    console.log(`  휴대폰 txt ${room}: ${rows.length}건 (${rows[0]?.t.slice(0, 10)} ~ ${rows.at(-1)?.t.slice(0, 10)})`)
  }
  for (const [room, n] of rooms) {
    const mark = ROOMS[room] ? "" : "  ← 이식 대상 아님 (1:1 대화는 넣지 않는다)"
    console.log(`  ${room}: ${n}건${mark}`)
  }
  const { all, added, sameAsMobile } = mergeRawMessages(incoming)
  if (sameAsMobile > 0) console.log(`  휴대폰으로 먼저 채운 줄과 같은 PC 줄 ${sameAsMobile}건은 넣지 않는다`)
  const { sessions, dropped } = dropExcluded(sessionize(all), loadExclude())
  if (dropped > 0) console.log(`  제외 목록(${EXCLUDE_FILE})의 ${dropped}줄은 넣지 않는다`)
  saveSessions(sessions)
  const target = sessions.filter((s) => ROOMS[s.room])
  console.log(`  마스터 ${all.length}건 (새로 ${added}건) → 세션 ${sessions.length}개 · 이식 대상 ${target.length}개`)
  if (target.length > 0) {
    const last = target.reduce((a, b) => (a.end > b.end ? a : b))
    console.log(`  대상 기간 ~ ${last.end}`)
  }
  return { sessions, added, rooms }
}
