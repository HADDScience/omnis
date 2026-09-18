/**
 * 영문 기사에 남은 한글을 걷어낸다 — 사진 alt 와 링크 이름.
 *
 *   npx tsx scripts/fix-en-korean-leftovers.ts [--prod] [--dry-run]
 *
 * 왜 남았나
 * - 이식 스크립트들이 영문 블록의 이미지를 **한국어 블록으로 통째로 갈아** 넣었다. 사진 주소를
 *   양쪽이 공유해야 해서 그랬는데, 그 바람에 번역된 alt 까지 버리고 한글 alt 를 되돌려 놨다.
 * - 링크 블록은 제목만 번역하고 항목 이름(`items[].label`)은 원문을 지켰다. 언론사 이름이라
 *   그대로 두려던 것인데, "기사 원문 보기" 같은 안내 문구까지 영문 페이지에 한글로 남았다.
 *
 * 고치는 방식
 * - alt 는 영문 제목으로 새로 짓는다(`<영문 제목> photo 1`). 기계가 붙인 형식 문구라 번역이 아깝지 않다.
 * - 링크 이름은 서로 다른 것만 모아 Gemini 에 **한 번** 물어 영문 이름을 받는다(언론사는 공식 영문명).
 *   주소는 절대 건드리지 않는다.
 * - 카드뉴스 글(deck 이 있는 글)의 카드 이미지 alt 는 영문 덱에서 나오므로 대상이 아니다.
 */
import "dotenv/config"

import { callGemini } from "../lib/ai"
import { prisma } from "../lib/db"
import { Prisma } from "../generated/prisma"
import type { PostBlock, PostLocale } from "../lib/schemas/website"

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const DRY = flag("--dry-run")
const HANGUL = /[가-힣]/

function guardTarget() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "")
  console.log(`DB 대상: ${host}`)
  if (host.includes("neon.tech") !== flag("--prod")) {
    console.error(flag("--prod") ? "--prod 인데 Neon 이 아니다" : "Neon 인데 --prod 가 없다")
    process.exit(1)
  }
}

const PROMPT = `You localize link labels on an English-language corporate newsroom for HADD Science,
a Korean biotech company. Each input is the Korean label of a link shown under an article.

Rules:
- A Korean news outlet or institution: use its own official English name
  (조선일보 = The Chosun Ilbo, 연합뉴스 = Yonhap News, 교수신문 = The Kyosu Shinmun,
   뉴시스 = Newsis, 신아일보 = Shina Ilbo). Romanize only when no official name exists.
- A generic phrase: translate it as a short English link label in title case-free sentence case
  (기사 원문 = Original article, 기사 원문 보기 = View original article,
   유튜브 영상 보기 = Watch on YouTube, 논문 원문 링크 = Original paper).
- Strip a URL that leaked into the label; keep only the words.
- Keep it under 40 characters. No trailing punctuation, no arrows, no quotes.
- Answer with JSON only: { "<input>": "<English label>", ... } — one entry per input, same keys.`

async function englishLabels(labels: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!labels.length) return out
  const raw = await callGemini(`${PROMPT}\n\n${JSON.stringify(labels, null, 2)}`, "websiteTranslate", "fix-en-leftovers", 0.2)
  const parsed = JSON.parse(raw) as Record<string, string>
  for (const l of labels) {
    const v = parsed[l]
    if (typeof v === "string" && v.trim() && !HANGUL.test(v)) out.set(l, v.trim())
    else console.warn(`  이름을 못 받았다 — 그대로 둔다: ${l}`)
  }
  return out
}

async function run() {
  guardTarget()
  const rows = await prisma.websitePost.findMany({ orderBy: { position: "asc" } })

  // 1) 서로 다른 한글 링크 이름을 한 번에 번역한다
  const distinct = new Set<string>()
  for (const r of rows) {
    const en = (r.content as { en?: PostLocale }).en
    for (const b of en?.blocks ?? []) {
      if (b.type === "links") for (const it of b.items) if (HANGUL.test(it.label)) distinct.add(it.label)
    }
  }
  console.log(`한글 링크 이름 ${distinct.size}종`)
  const dict = DRY ? new Map<string, string>() : await englishLabels([...distinct])
  if (!DRY) for (const [k, v] of dict) console.log(`  ${k} → ${v}`)

  // 2) 글마다 alt · 링크 이름을 고친다
  let touched = 0
  let fixedAlt = 0
  let fixedLabel = 0
  for (const r of rows) {
    const content = r.content as { ko?: PostLocale; en?: PostLocale }
    const en = content.en
    if (!en) continue
    let shot = 0
    let changed = false
    const blocks: PostBlock[] = en.blocks.map((b) => {
      if (b.type === "image") {
        shot += 1
        if (!HANGUL.test(b.alt ?? "")) return b
        // 카드뉴스는 카드 글자가 alt 라 한글이면 영문 덱이 없다는 뜻 — 건드리지 않는다.
        if (r.deck) return b
        changed = true
        fixedAlt += 1
        return { ...b, alt: `${en.title} photo ${shot}` }
      }
      if (b.type === "links") {
        const items = b.items.map((it) => {
          const next = dict.get(it.label)
          if (!next) return it
          changed = true
          fixedLabel += 1
          return { label: next, href: it.href }
        })
        return { ...b, items }
      }
      return b
    })
    if (!changed) continue
    touched += 1
    if (!DRY) {
      await prisma.websitePost.update({
        where: { id: r.id },
        data: {
          content: { ...content, en: { ...en, blocks } } as Prisma.InputJsonValue,
          updatedById: "fix-en-leftovers",
        },
      })
    }
    console.log(`  ${r.id} (${r.category}) 고침`)
  }

  console.log(`\n${DRY ? "(dry-run) " : ""}글 ${touched}건 · alt ${fixedAlt}개 · 링크 이름 ${fixedLabel}개`)
  await prisma.$disconnect()
}

run().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
