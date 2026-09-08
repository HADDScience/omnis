import { z } from "zod"

/**
 * 홈페이지 기사의 모양 — 단일 진실 소스.
 *
 * 사이트 저장소의 `content/types.ts` 와 같은 구조다. 그쪽은 화면을 그리기 위한 TypeScript
 * 타입이고, 여기는 관리 화면이 보내는 JSON 을 DB 에 넣기 전에 걸러 내는 Zod 스키마다.
 * 두 벌이 어긋나면 사이트가 그리지 못하는 글이 저장되므로, 필드를 바꿀 때는 둘을 같이 고친다.
 *
 * 텍스트 블록은 자동 번역 대상이고 이미지는 언어별로 따로 들어간다 — 카드뉴스처럼
 * 그림 안에 글자가 박힌 경우가 있어서다.
 */

export const LANGS = ["ko", "en"] as const
export const LangSchema = z.enum(LANGS)
export type Lang = z.infer<typeof LangSchema>

const text = z.string().max(20_000)
const short = z.string().max(2_000)

export const PostBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: short }),
  z.object({ type: z.literal("text"), text }),
  z.object({ type: z.literal("quote"), text, cite: short.optional() }),
  z.object({
    type: z.literal("links"),
    title: short,
    items: z.array(z.object({ label: short, href: z.string().url().max(2_000) })).max(50),
  }),
  z.object({
    type: z.literal("image"),
    src: z.string().max(2_000),
    alt: short,
    caption: short.optional(),
  }),
])
export type PostBlock = z.infer<typeof PostBlockSchema>

export const PostLocaleSchema = z.object({
  title: short,
  summary: short,
  blocks: z.array(PostBlockSchema).max(500),
  /** 이 언어 전용 썸네일(영문 카드뉴스의 첫 장). 없으면 공통 thumbnail. */
  thumbnail: z.string().max(2_000).optional(),
  /** 이 번역이 만들어진 원문의 해시. 원문 로케일에는 없다. */
  translatedFrom: z.string().optional(),
  /** 사람이 직접 손본 번역. 자동 번역이 덮어쓰지 않는다. */
  manual: z.boolean().optional(),
})
export type PostLocale = z.infer<typeof PostLocaleSchema>

// ─── 카드뉴스 ──────────────────────────────────────────────────

export const CardImageSchema = z.object({
  src: z.string().max(2_000),
  ratio: z.enum(["16/9", "16/10", "4/3", "1/1", "3/4"]).optional(),
  pos: z.string().max(40).optional(),
  /** 상자 폭(%). 글이 길면 사진을 작게 넣는다. 기본 100 */
  width: z.union([z.literal(100), z.literal(80), z.literal(65), z.literal(50)]).optional(),
})

const badge = z.string().max(200)
const headline = z.string().max(1_000)

const chapterBase = { type: z.literal("chapter"), badge, headline }

export const CardSchema = z.union([
  z.object({ type: z.literal("cover"), title: headline, cta: short, handle: short.optional(), titleSize: z.enum(["sm"]).optional() }),
  z.object({
    type: z.literal("quote"),
    badge,
    quote: short,
    attrib: short,
    image: CardImageSchema.optional(),
    quoteSize: z.enum(["sm"]).optional(),
  }),
  z.object({
    ...chapterBase,
    layout: z.literal("standard"),
    headlineSize: z.enum(["sm", "lg"]).optional(),
    subtitle: short.optional(),
    image: CardImageSchema.optional(),
    body: text,
    footnote: short.optional(),
  }),
  z.object({
    ...chapterBase,
    layout: z.literal("image-top"),
    subtitle: short.optional(),
    image: CardImageSchema.optional(),
    body: text,
    footnote: short.optional(),
  }),
  z.object({
    ...chapterBase,
    layout: z.literal("split"),
    subtitle: short.optional(),
    image: CardImageSchema.optional(),
    imageFit: z.enum(["cover", "contain"]).optional(),
    body: text,
    footnote: short.optional(),
  }),
  z.object({
    ...chapterBase,
    layout: z.literal("overlay"),
    image: CardImageSchema.optional(),
    body: text,
    footnote: short.optional(),
  }),
  z.object({ ...chapterBase, layout: z.literal("text"), body: text, footnote: short.optional() }),
  z.object({
    ...chapterBase,
    layout: z.literal("stat"),
    stats: z
      .array(z.object({ value: short, unit: short.optional(), label: short }))
      .min(1)
      .max(3),
    body: text.optional(),
  }),
  z.object({
    ...chapterBase,
    layout: z.literal("list"),
    marker: z.enum(["number", "bullet", "emoji"]),
    items: z
      .array(z.object({ title: short, desc: short.optional(), emoji: short.optional() }))
      .min(1)
      .max(20),
  }),
])
export type Card = z.infer<typeof CardSchema>

export const CardDeckSchema = z.object({
  handle: short,
  cards: z.array(CardSchema).min(1).max(30),
})
export type CardDeck = z.infer<typeof CardDeckSchema>

// ─── 기사 ──────────────────────────────────────────────────────

export const PostIdSchema = z.string().regex(/^[0-9]{6,}(-[0-9]{4})?$/, "기사 id 형식이 아닙니다")

/** 관리 화면이 PUT 으로 보내는 것. position 은 order 로 따로 정하므로 여기 없다. */
export const PostInputSchema = z.object({
  date: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/, "날짜는 2026.07.08 형식"),
  sourceLang: LangSchema,
  thumbnail: z.string().max(2_000).nullable(),
  externalHref: z.string().url().max(2_000).nullable(),
  content: z.partialRecord(LangSchema, PostLocaleSchema),
  deck: CardDeckSchema.nullable().optional(),
})
export type PostInput = z.infer<typeof PostInputSchema>

/** 사이트와 관리 화면이 읽는 모양. 사이트 `Post` 와 같다. */
export interface WebsitePostDto extends PostInput {
  id: string
  position: number
  updatedAt: string
}

export const OrderInputSchema = z.object({ order: z.array(PostIdSchema).max(1_000) })
