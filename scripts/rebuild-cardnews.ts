/**
 * 옛 카드뉴스(아임웹 시절 이미지)를 새 레이아웃 덱으로 다시 만들어 Neon · NAS 에 넣는다.
 *
 *   npx tsx scripts/rebuild-cardnews.ts --site ~/work/hadd-website --ids 172288085,172288167 [--dry-run] [--prod]
 *
 * 입력은 사이트 저장소의 `content/data/cardnews-rebuild/<id>.json` — 사람이(또는 AI 가) 옛 카드를 읽어
 * 텍스트·레이아웃·사진 영역을 적어 둔 것. 이 스크립트가 하는 일:
 *
 *   1. 사진 영역을 옛 카드 이미지에서 잘라 NAS 에 올린다 (원본 사진 대신 쓴다)
 *   2. 한국어 덱 → Gemini 로 영문 덱 (lib/website-translate.ts, 편집기가 쓰는 것과 같은 길)
 *   3. 사이트의 검사 페이지(/admin/lint)에서 두 덱을 실제로 그려 넘침·고아 줄을 검사한다.
 *      고아 줄이 나오면 문장 끝 두 낱말 앞에 줄바꿈을 넣어 다시 그린다 (최대 3회). 그래도 남으면 보고서에 적는다.
 *   4. 카드를 PNG 로 구워 webp 로 NAS 에 올리고, WebsitePost 의 ko · en 블록과 deck 을 바꾼다
 *   5. 옛 카드 | 새 ko | 새 en 을 나란히 놓은 대조표와 원문 글자 대조 결과를 보고서 폴더에 남긴다
 *
 * 검증 기준은 픽셀 일치가 아니다 — 원문 텍스트 전부 포함 · 고아 줄 0 · 넘침 0.
 * 렌더는 브라우저(Playwright, 시스템 Chrome)로 한다. 사이트 dev 서버가 SITE_URL 에 떠 있어야 한다.
 * DB 대상은 import-website-posts.ts 와 같은 방식으로 지킨다 — Neon 이면 --prod 필요.
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import sharp from "sharp"

import { prisma } from "../lib/db"
import { Prisma } from "../generated/prisma"
import { CardDeckSchema, type Card, type CardDeck, type PostBlock, type PostLocale } from "../lib/schemas/website"
import { storeMedia } from "../lib/website-media"
import { sourceHash, translateDeck, translateLocale } from "../lib/website-translate"

// ─── 인자 ───────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined)
const SITE = path.resolve(opt("--site") ?? path.join(process.env.HOME ?? "", "work/hadd-website"))
const IDS = (opt("--ids") ?? "").split(",").filter(Boolean)
const DRY = flag("--dry-run")
const SITE_URL = opt("--site-url") ?? "http://localhost:3123"
const REPORT = path.resolve(opt("--report") ?? path.join(SITE, "mydocs/working/cardnews-rebuild"))
const MAX_FIX = 3
/** 보고서 폴더의 deck.en.json 이 있으면 번역을 건너뛴다 — dry-run 뒤 실제 실행에서 Gemini 를 두 번 쓰지 않게. */
const REUSE_EN = flag("--reuse-en")

if (!IDS.length) {
  console.error("--ids 가 필요하다")
  process.exit(1)
}
{
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "")
  console.log(`DB 대상: ${host}`)
  if (host.includes("neon.tech") !== flag("--prod")) {
    console.error(flag("--prod") ? "--prod 인데 Neon 이 아니다" : "Neon 인데 --prod 가 없다")
    process.exit(1)
  }
}

// ─── 입력 ───────────────────────────────────────────────────────────
interface SpecCard {
  source: string
  sourceText: string
  photo: [number, number, number, number] | null
  card: Card
  /** 원문 대조에서 뺄 줄. 사진 안에 박힌 글자(로고·표 이미지)처럼 새 카드에서 사진으로 남는 것. 이유를 함께 적는다. */
  omit?: { line: string; why: string }[]
  /** 이 옛 카드를 새 카드 여러 장으로 나눌 때: `card` 대신 쓴다. 대조는 합쳐서 한다. */
  cards?: Card[]
}
interface Spec {
  id: string
  title: string
  cards: SpecCard[]
}

