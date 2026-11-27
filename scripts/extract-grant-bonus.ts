/**
 * 공고 가점 뽑기 — 수집기(~/work/gov-grants) SQLite 의 공고 본문 · 첨부 텍스트에서 인증 · 자격 가점을 뽑아 GrantNotice 에 저장한다.
 * 수집기 이식(scripts/import-grants.ts) 뒤에 돌린다. 발췌가 그대로면(bonusTextHash) 다시 뽑지 않는다.
 *
 *   pnpm tsx scripts/extract-grant-bonus.ts [--data ~/work/gov-grants-data] [--limit 20] [--key notice:…,group:…]
 *                                           [--force] [--dry] [--out 결과.json] [--prod]
 *
 * --dry  저장하지 않는다(모델은 부르고 AiUsage 는 남는다). --out 은 발췌 · 항목 · 버린 수를 파일로(정확도 확인용).
 * --plan 모델을 부르지 않고 발췌 수 · 글자 수 · 예상 비용만 센다.
 * --prod DATABASE_URL 이 로컬이 아닐 때 필요하다 — 운영 쓰기는 승인 뒤에만.
 * 모델 · 비용: lib/ai-models.ts grant_bonus(옴니스 기본 gpt-6.1-sol, 추론 low). 공고 하나에 발췌 최대 1.8만 자.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { prisma } from "@/lib/db"
import { bonusExcerpt, type TextPart } from "@/lib/grant-bonus"
import { excerptHash, extractNoticeBonus } from "@/lib/grant-bonus-extract"

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const dataDir = (opt("data") ?? process.env.GOV_GRANTS_DATA ?? path.join(os.homedir(), "work/gov-grants-data")).replace(/^~/, os.homedir())
const limit = Number(opt("limit") ?? 0) || Infinity
const keys = opt("key")?.split(",").map((s) => s.trim()).filter(Boolean)
const dry = flag("dry")
const force = flag("force")
const out = opt("out")

const host = new URL(process.env.DATABASE_URL ?? "postgres://x@localhost/x").hostname
console.log(`대상 DB: ${host}${dry ? " (저장 안 함)" : ""} · 수집기: ${dataDir}`)
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !flag("prod")) {
  console.error("로컬 DB 가 아니다 — 운영에 쓰려면 승인 뒤 --prod 를 붙인다. 멈춤.")
  process.exit(1)
}

const db = new DatabaseSync(path.join(dataDir, "gov-grants.sqlite3"), { readOnly: true })
type Row = Record<string, string | number | null>
const q = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Row[]

/** 수집기 key → 구성 공고 id */
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

const notices = await prisma.grantNotice.findMany({
  where: keys ? { externalKey: { in: keys } } : {},
  select: { id: true, externalKey: true, title: true, bonusTextHash: true, bonusStatus: true },
  orderBy: [{ deadlineAt: { sort: "asc", nulls: "last" } }],
})

if (flag("plan")) {
  let withText = 0
  let chars = 0
  let changed = 0
  for (const n of notices) {
    const ex = bonusExcerpt(partsOf(memberIds(n.externalKey)))
    if (!ex) continue
    withText++
    chars += ex.length
    if (n.bonusTextHash !== excerptHash(ex)) changed++
  }
  // 어림: 한글 1자 ≈ 1토큰 + 지시문 900토큰, 출력 600토큰. 단가는 lib/ai-pricing.ts gpt-6.1-sol($2 · $10 / 100만 토큰)
  const inTok = chars + withText * 900
  const outTok = withText * 600
  const usd = (inTok * 2 + outTok * 10) / 1e6
  console.log(
    `계획 — 공고 ${notices.length} · 가점 문맥 있음 ${withText}(새로 뽑을 것 ${changed}) · 발췌 ${chars.toLocaleString()}자 · 어림 입력 ${inTok.toLocaleString()} · 출력 ${outTok.toLocaleString()} 토큰 · 약 $${usd.toFixed(2)}`
  )
  db.close()
  await prisma.$disconnect()
  process.exit(0)
}

const report: unknown[] = []
const sum = { ok: 0, no_text: 0, failed: 0, skipped: 0, items: 0, dropped: 0, krw: 0, calls: 0 }
let calls = 0
for (const n of notices) {
  if (calls >= limit) break
  const excerpt = bonusExcerpt(partsOf(memberIds(n.externalKey)))
  const hash = excerptHash(excerpt)
  if (!force && n.bonusTextHash === hash && (n.bonusStatus === "ok" || n.bonusStatus === "no_text")) {
    sum.skipped++
    continue
  }
  if (excerpt) calls++
  try {
    const r = await extractNoticeBonus(n.id, excerpt, { dryRun: dry })
    sum[r.status]++
    sum.items += r.items
    sum.dropped += r.dropped
    sum.krw += r.costKrw
    if (excerpt) sum.calls++
    if (r.status !== "no_text")
      console.log(`${r.status} · 항목 ${r.items}${r.dropped ? ` (버림 ${r.dropped})` : ""} · ${r.inputTokens}+${r.outputTokens} 토큰 · ${r.costKrw.toFixed(1)}원 · ${n.title}`)
    if (out) report.push({ key: n.externalKey, title: n.title, excerptChars: excerpt.length, excerpt, ...r })
  } catch (e) {
    sum.failed++
    console.error(`실패 · ${n.title}:`, e instanceof Error ? e.message : e)
  }
}
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2))
console.log(
  `끝 — 공고 ${notices.length} · 뽑음 ${sum.ok} · 가점 문맥 없음 ${sum.no_text} · 실패 ${sum.failed} · 그대로 ${sum.skipped} · 항목 ${sum.items} · 버린 근거 ${sum.dropped} · 모델 호출 ${sum.calls} · ${sum.krw.toFixed(1)}원`
)
db.close()
await prisma.$disconnect()
