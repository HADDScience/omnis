import { NextRequest } from "next/server"
import { z } from "zod"

import { CardDeckSchema, LangSchema, PostLocaleSchema } from "@/lib/schemas/website"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"
import { translateDeck, translateLocale } from "@/lib/website-translate"

/**
 * 홈페이지 관리 화면의 번역 창구. 한국어(또는 영어) 하나만 쓰면 나머지 언어는 여기서 나온다.
 *
 * 기사와 달리 카드뉴스는 저장 시점에 서버가 전부 처리하지 못한다 — 카드는 그림이고 굽는
 * 단계가 브라우저에만 있다. 그래서 **글자는 여기서 번역하고 굽기는 편집기가** 한다:
 * 편집기가 덱과 로케일을 보내 영문 덱을 받고, 그것을 한 번 더 구워 `content.en` 에 넣는다.
 * 돌려주는 로케일에는 `translatedFrom`(원문 해시)이 들어 있어 저장 시 `fillTranslations`
 * 가 en 을 다시 번역하지 않는다.
 */
export const dynamic = "force-dynamic"

export const OPTIONS = websiteOptions

const BodySchema = z.object({
  from: LangSchema,
  to: LangSchema,
  locale: PostLocaleSchema,
  deck: CardDeckSchema.optional(),
})

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const body = BodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return websiteJson(
      { error: "invalid_body", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      400,
      origin
    )
  }
  const { from, to, locale, deck } = body.data
  if (from === to) {
    return websiteJson({ error: "invalid_body", issues: ["from 과 to 가 같습니다"] }, 400, origin)
  }

  try {
    const translated = await translateLocale(locale, from, to, authed.user.id)
    const translatedDeck = deck ? await translateDeck(deck, from, to, authed.user.id) : undefined
    return websiteJson({ locale: translated, ...(translatedDeck ? { deck: translatedDeck } : {}) }, 200, origin)
  } catch (err) {
    // 예산 초과 · 모델 오류 · 응답 모양 불일치 — 전부 바깥 사정이라 502 로 넘긴다.
    const detail = err instanceof Error ? err.message : String(err)
    console.error("[website/translate] 번역 실패", { from, to, hasDeck: Boolean(deck), detail })
    return websiteJson({ error: "translate_failed", detail }, 502, origin)
  }
}