// ─── 카드 텍스트(alt 용). 사이트 lib/cardnews.ts 의 cardText 와 같은 규칙 ───
const plain = (s?: string) => (s ?? "").replace(/<\/?b>/gi, "").replace(/\s+/g, " ").trim()
function cardText(card: Card, deck: CardDeck): string {
  const join = (...p: (string | undefined)[]) => p.map(plain).filter(Boolean).join(". ")
  if (card.type === "cover") return join(card.title, card.cta, card.handle || deck.handle)
  if (card.type === "quote") return join(card.badge, card.quote, card.attrib)
  switch (card.layout) {
    case "stat":
      return join(card.badge, card.headline, ...card.stats.map((s) => `${s.value}${s.unit ?? ""} ${s.label}`), card.body)
    case "list":
      return join(card.badge, card.headline, ...card.items.map((it) => join(it.title, it.desc)))
    case "text":
    case "overlay":
      return join(card.badge, card.headline, card.body, card.footnote)
    default:
      return join(card.badge, card.headline, card.subtitle, card.body, card.footnote)
  }
}

/** 카드의 글자 칸을 전부 잇는다. 원문 대조용. */
function allText(card: Card): string {
  if (card.type === "cover") return [card.title, card.cta].join(" ")
  if (card.type === "quote") return [card.badge, card.quote, card.attrib].join(" ")
  const parts: (string | undefined)[] = [card.badge, card.headline]
  if ("subtitle" in card) parts.push(card.subtitle)
  if ("body" in card) parts.push(card.body)
  if ("footnote" in card) parts.push(card.footnote)
  if (card.layout === "stat") card.stats.forEach((s) => parts.push(s.value, s.unit, s.label))
  if (card.layout === "list") card.items.forEach((it) => parts.push(it.title, it.desc))
  return parts.filter(Boolean).join(" ")
}
const norm = (s: string) => s.replace(/<\/?b>/gi, "").replace(/[\s​]+/g, "")

// ─── 고아 줄 자동 수정 ────────────────────────────────────────────
// 검사가 알려준 홀로 남은 글자(tail)로 문단을 찾아, 그 문단에서 tail 앞의 두 낱말을 tail 과 함께
// 다음 줄로 내린다(줄바꿈 삽입). 사람이 편집기에서 하는 것과 같은 손질이다.
type Issue = { kind: "orphan" | "overflow"; label: string; message: string; tail?: string }
const FIELDS = ["headline", "subtitle", "body", "footnote", "quote", "attrib", "title"]
const squash = (s: string) => s.replace(/\s+/g, "")
function pullDown(text: string, tail: string): string | null {
  const paras = text.split("\n")
  for (let p = 0; p < paras.length; p++) {
    if (!squash(paras[p]).endsWith(squash(tail))) continue
    const words = paras[p].trim().split(/\s+/)
    const tailWords = tail.trim().split(/\s+/).length
    const cut = words.length - tailWords - 2
    if (cut < 1) return null
    paras[p] = `${words.slice(0, cut).join(" ")}\n${words.slice(cut).join(" ")}`
    return paras.join("\n")
  }
  return null
}
function applyFix(card: Card, issue: Issue): boolean {
  if (!issue.tail) return false
  const c = card as unknown as Record<string, unknown>
  for (const f of FIELDS) {
    if (typeof c[f] !== "string") continue
    const next = pullDown(c[f] as string, issue.tail)
    if (next) {
      c[f] = next
      return true
    }
  }
  if (card.type === "chapter" && card.layout === "list") {
    for (const it of card.items) {
      for (const f of ["title", "desc"] as const) {
        const v = it[f]
        if (!v) continue
        const next = pullDown(v, issue.tail)
        if (next) {
          it[f] = next
          return true
        }
      }
    }
  }
  return false
}

