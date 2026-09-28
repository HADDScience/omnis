/**
 * 홈페이지 기사의 번역본을 다시 채운다 — 사람이 관리 화면을 열지 않고.
 *
 * 관리 화면에서 저장하면 `savePost` 가 `fillTranslations` 를 부르고, 원문 해시가 바뀐
 * 언어만 다시 번역한다. 그런데 `GEMINI_API_KEY` 없이 저장하면 그 단계가 조용히 건너뛰어져
 * 번역본이 낡은 채로 남는다(실패 목록만 돌려주고 저장은 성공시킨다 — 영문이 하루 늦는 것보다
 * 원문 저장이 막히는 쪽이 나쁘기 때문이다). 그렇게 남은 것을 여기서 따라잡는다.
 *
 * `fillTranslations` 를 그대로 쓴다. 손으로 고친 번역(`manual`)과 이미 최신인 것은
 * 그쪽이 알아서 건너뛴다 — 여기서 판단하지 않는다.
 *
 * **주의 — 아무 글에나 돌리지 말 것.** 2026-09-28 기준 153건 중 132건이 해시가 어긋나
 * 있는데, 그중 눈에 보이게 깨진 것은 2건뿐이다. 나머지는 장부만 안 맞는 것이라 다시 돌리면
 * 멀쩡한 번역을 지우고 Gemini 를 130번 부른다. 그래서 id 를 반드시 받는다.
 *
 *   npx tsx scripts/retranslate-website-post.ts 169345651 169483428           # 무엇이 바뀔지만
 *   npx tsx scripts/retranslate-website-post.ts 169345651 169483428 --apply   # 실제로
 */
import "dotenv/config"
import { prisma } from "../lib/db"
import { fillTranslations, sourceHash } from "../lib/website-translate"
import type { Lang, PostLocale } from "../lib/schemas/website"

const apply = process.argv.includes("--apply")
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"))

const textLen = (l?: PostLocale) =>
  (l?.blocks ?? [])
    .filter((b) => b.type === "text" || b.type === "heading" || b.type === "quote")
    .map((b) => (b as { text: string }).text)
    .join("").length

try {
  if (ids.length === 0) {
    console.error("기사 id 를 하나 이상 주세요. 전부 돌리는 기능은 일부러 없습니다 — 머리말 참고.")
    process.exit(1)
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY 가 없습니다. 이게 없으면 이 스크립트도 아무것도 못 합니다.")
    process.exit(1)
  }

  const target = new URL(process.env.DATABASE_URL!)
  console.log(`대상: ${target.hostname}${target.pathname}`)
  console.log(apply ? "모드: 적용\n" : "모드: 미리보기 (--apply 를 붙이면 실제로 쓴다)\n")

  for (const id of ids) {
    const post = await prisma.websitePost.findUnique({
      where: { id },
      select: { id: true, sourceLang: true, content: true },
    })
    if (!post) {
      console.log(`  ✗ ${id} — 그런 기사가 없습니다`)
      continue
    }

    const before = post.content as Partial<Record<Lang, PostLocale>>
    const src = before[post.sourceLang as Lang]
    if (!src) {
      console.log(`  ✗ ${id} — 원문(${post.sourceLang})이 없습니다`)
      continue
    }

    const other: Lang = post.sourceLang === "ko" ? "en" : "ko"
    console.log(
      `  ${id}  원문 ${textLen(src)}자 · ${other} ${textLen(before[other])}자` +
        `  (translatedFrom=${before[other]?.translatedFrom ?? "없음"} vs 원문=${sourceHash(src)})`
    )

    if (!apply) continue

    const { content, failures } = await fillTranslations(before, post.sourceLang as Lang)
    for (const f of failures) console.log(`     ! ${f}`)
    if (failures.length > 0) {
      console.log(`     → 실패가 있어 저장하지 않습니다`)
      continue
    }

    await prisma.websitePost.update({ where: { id }, data: { content } })
    console.log(`     → ${other} ${textLen(content[other])}자로 다시 채웠습니다`)
  }

  if (!apply) console.log("\n아무것도 바꾸지 않았습니다.")
  else console.log("\n사이트 재검증은 따로 돌려야 합니다 — revalidateWebsite() 또는 60초 ISR.")
} finally {
  await prisma.$disconnect()
}
