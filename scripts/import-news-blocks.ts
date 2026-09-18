/**
 * 아임웹에만 있던 "글 + 사진" 기사를 사이트 본문(WebsitePost.content.ko.blocks)으로 옮긴다.
 *
 *   npx tsx scripts/import-news-blocks.ts --items <items.json> --img <이미지폴더> [--prod] [--dry-run]
 *   … --only 166087150,167543041      # 몇 건만
 *   … --no-translate                  # 영문 번역 건너뛰기
 *
 * 카드뉴스가 아닌 기사들이다. 옛 본문 HTML 을 문단·소제목·사진 순서대로 블록으로 옮긴 items.json 을 받는다:
 *   { "<글번호>": { title, date, summary, links[{label,href}], blocks[
 *       {type:"text",text} | {type:"heading",text} | {type:"image",file,src} ] } }
 *
 * rebuild-cardnews.ts 와 다른 점 — **행은 이미 있다.** 제목·날짜·순서·썸네일은 DB 것을 그대로 두고
 * 본문만 채우고 externalHref 를 지운다(그래야 아임웹으로 보내지 않고 사이트에서 읽는다).
 * 영문 제목도 이미 있으면 그것을 쓴다(사람이 고쳐 둔 것이 있다).
 *
 * NAS 경로는 .env 의 SYNOLOGY_WEBDAV_BASE_PATH 를 쓴다. --prod 는 DB 만 고른다.
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"

import { prisma } from "../lib/db"
import { Prisma } from "../generated/prisma"
import { PostInputSchema, type PostBlock, type PostLocale } from "../lib/schemas/website"
import { storeMedia } from "../lib/website-media"
import { translateLocale } from "../lib/website-translate"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const ITEMS = path.resolve(opt("--items") ?? "")
const IMG_DIR = path.resolve(opt("--img") ?? "")
const DRY = flag("--dry-run")
const TRANSLATE = !flag("--no-translate")
const ONLY = (opt("--only") ?? "").split(",").filter(Boolean)
const USER = opt("--user") ?? "import-news-blocks"

interface Item {
  title: string
  date: string
  summary: string
  links: { label: string; href: string }[]
  blocks: ({ type: "text" | "heading"; text: string } | { type: "image"; file: string; src: string })[]
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

function guardTarget() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "")
  console.log(`DB 대상: ${host}`)
  if (host.includes("neon.tech") !== flag("--prod")) {
    console.error(flag("--prod") ? "--prod 인데 Neon 이 아니다" : "Neon 인데 --prod 가 없다")
    process.exit(1)
  }
}

/** Neon pooler 가 간헐적으로 끊긴다. 오래 도는 이식이므로 몇 번 다시 시도한다. */
async function retry<T>(label: string, fn: () => Promise<T>, times = 4): Promise<T> {
  let last: unknown
  for (let i = 1; i <= times; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!/reach database server|Closed|ECONNRESET|timeout/i.test(msg)) throw err
      console.warn(`  다시 시도 ${i}/${times} — ${label}`)
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
  throw last
}

async function run() {
  guardTarget()
  if (!fs.existsSync(ITEMS)) throw new Error(`items.json 이 없다: ${ITEMS}`)
  if (!fs.existsSync(IMG_DIR)) throw new Error(`이미지 폴더가 없다: ${IMG_DIR}`)

  const raw = JSON.parse(fs.readFileSync(ITEMS, "utf8")) as Record<string, Item>
  const entries = Object.entries(raw).filter(([id]) => ONLY.length === 0 || ONLY.includes(id))
  const rows = await prisma.websitePost.findMany({ where: { id: { in: entries.map(([id]) => id) } } })
  const byId = new Map(rows.map((r) => [r.id, r]))

  console.log(`기사 ${entries.length}건${DRY ? " (dry-run)" : ""}${TRANSLATE ? "" : " · 번역 없음"}`)
  const notes: string[] = []

  for (const [index, [id, item]] of entries.entries()) {
    const row = byId.get(id)
    if (!row) {
      notes.push(`${id}: DB 에 행이 없다 — 건너뜀`)
      continue
    }
    const old = (row.content ?? {}) as { ko?: PostLocale; en?: PostLocale }

    // 1) 블록 — 사진은 NAS 로 올리고, 순서는 옛 본문 그대로.
    const blocks: PostBlock[] = []
    let shot = 0
    for (const b of item.blocks) {
      if (b.type === "image") {
        const file = path.join(IMG_DIR, b.file)
        if (!fs.existsSync(file)) {
          notes.push(`${id}: 사진 없음 ${b.file}`)
          continue
        }
        const contentType = MIME[path.extname(b.file).toLowerCase()]
        if (!contentType) throw new Error(`${id}: 지원하지 않는 형식 ${b.file}`)
        const bytes = fs.readFileSync(file)
        const url = DRY
          ? `/omnis/api/website/media/${id}/${b.file}`
          : (await retry(`${id} 사진`, () => storeMedia({ postId: id, bytes, contentType, name: b.file }))).url
        shot += 1
        blocks.push({ type: "image", src: url, alt: `${item.title} 사진 ${shot}` })
        continue
      }
      blocks.push(b.type === "heading" ? { type: "heading", text: b.text } : { type: "text", text: b.text })
    }
    if (item.links.length) blocks.push({ type: "links", title: "원문 보기", items: item.links })

    // 2) 한국어 — 제목은 DB 것을 그대로(사람이 오타를 고쳐 둔 것이 있다). 부제는 비어 있을 때만 채운다.
    const ko: PostLocale = {
      title: old.ko?.title ?? item.title,
      summary: old.ko?.summary || item.summary,
      blocks,
    }

    // 3) 영문 — 글자만 번역하고 사진은 같은 src 를 쓴다. 영문 제목이 이미 있으면 그것을 지킨다.
    let en: PostLocale | undefined = old.en
    if (TRANSLATE) {
      try {
        const t = await translateLocale(ko, "ko", "en")
        en = {
          title: old.en?.title || t.title,
          summary: old.en?.summary || t.summary,
          blocks: t.blocks.map((b, i) => (b.type === "image" ? blocks[i] : b)),
        }
      } catch (err) {
        notes.push(`${id}: 번역 실패 — ${err instanceof Error ? err.message : err}`)
      }
    }

    const input = PostInputSchema.parse({
      category: row.category,
      date: row.date,
      sourceLang: row.sourceLang,
      thumbnail: row.thumbnail,
      externalHref: null, // 이제 사이트에서 읽는다
      content: { ko, ...(en ? { en } : {}) },
      deck: null,
    })

    if (!DRY) {
      await retry(`${id} 저장`, () =>
        prisma.websitePost.update({
          where: { id },
          data: {
            externalHref: input.externalHref,
            content: input.content as Prisma.InputJsonValue,
            updatedById: USER,
          },
        })
      )
    }

    const kinds = blocks.map((b) => ({ image: "I", text: "T", heading: "H", quote: "Q", links: "L" })[b.type]).join("")
    console.log(
      `${String(index + 1).padStart(3)}/${entries.length} ${id} ${String(row.date).slice(0, 10)} ${ko.title.slice(0, 28)} · [${kinds}] · 사진 ${shot}${en ? " · 영문" : ""}${ko.summary ? "" : " · 부제 없음"}`
    )
  }

  if (notes.length) console.log(`\n남은 문제 ${notes.length}건\n${notes.join("\n")}`)
  console.log(`\n${DRY ? "(dry-run) " : ""}${entries.length}건 완료`)
  await prisma.$disconnect()
}

run().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