// ─── 브라우저 ───────────────────────────────────────────────────────
interface Harness {
  load(deckJson: string): Promise<{ issues: Issue[][] }>
  png(i: number): Promise<string>
}
async function openHarness() {
  const browser = await chromium.launch({ channel: "chrome" })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  await page.goto(`${SITE_URL}/admin/lint/`, { waitUntil: "networkidle" })
  await page.waitForFunction(() => Boolean((window as unknown as { __cardnews?: Harness }).__cardnews), null, { timeout: 30_000 })
  const lint = (deck: CardDeck) =>
    page.evaluate((json) => (window as unknown as { __cardnews: Harness }).__cardnews.load(json), JSON.stringify(deck))
  const png = (i: number) => page.evaluate((k) => (window as unknown as { __cardnews: Harness }).__cardnews.png(k), i)
  return { browser, lint, png }
}

/** 렌더 → 검사 → 고아 줄이면 문장을 고쳐 다시. 남은 문제와 최종 덱을 돌려준다. */
async function settle(
  h: Awaited<ReturnType<typeof openHarness>>,
  deck: CardDeck,
  label: string
): Promise<{ deck: CardDeck; issues: Issue[][]; fixes: string[] }> {
  const fixes: string[] = []
  let current = deck
  for (let round = 0; ; round++) {
    const { issues } = await h.lint(current)
    const orphans = issues.flatMap((list, i) => list.filter((x) => x.kind === "orphan").map((x) => ({ i, x })))
    if (!orphans.length || round >= MAX_FIX) return { deck: current, issues, fixes }
    const next = structuredClone(current)
    let changed = false
    for (const { i, x } of orphans) {
      if (applyFix(next.cards[i], x)) {
        changed = true
        fixes.push(`${label} 카드 ${i + 1}: ${x.message} → 줄바꿈 삽입`)
      }
    }
    if (!changed) return { deck: current, issues, fixes }
    current = next
  }
}

// ─── 사진 ───────────────────────────────────────────────────────────
async function cropPhoto(site: string, id: string, source: string, box: [number, number, number, number]) {
  const file = path.join(site, "public/news", id, source)
  const [x, y, w, h] = box.map((v) => Math.max(0, Math.round(v))) as [number, number, number, number]
  return sharp(file).extract({ left: x, top: y, width: w, height: h }).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
}

