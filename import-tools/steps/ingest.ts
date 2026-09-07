// 1단계 — CSV 를 읽어 마스터에 합치고 세션을 다시 자른다.
import { basename } from "path"
import {
  ROOMS, mergeRawMessages, parseKakaoCsv, saveSessions, sessionize, type RawRow, type RawSession,
} from "../kakao-common"

export interface IngestResult { sessions: RawSession[]; added: number; rooms: Map<string, number> }

export function ingest(csvPaths: string[]): IngestResult {
  const incoming: RawRow[] = []
  const rooms = new Map<string, number>()
  for (const p of csvPaths) {
    const rows = parseKakaoCsv(p)
    rooms.set(rows[0]?.room ?? basename(p), rows.length)
    incoming.push(...rows)
  }
  for (const [room, n] of rooms) {
    const mark = ROOMS[room] ? "" : "  ← 이식 대상 아님 (1:1 대화는 넣지 않는다)"
    console.log(`  ${room}: ${n}건${mark}`)
  }
  const { all, added } = mergeRawMessages(incoming)
  const sessions = sessionize(all)
  saveSessions(sessions)
  const target = sessions.filter((s) => ROOMS[s.room])
  console.log(`  마스터 ${all.length}건 (새로 ${added}건) → 세션 ${sessions.length}개 · 이식 대상 ${target.length}개`)
  if (target.length > 0) {
    const last = target.reduce((a, b) => (a.end > b.end ? a : b))
    console.log(`  대상 기간 ~ ${last.end}`)
  }
  return { sessions, added, rooms }
}
