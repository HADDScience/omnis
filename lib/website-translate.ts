import { createHash } from "node:crypto"

import { z } from "zod"

import { callGemini } from "@/lib/ai"
import {
  CardDeckSchema,
  LANGS,
  type CardDeck,
  type Lang,
  type PostBlock,
  type PostLocale,
} from "@/lib/schemas/website"

/**
 * 홈페이지 기사 자동 번역. 사이트 저장소의 `scripts/translate-posts.mjs`(GitHub Actions 에서
 * Anthropic 으로 돌던 것)를 그대로 옮겼다. 규칙은 같고 모델만 Gemini 다 — 기사가 DB 로
 * 오면서 커밋이 없어져 Actions 트리거가 사라졌고, Omnis 는 이미 Gemini 예산을 관리한다.
 *
 * - 번역본의 `translatedFrom`(원문 해시)이 지금 원문의 해시와 다를 때만 다시 번역한다.
 * - 사람이 직접 손본 번역(`manual: true`)은 건드리지 않는다.
 * - 블록 수·타입·이미지 src 는 원문에서 그대로 가져온다. 모델이 손댈 여지를 두지 않는다.
 */

const LANG_NAME: Record<Lang, string> = { ko: "Korean", en: "English" }

/** 번역에 영향을 주는 부분만 해시한다. 이미지 경로나 날짜가 바뀌었다고 다시 번역할 이유는 없다. */
export function sourceHash(locale: PostLocale): string {
  const payload = JSON.stringify({
    title: locale.title,
    summary: locale.summary,
    blocks: locale.blocks.map((b) =>
      b.type === "image" ? { type: "image", alt: b.alt, caption: b.caption ?? null } : b
    ),
  })
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

const SYSTEM = `You translate corporate news posts for HADD Science (하드사이언스), a Korean
biotech company. Its products are 3D cell culture hydrogels — ADDGEL and LiVEGEL — used for
organoid and spheroid culture.

Rules:
- Translate into natural, professional prose in the target language. Match the register of a
  company newsroom: factual, warm, never breathless.
- Keep these unchanged: ADDGEL, LiVEGEL, HADD Science, personal names (romanize Korean names
  in the standard Revised Romanization when translating to English), institution names
  (use the institution's own official English name when it has one).
- Keep technical terms accurate: 오가노이드 = organoid, 스페로이드 = spheroid,
  3차원 배양 = 3D culture, 하이드로겔 = hydrogel, 세포외기질 = extracellular matrix.
- Drop decorative emoji from titles; keep the meaning.
- Do not add, remove, merge or reorder blocks. Output exactly one entry per input block,
  in the same order.
- Leave a field out only if the input block does not have it.
- Answer with JSON only, no prose, no code fences:
  { "title": string, "summary": string, "blocks": [ { "text"?: string, "cite"?: string, "alt"?: string, "caption"?: string } ] }`

const OutputSchema = z.object({
  title: z.string(),
  // 요약이 빈 원문에는 모델이 이 칸을 빼기도 한다. 빈 문자열로 받는다.
  summary: z.string().optional().default(""),
  blocks: z.array(
    z.object({
      text: z.string().optional(),
      cite: z.string().optional(),
      alt: z.string().optional(),
      caption: z.string().optional(),
    })
  ),
})

export async function translateLocale(
  locale: PostLocale,
  from: Lang,
  to: Lang,
  userId?: string
): Promise<PostLocale> {
  const input = {
    title: locale.title,
    summary: locale.summary,
    blocks: locale.blocks.map((b) =>
      b.type === "image" ? { type: "image", alt: b.alt, ...(b.caption ? { caption: b.caption } : {}) } : b
    ),
  }
  const prompt = `${SYSTEM}\n\nTranslate from ${LANG_NAME[from]} to ${LANG_NAME[to]}.\n\n${JSON.stringify(input, null, 2)}`
  const raw = await callGemini(prompt, "websiteTranslate", userId, 0.2)
  const out = OutputSchema.parse(JSON.parse(raw))

  if (out.blocks.length !== locale.blocks.length) {
    throw new Error(`블록 수가 다르다 — 원문 ${locale.blocks.length}개, 번역 ${out.blocks.length}개`)
  }

  const blocks: PostBlock[] = locale.blocks.map((src, i) => {
    const t = out.blocks[i]
    if (src.type === "image") {
      return {
        type: "image",
        src: src.src,
        alt: t.alt ?? src.alt,
        ...(src.caption ? { caption: t.caption ?? src.caption } : {}),
      }
    }
    if (src.type === "quote") {
      return { type: "quote", text: t.text ?? src.text, ...(src.cite ? { cite: t.cite ?? src.cite } : {}) }
    }
    return { type: src.type, text: t.text ?? src.text }
  })

  return {
    title: out.title,
    summary: locale.summary ? out.summary : "",
    blocks,
    translatedFrom: sourceHash(locale),
  }
}

/**
 * 원문이 바뀐 언어만 채운다. 실패한 언어는 건너뛰고 나머지는 저장되게 둔다 —
 * 영문이 하루 늦는 것보다 원문 저장이 막히는 쪽이 훨씬 나쁘다. 실패 목록을 돌려준다.
 */
export async function fillTranslations(
  content: Partial<Record<Lang, PostLocale>>,
  sourceLang: Lang,
  userId?: string
): Promise<{ content: Partial<Record<Lang, PostLocale>>; failures: string[] }> {
  const source = content[sourceLang]
  if (!source) return { content, failures: [] }
  const hash = sourceHash(source)
  const next = { ...content }
  const failures: string[] = []

  for (const target of LANGS) {
    if (target === sourceLang) continue
    const existing = next[target]
    if (existing?.manual) continue
    if (existing?.translatedFrom === hash) continue
    if (!process.env.GEMINI_API_KEY) {
      failures.push(`${target}: GEMINI_API_KEY 없음`)
      continue
    }
    try {
      next[target] = await translateLocale(source, sourceLang, target, userId)
    } catch (err) {
      failures.push(`${target}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { content: next, failures }
}

// ─── 카드뉴스 덱 ────────────────────────────────────────────────

/**
 * 카드뉴스 덱 번역. 카드는 그림이라 서버가 굽지 못하고, 굽는 것은 브라우저 몫이다 —
 * 서버는 **글자 칸만** 바꾼 덱을 돌려주고 편집기가 그것을 다시 굽는다.
 *
 * 그래서 모델에게 덱 구조를 통째로 넘기지 않는다. 번역할 문자열만 `{ id, text }` 로 뽑아
 * 한 번에 보내고 같은 id 로 되꽂는다 — 레이아웃 · 배지 · 사진 · 카드 순서는 모델이
 * 손댈 수 없는 자리에 둔다. 기사 번역(`translateLocale`)이 블록 수를 원문에서 가져오는 것과
 * 같은 이유다.
 */

type Slot = { id: string; text: string }

/** 번역할 문자열만 뽑는다. 여기 없는 필드는 원문 그대로 나간다. */
function collectSlots(deck: CardDeck): Slot[] {
  const slots: Slot[] = []
  deck.cards.forEach((card, i) => {
    const push = (field: string, value: string | undefined) => {
      if (value !== undefined && value.trim() !== "") slots.push({ id: `${i}.${field}`, text: value })
    }
    if (card.type === "cover") {
      push("title", card.title)
      push("cta", card.cta)
      return
    }
    // 배지는 보통 "chapter 01" 같은 영문 라벨이라 두지만, "대표 한마디" 처럼 한글이면 번역한다.
    if (/[가-힣]/.test(card.badge)) push("badge", card.badge)
    if (card.type === "quote") {
      push("quote", card.quote)
      push("attrib", card.attrib)
      return
    }
    push("headline", card.headline)
    if (card.layout === "stat") {
      card.stats.forEach((s, j) => {
        push(`stats.${j}.label`, s.label)
        push(`stats.${j}.unit`, s.unit)
      })
      push("body", card.body)
      return
    }
    if (card.layout === "list") {
      card.items.forEach((it, j) => {
        push(`items.${j}.title`, it.title)
        push(`items.${j}.desc`, it.desc)
      })
      return
    }
    if (card.layout === "standard" || card.layout === "image-top" || card.layout === "split") {
      push("subtitle", card.subtitle)
    }
    push("body", card.body)
    push("footnote", card.footnote)
  })
  return slots
}

const DECK_SYSTEM = `${SYSTEM}

You are now translating a CARD NEWS deck for the same company — a series of square social
cards. You get a flat list of the deck's text slots as [{ "id", "text" }]. Translate the
"text" of each slot and answer with the same list.

Card-specific rules:
- Answer with exactly one entry per input entry, same "id" values, same order. Never add,
  drop, merge or reorder entries, and never invent an id.
- Keep it as short as the Korean — a card has little room. Never pad; if the English needs
  fewer words, use fewer.
- Keep every <b>…</b> tag exactly where it is: it marks the emphasis the card design draws.
- Keep every \\n line break exactly where it is: the line breaks are the card's layout.
- Keep emoji, including in headlines — this is card news, not a newsroom article.
- The output must be entirely in the target language. Never leave Korean or Chinese
  characters (e.g. 現場) in an English translation.
- A "stats.N.unit" slot is a unit of measure: give the natural English unit (배 → x,
  개월 → months, 명 → people). Never translate the number that goes with it; it is not here.
- Answer with JSON only, no prose, no code fences:
  [ { "id": string, "text": string } ]`

const DeckOutputSchema = z.array(z.object({ id: z.string(), text: z.string() }))

export async function translateDeck(
  deck: CardDeck,
  from: Lang,
  to: Lang,
  userId?: string
): Promise<CardDeck> {
  const slots = collectSlots(deck)
  if (slots.length === 0) return deck

  const prompt = `${DECK_SYSTEM}\n\nTranslate from ${LANG_NAME[from]} to ${LANG_NAME[to]}.\n\n${JSON.stringify(slots, null, 2)}`
  // 모델이 가끔 JSON 을 깨뜨려 보낸다(따옴표 누락 등). 같은 프롬프트로 최대 3번 받는다.
  let out: z.infer<typeof DeckOutputSchema> | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !out; attempt++) {
    const raw = await callGemini(prompt, "websiteTranslateDeck", userId, 0.2)
    try {
      out = DeckOutputSchema.parse(JSON.parse(raw))
    } catch (err) {
      lastErr = err
      console.warn(`[website-translate] 덱 번역 응답 파싱 실패 (${attempt + 1}/3):`, raw.slice(0, 200))
    }
  }
  if (!out) throw lastErr instanceof Error ? lastErr : new Error("덱 번역 응답을 읽지 못했다")

  // 영문 결과에 한글·한자가 남은 칸("현장 확인하기" → "symposium現場" 같은 것)은 그 칸만 다시 시킨다.
  if (to === "en") {
    const leftover = out.filter((s) => /[가-힣\u4e00-\u9fff]/.test(s.text))
    if (leftover.length > 0) {
      const again = `${DECK_SYSTEM}\n\nThe previous translation left Korean or Chinese characters in these entries. Translate each "text" fully into English — every character must be English or emoji. In particular 현장 means "the venue" / "on site" / "the scene" — never write 現場 or 现场. Answer with the same list.\n\n${JSON.stringify(
        leftover.map((s) => ({ id: s.id, text: slots.find((x) => x.id === s.id)?.text ?? s.text })),
        null,
        2
      )}`
      const raw = await callGemini(again, "websiteTranslateDeck", userId, 0.4)
      try {
        const fixed = DeckOutputSchema.parse(JSON.parse(raw))
        const byId = new Map(fixed.map((s) => [s.id, s.text]))
        out = out.map((s) => (byId.has(s.id) && !/[가-힣\u4e00-\u9fff]/.test(byId.get(s.id)!) ? { ...s, text: byId.get(s.id)! } : s))
      } catch (err) {
        console.warn("[website-translate] 잔여 한글 재번역 실패:", err instanceof Error ? err.message : err)
      }
      // 그래도 남으면 알려진 오역만 손으로 바꾼다. 모델이 "현장" 을 한자로 쓰는 버릇이 있다(2026-09-08 실측).
      out = out.map((s) => ({ ...s, text: s.text.replace(/\s*[現现]場?场?/g, " venue").replace(/\s+([.!?])/g, "$1") }))
    }
  }

  if (out.length !== slots.length) {
    throw new Error(`칸 수가 다르다 — 원문 ${slots.length}개, 번역 ${out.length}개`)
  }
  const byId = new Map(out.map((s) => [s.id, s.text]))
  const missing = slots.filter((s) => !byId.has(s.id)).map((s) => s.id)
  if (missing.length > 0) throw new Error(`번역에서 빠진 칸: ${missing.join(", ")}`)

  const cards = deck.cards.map((card, i) => {
    const t = (field: string, fallback: string) => byId.get(`${i}.${field}`) ?? fallback
    const keep = (field: string, value: string | undefined) =>
      value === undefined ? {} : { [field]: t(field, value) }

    if (card.type === "cover") {
      return { ...card, title: t("title", card.title), cta: t("cta", card.cta) }
    }
    if (card.type === "quote") {
      return { ...card, badge: t("badge", card.badge), quote: t("quote", card.quote), attrib: t("attrib", card.attrib) }
    }
    const badge = t("badge", card.badge)
    const headline = t("headline", card.headline)
    if (card.layout === "stat") {
      return {
        ...card,
        badge,
        headline,
        stats: card.stats.map((s, j) => ({
          ...s,
          label: t(`stats.${j}.label`, s.label),
          ...(s.unit === undefined ? {} : { unit: t(`stats.${j}.unit`, s.unit) }),
        })),
        ...keep("body", card.body),
      }
    }
    if (card.layout === "list") {
      return {
        ...card,
        badge,
        headline,
        items: card.items.map((it, j) => ({
          ...it,
          title: t(`items.${j}.title`, it.title),
          ...(it.desc === undefined ? {} : { desc: t(`items.${j}.desc`, it.desc) }),
        })),
      }
    }
    return {
      ...card,
      badge,
      headline,
      ...("subtitle" in card ? keep("subtitle", card.subtitle) : {}),
      body: t("body", card.body),
      ...keep("footnote", card.footnote),
    }
  })

  // 모델이 만질 수 없는 자리에 뒀더라도 마지막에 한 번 더 스키마로 거른다.
  return CardDeckSchema.parse({ handle: deck.handle, cards })
}
