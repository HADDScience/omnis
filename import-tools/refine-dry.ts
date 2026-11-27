// 카드 다듬기 건식 비교 — 이미 이식된 카드에 판정을 돌려 「지금 방식(전부 붙임)」 과 나란히 본다. 카드와 글은 바꾸지 않는다.
//
//   1) 읽기:  npx tsx import-tools/refine-dry.ts export --target prod --since 2026-11-01 --room default-room --out DIR/cards.json
//             운영은 SET TRANSACTION READ ONLY 안에서 읽기만 한다. 결과 파일은 600.
//   2) 판정:  DATABASE_URL=<로컬 시험 DB> npx tsx import-tools/refine-dry.ts judge DIR/cards.json --out DIR/judged.json [--cap-usd 2]
//             Gemini 를 부른다(steps/refine.ts 의 judgeCard 그대로). 사용 기록(GeminiUsage · AiUsage)은 DATABASE_URL 쪽에 남는다 —
//             운영 주소면 멈춘다. 누적 비용이 상한을 넘으면 멈춘다.
//
// 「지금 방식」 은 그 카드에 지금 붙어 있는 글 전부다. 이식 뒤 사람이 옮긴 글도 들어 있다.
import { chmodSync, readFileSync, writeFileSync } from "fs"
import { pointAtProd } from "./prod-env"

const argv = process.argv.slice(2)
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

async function exportCards() {
  const out = opt("--out")
  if (!out) throw new Error("--out 이 필요하다")
  const since = opt("--since") ?? "2026-11-01"
  const room = opt("--room") ?? "default-room"
  if (opt("--target") === "prod") console.log(`읽을 곳: 🔴 운영 ${pointAtProd()} (READ ONLY)`)
  const { prisma } = await import("./kakao-common")
  const { loadCards } = await import("./steps/refine")
  const cards = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    const tasks = await tx.task.findMany({
      where: { sourceId: { startsWith: "kakao-task:" }, createdAt: { gte: new Date(`${since}T00:00:00+09:00`) }, messages: { some: { roomId: room } } },
      select: { id: true }, orderBy: { createdAt: "asc" },
    })
    console.log(`카드 ${tasks.length}개 (${since} 이후 · 방 ${room})`)
    // 새로 만든 카드로 보고 제목도 본다 — 「이번 이식에서 만들었다면」 을 재는 비교다
    return loadCards(tx, tasks.map((t) => ({ taskId: t.id, created: true })))
  }, { timeout: 600_000, maxWait: 30_000 })
  writeFileSync(out, JSON.stringify(cards, null, 1), { mode: 0o600 })
  chmodSync(out, 0o600)
  console.log(`카드 ${cards.length}개 · 글 ${cards.reduce((n, c) => n + c.messages.length, 0)}건 → ${out}`)
  await prisma.$disconnect()
}

async function judge() {
  const file = argv[1]
  const out = opt("--out")
  if (!file || !out) throw new Error("judge <cards.json> --out <file>")
  if ((process.env.DATABASE_URL ?? "").includes("neon.tech")) throw new Error("사용 기록이 운영에 남는다 — 로컬 시험 DB 를 DATABASE_URL 로 주세요")
  const cap = Number(opt("--cap-usd") ?? "2")
  const { prisma } = await import("../lib/db")
  const { judgeCard, relevanceModel, RELEVANCE_ENDPOINT } = await import("./steps/refine")
  const { worthCalling } = await import("../lib/card-relevance")
  const cards = JSON.parse(readFileSync(file, "utf8")) as import("../lib/card-relevance").CardInput[]
  const started = new Date()
  const spent = async () => Number((await prisma.aiUsage.aggregate({ where: { feature: RELEVANCE_ENDPOINT, createdAt: { gte: started } }, _sum: { costUsd: true } }))._sum.costUsd ?? 0)
  const mask = { phone: 0, mail: 0 }
  const results: Awaited<ReturnType<typeof judgeCard>>[] = []
  const model = relevanceModel()
  for (const [i, card] of cards.entries()) {
    const usd = await spent()
    if (usd > cap) throw new Error(`비용 상한 $${cap} 넘음 ($${usd.toFixed(4)}) — ${i}/${cards.length} 에서 멈춤`)
    const r = await judgeCard(card, { model, mask })
    results.push(r)
    const p = r.plan
    console.log(`${i + 1}/${cards.length} ${worthCalling(card) ? "판정" : "건너뜀"} 글 ${card.messages.length} · 뗌 ${p?.drop.length ?? "-"} · 애매 ${p?.unsure.length ?? "-"}${p?.rename ? ` · 제목 → ${p.rename.to}` : ""}${r.error ? ` · ✗ ${r.error}` : ""}`)
  }
  const usage = await prisma.aiUsage.aggregate({ where: { feature: RELEVANCE_ENDPOINT, createdAt: { gte: started } }, _sum: { costUsd: true, costKrw: true, inputTokens: true, outputTokens: true }, _count: true })
  writeFileSync(out, JSON.stringify({ model, at: started.toISOString(), mask, usage, results }, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 1), { mode: 0o600 })
  console.log(`끝 — 호출 ${usage._count} · 입력 ${usage._sum.inputTokens} · 출력 ${usage._sum.outputTokens} · $${Number(usage._sum.costUsd ?? 0).toFixed(4)} · 가린 전화번호 ${mask.phone} · 메일 ${mask.mail} → ${out}`)
  await prisma.$disconnect()
}

const cmd = argv[0]
;(cmd === "export" ? exportCards() : cmd === "judge" ? judge() : Promise.reject(new Error("export | judge")))
  .catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1) })