// ─── 본체 ───────────────────────────────────────────────────────────
async function rebuild(id: string, h: Awaited<ReturnType<typeof openHarness>>, summary: string[]) {
  const spec = JSON.parse(fs.readFileSync(path.join(SITE, "content/data/cardnews-rebuild", `${id}.json`), "utf8")) as Spec
  const row = await prisma.websitePost.findUnique({ where: { id } })
  if (!row) throw new Error(`${id}: WebsitePost 없음`)
  const content = row.content as Partial<Record<"ko" | "en", PostLocale>>
  const ko = content.ko
  if (!ko) throw new Error(`${id}: ko 없음`)
  const reportDir = path.join(REPORT, id)
  fs.mkdirSync(reportDir, { recursive: true })

  // 옛 카드 하나가 새 카드 여러 장이 될 수 있다(넘치는 목록을 둘로). 평평하게 펴고 출처를 기억한다.
  const flat = spec.cards.flatMap((sc, si) => (sc.cards ?? [sc.card]).map((card) => ({ sc, si, card })))
  const baseCards = flat.map((f) => f.card)

  // 1) 사진: 자르고 올린다. 렌더에는 data URL, 저장에는 NAS URL.
  const dataUrls = new Map<number, string>()
  const mediaUrls = new Map<number, string>()
  for (const [i, { sc, card }] of flat.entries()) {
    const wantsPhoto = "image" in card && (card as { image?: { src: string } }).image?.src === "@photo"
    if (!wantsPhoto) continue
    if (!sc.photo) throw new Error(`${id} 카드 ${i + 1}: image 가 @photo 인데 photo 영역이 없다`)
    const buf = await cropPhoto(SITE, id, sc.source, sc.photo)
    fs.writeFileSync(path.join(reportDir, `photo-${String(i + 1).padStart(2, "0")}.webp`), buf)
    dataUrls.set(i, `data:image/webp;base64,${buf.toString("base64")}`)
    if (!DRY) {
      const stored = await storeMedia({ postId: id, bytes: buf, contentType: "image/webp", name: `rebuild-photo-${String(i + 1).padStart(2, "0")}.webp` })
      mediaUrls.set(i, stored.url)
    } else mediaUrls.set(i, `/omnis/api/website/media/${id}/rebuild-photo-${String(i + 1).padStart(2, "0")}.webp`)
  }
  /** 사진이 있는 카드의 src 를 표의 값으로 바꾼다(렌더용 data URL ↔ 저장용 NAS URL). */
  const withSrc = (cards: Card[], urls: Map<number, string>): Card[] =>
    cards.map((c, i) => {
      if (!("image" in c) || !c.image || !urls.has(i)) return c
      return { ...c, image: { ...c.image, src: urls.get(i)! } } as Card
    })
  const koDeck = CardDeckSchema.parse({ handle: "@haddscience", cards: withSrc(baseCards, mediaUrls) })
  const koRender: CardDeck = { handle: koDeck.handle, cards: withSrc(baseCards, dataUrls) }

  // 2) 원문 글자 대조 (덱 텍스트 ⊇ 옛 카드 텍스트)
  const missing: string[] = []
  spec.cards.forEach((sc, i) => {
    const have = norm((sc.cards ?? [sc.card]).map(allText).join(" ") + " @haddscience haddscience 알아보기")
    const omitted = new Set((sc.omit ?? []).map((o) => norm(o.line)))
    for (const raw of sc.sourceText.split("\n").map((l) => l.trim()).filter(Boolean)) {
      // 목록 카드의 "1 ", "• " 같은 표식은 마커로 그려지지 글자가 아니다
      const line = raw.replace(/^(\d{1,2}|[•·▪✅])\s+/, "")
      if (omitted.has(norm(line)) || omitted.has(norm(raw))) continue
      if (!have.includes(norm(line))) missing.push(`옛 카드 ${i + 1}: "${raw}"`)
    }
  })

  // 3) 한국어 렌더·검사·수정
  const koSettled = await settle(h, koRender, `${id} ko`)
  // 수정된 텍스트는 유지하되 사진 src 는 NAS URL 로
  const koFinal: CardDeck = { handle: koDeck.handle, cards: withSrc(koSettled.deck.cards, mediaUrls) }

  // 4) 영문: 로케일(제목·요약) + 덱
  // 영문 제목·요약: 이미 있으면(아임웹 시절 영문 제목, 또는 사람이 고친 것) 그대로, 없을 때만 번역
  const enLocale =
    content.en?.title
      ? { title: content.en.title, summary: content.en.summary ?? "" }
      : await translateLocale({ title: ko.title, summary: ko.summary, blocks: [] }, "ko", "en")
  const cached = path.join(reportDir, "deck.en.json")
  const enDeck: CardDeck =
    REUSE_EN && fs.existsSync(cached)
      ? CardDeckSchema.parse(JSON.parse(fs.readFileSync(cached, "utf8")))
      : await translateDeck(koFinal, "ko", "en")
  const enRender: CardDeck = { handle: enDeck.handle, cards: withSrc(enDeck.cards, dataUrls) }
  const enSettled = await settle(h, enRender, `${id} en`)
  const enFinal: CardDeck = { handle: enDeck.handle, cards: withSrc(enSettled.deck.cards, mediaUrls) }

  // 5) 굽기 · 업로드 · 블록
  async function bake(deck: CardDeck, lang: "ko" | "en"): Promise<{ blocks: PostBlock[]; firstPng: Buffer }> {
    await h.lint(deck) // 무대에 올린다(data URL 사진)
    const blocks: PostBlock[] = []
    let firstPng: Buffer | null = null
    for (let i = 0; i < deck.cards.length; i++) {
      const dataUrl = await h.png(i)
      const png = Buffer.from(dataUrl.split(",")[1], "base64")
      if (!firstPng) firstPng = png
      fs.writeFileSync(path.join(reportDir, `${lang}-${String(i + 1).padStart(2, "0")}.png`), png)
      const webp = await sharp(png).webp({ quality: 90 }).toBuffer()
      const name = `rebuild-${lang}-${String(i + 1).padStart(2, "0")}.webp`
      const src = DRY ? `/omnis/api/website/media/${id}/${name}` : (await storeMedia({ postId: id, bytes: webp, contentType: "image/webp", name })).url
      blocks.push({ type: "image", src, alt: cardText(deck.cards[i], deck) })
    }
    return { blocks, firstPng: firstPng! }
  }
  const koBaked = await bake(koSettled.deck, "ko")
  const enBaked = await bake(enSettled.deck, "en")

  // 썸네일: 각 언어의 첫 카드 640. 표지에 글자가 박혀 있어 언어마다 다르다.
  const thumbOf = async (png: Buffer, name: string, fallback: string | null) =>
    DRY ? fallback : (await storeMedia({ postId: id, bytes: await sharp(png).resize(640, 640).webp({ quality: 85 }).toBuffer(), contentType: "image/webp", name })).url
  const thumbUrl = await thumbOf(koBaked.firstPng, "rebuild-thumb.webp", row.thumbnail)
  const enThumbUrl = await thumbOf(enBaked.firstPng, "rebuild-thumb-en.webp", null)

  // 6) DB
  const nextKo: PostLocale = { ...ko, blocks: koBaked.blocks }
  const nextEn: PostLocale = { title: enLocale.title, summary: enLocale.summary, blocks: enBaked.blocks, translatedFrom: sourceHash(nextKo), ...(enThumbUrl ? { thumbnail: enThumbUrl } : {}) }
  if (!DRY) {
    await prisma.websitePost.update({
      where: { id },
      data: { content: { ...content, ko: nextKo, en: nextEn } as Prisma.InputJsonValue, deck: koFinal as unknown as Prisma.InputJsonValue, thumbnail: thumbUrl },
    })
  }

  // 7) 대조표: 옛 | ko | en
  const rows: Buffer[] = []
  for (let i = 0; i < flat.length; i++) {
    const old = await sharp(path.join(SITE, "public/news", id, flat[i].sc.source)).resize(360, 360).png().toBuffer()
    const k = await sharp(path.join(reportDir, `ko-${String(i + 1).padStart(2, "0")}.png`)).resize(360, 360).png().toBuffer()
    const e = await sharp(path.join(reportDir, `en-${String(i + 1).padStart(2, "0")}.png`)).resize(360, 360).png().toBuffer()
    rows.push(await sharp({ create: { width: 1100, height: 360, channels: 3, background: "#fff" } }).composite([{ input: old, left: 0, top: 0 }, { input: k, left: 370, top: 0 }, { input: e, left: 740, top: 0 }]).png().toBuffer())
  }
  const sheet = sharp({ create: { width: 1100, height: 370 * rows.length, channels: 3, background: "#fff" } }).composite(rows.map((b, i) => ({ input: b, left: 0, top: i * 370 })))
  await sheet.png().toFile(path.join(reportDir, "compare.png"))
  fs.writeFileSync(path.join(reportDir, "deck.ko.json"), JSON.stringify(koFinal, null, 2))
  fs.writeFileSync(path.join(reportDir, "deck.en.json"), JSON.stringify(enFinal, null, 2))

  const remaining = [...koSettled.issues, ...enSettled.issues].flat()
  const line = `${id} ${spec.title.slice(0, 30)} — 옛 ${spec.cards.length} → 새 ${flat.length} · 사진 ${dataUrls.size} · 수정 ${koSettled.fixes.length + enSettled.fixes.length} · 남은 문제 ${remaining.length} · 빠진 원문 ${missing.length}`
  summary.push(line)
  console.log(line)
  for (const f of [...koSettled.fixes, ...enSettled.fixes]) console.log("  수정:", f)
  for (const r of remaining) console.log("  남음:", r.message)
  for (const m of missing) console.log("  빠짐:", m)
  fs.writeFileSync(path.join(reportDir, "report.txt"), [line, ...koSettled.fixes, ...enSettled.fixes, ...remaining.map((r) => `남음: ${r.message}`), ...missing.map((m) => `빠짐: ${m}`)].join("\n") + "\n")
}

async function main() {
  fs.mkdirSync(REPORT, { recursive: true })
  const h = await openHarness()
  const summary: string[] = []
  try {
    for (const id of IDS) await rebuild(id, h, summary)
  } finally {
    await h.browser.close()
    await prisma.$disconnect()
  }
  fs.writeFileSync(path.join(REPORT, "summary.txt"), summary.join("\n") + "\n")
  console.log(`\n${DRY ? "(dry-run) " : ""}${summary.length}건 완료 → ${REPORT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
