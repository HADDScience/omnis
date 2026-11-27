/**
 * 공고 가점 뽑기 — 수집기(~/work/gov-grants) SQLite 의 공고 본문 · 첨부 텍스트에서 인증 · 자격 가점을 뽑아 GrantNotice 에 저장한다.
 * 수집기 이식(scripts/import-grants.ts) 뒤에 돌린다. 발췌가 그대로면(bonusTextHash) 다시 뽑지 않는다.
 *
 *   pnpm tsx scripts/extract-grant-bonus.ts [--data ~/work/gov-grants-data] [--limit 20] [--key notice:…,group:…]
 *                                           [--force] [--dry] [--out 결과.json] [--prod]
 *
 * --dry  저장하지 않는다(모델은 부르고 AiUsage 는 남는다). --out 은 발췌 · 항목 · 버린 수를 파일로(정확도 확인용).
 * --max-krw 3000  비용 상한(원). 지금까지 쓴 돈 + 건당 평균(처음에는 25원)이 상한을 넘으면 멈춘다.
 * --plan 모델을 부르지 않고 발췌 수 · 글자 수 · 예상 비용만 센다.
 * --prod DATABASE_URL 이 로컬이 아닐 때 필요하다 — 운영 쓰기는 승인 뒤에만.
 * 모델 · 비용: lib/ai-models.ts grant_bonus(옴니스 기본 gpt-6.1-sol, 추론 low). 공고 하나에 발췌 최대 1.8만 자.
 */
import fs from "node:fs"
import os from "node:os"
import { prisma } from "@/lib/db"
import { bonusExcerpt } from "@/lib/grant-bonus"
import { defaultDataDir, openCollector } from "./_collector"
import { excerptHash, extractNoticeBonus } from "@/lib/grant-bonus-extract"

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const dataDir = (opt("data") ?? defaultDataDir()).replace(/^~/, os.homedir())
const limit = Number(opt("limit") ?? 0) || Infinity
const keys = opt("key")?.split(",").map((s) => s.trim()).filter(Boolean)
const dry = flag("dry")
const force = flag("force")
const out = opt("out")
/** 비용 상한(원) — 다음 호출까지 더하면 넘을 것 같으면 그 자리에서 멈춘다 */
const maxKrw = Number(opt("max-krw") ?? 0) || Infinity

const host = new URL(process.env.DATABASE_URL ?? "postgres://x@localhost/x").hostname
console.log(`대상 DB: ${host}${dry ? " (저장 안 함)" : ""} · 수집기: ${dataDir}`)
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !flag("prod")) {
  console.error("로컬 DB 가 아니다 — 운영에 쓰려면 승인 뒤 --prod 를 붙인다. 멈춤.")
  process.exit(1)
}

const collector = openCollector(dataDir)
const { memberIds, partsOf } = collector
const db = { close: collector.close }

const rows = await prisma.grantNotice.findMany({
  where: keys ? { externalKey: { in: keys } } : {},
  select: { id: true, externalKey: true, title: true, bonusTextHash: true, bonusStatus: true, deadlineAt: true },
  orderBy: [{ deadlineAt: { sort: "asc", nulls: "last" } }],
})
// 접수 중(마감이 오늘 이후거나 없음)을 먼저 — 비용 상한에서 멈춰도 쓸모 있는 공고부터 뽑힌다
const today = new Date(`${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)}T00:00:00+09:00`)
const isOpen = (n: (typeof rows)[number]) => !n.deadlineAt || n.deadlineAt >= today
const notices = [...rows.filter(isOpen), ...rows.filter((n) => !isOpen(n))]

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
  if (excerpt) {
    const perCall = sum.calls ? sum.krw / sum.calls : 25
    if (sum.krw + perCall > maxKrw) {
      console.log(`비용 상한 ${maxKrw}원 — 지금 ${sum.krw.toFixed(1)}원 · 건당 약 ${perCall.toFixed(1)}원이라 여기서 멈춘다(남은 공고는 다음에 이어서)`)
      break
    }
    calls++
  }
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
