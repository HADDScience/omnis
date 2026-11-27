// 수집기(~/work/gov-grants) SQLite 읽기 — 공고 가점 뽑기(extract-grant-bonus)와 첨부 상태 들이기(import-grant-attachment-status)가 같이 쓴다.
// 읽기 전용으로 연다. 옴니스 공고 key(group:… · notice:출처:id) → 수집기 구성 공고 → 본문 · 첨부.
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { TextPart } from "@/lib/grant-bonus"

export const defaultDataDir = () =>
  (process.env.GOV_GRANTS_DATA ?? path.join(os.homedir(), "work/gov-grants-data")).replace(/^~/, os.homedir())

type Row = Record<string, string | number | null>

export interface AttachmentRow {
  name: string
  download_block: string | null
  extract_status: string | null
  image_only: number | null
  local_path: string | null
}

export function openCollector(dataDir: string) {
  const db = new DatabaseSync(path.join(dataDir, "gov-grants.sqlite3"), { readOnly: true })
  const q = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Row[]

  /** 옴니스 key → 수집기 구성 공고 id */
  function memberIds(key: string): number[] {
    if (key.startsWith("group:"))
      return q("SELECT notice_id FROM group_members WHERE group_id = ? ORDER BY notice_id", key.slice(6)).map((r) => Number(r.notice_id))
    const m = key.match(/^notice:([^:]+):(.+)$/)
    if (!m) return []
    return q("SELECT id FROM notices WHERE source = ? AND source_id = ?", m[1], m[2]).map((r) => Number(r.id))
  }

  /** 본문(출처별) + 받은 첨부 텍스트(같은 파일은 한 번) */
  function partsOf(ids: number[]): TextPart[] {
    const parts: TextPart[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      const n = q("SELECT source, body_text FROM notices WHERE id = ?", id)[0]
      if (n?.body_text) parts.push({ source: `본문(${n.source})`, text: String(n.body_text) })
    }
    for (const id of ids) {
      for (const a of q(
        "SELECT name, sha256, text FROM attachments WHERE notice_id = ? AND extract_status IN ('ok','partial') AND text IS NOT NULL ORDER BY id",
        id
      )) {
        const k = String(a.sha256 ?? a.name)
        if (seen.has(k)) continue
        seen.add(k)
        parts.push({ source: `첨부: ${a.name}`, text: String(a.text) })
      }
    }
    return parts
  }

  /** 원문 목록에 지금 있는 첨부(listed_at 이 있는 것) — 상태 칸이 없는 옛 DB 면 빈 배열 */
  function attachmentRows(ids: number[]): AttachmentRow[] {
    const out: AttachmentRow[] = []
    for (const id of ids)
      for (const a of q(
        "SELECT name, download_block, extract_status, image_only, local_path FROM attachments WHERE notice_id = ? AND listed_at IS NOT NULL ORDER BY id",
        id
      ))
        out.push(a as unknown as AttachmentRow)
    return out
  }

  return { memberIds, partsOf, attachmentRows, close: () => db.close() }
}
