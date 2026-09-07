import { createHash } from "node:crypto"

import { z } from "zod"

import { callGemini } from "@/lib/ai"
import { LANGS, type Lang, type PostBlock, type PostLocale } from "@/lib/schemas/website"

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
  summary: z.string(),
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
