/**
 * 아임웹 "하드:라이브러리" 글을 Neon 의 WebsitePost(category=library) / NAS 로 옮긴다.
 *
 *   npx tsx scripts/import-library.ts --items <items.json> --img <이미지폴더>            # 로컬 DB
 *   … --prod                                                                            # Neon
 *   … --dry-run                                                                         # 쓰지 않고 검사만
 *   … --only 171911648,172871704                                                        # 몇 건만
 *   … --no-translate                                                                    # 영문 번역 건너뛰기
 *
 * items.json 은 크롤러가 만든 `{ <글번호>: { title, date, text, images[], links[] } }` 다.
 * 두 번 돌려도 같은 결과다 — 글은 id 로 upsert, 사진은 같은 키가 있으면 올리지 않는다.
 *
 * 만드는 모양(뉴스와 같은 블록 구조):
 *   ko.title    = 원문 제목
 *   ko.summary  = 본문 첫 줄(부제)
 *   ko.blocks   = [image, text, (links "기사 원문")]
 *   en          = 자동 번역. **이미지는 원본을 그대로 쓴다**(그림에 한글이 없다) — src 동일.
 *   thumbnail   = 첫 이미지를 640 webp 로 줄인 것. 언어 공통.
 *
 * NAS 경로는 .env 의 SYNOLOGY_WEBDAV_BASE_PATH 를 그대로 쓴다. --prod 는 DB 만 고른다.
 *   SYNOLOGY_WEBDAV_BASE_PATH="/HADD Science/옴니스 첨부파일/files" npx tsx … --prod
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"

import sharp from "sharp"

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
/** 이식하는 사람. updatedById 로 남는다(감사 추적). */
const USER = opt("--user") ?? "import-library"

interface Item {
  title: string
  date: string
  text: string
  images: { file: string; src: string }[]
  links: { label: string; href: string }[]
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }

function guardTarget() {
  const url = process.env.DATABASE_URL ?? ""
  const host = url.match(/@([^/:]+)/)?.[1] ?? "(알 수 없음)"
  console.log(`DB 대상: ${host}`)
  if (host.includes("neon.tech") && !flag("--prod")) {
    console.error("프로덕션 DB 다. 정말 넣을 거면 --prod 를 붙인다.")
    process.exit(1)
  }
}

/** 본문 텍스트 → 부제(첫 줄) + 나머지 단락. "기사 원문" 같은 링크 안내 줄은 뺀다(links 로 나간다). */
function splitText(text: string, links: Item["links"]): { summary: string; body: string } {
  const labels = new Set(links.map((l) => l.label.trim()))
  const lines = text
    .split("\n")
    .map((l) => l.replace(/ /g, " ").trim())
    .filter((l) => l && !labels.has(l) && !/^(기사|논문)\s*원문(\s*링크)?$/.test(l))
  const summary = lines.shift() ?? ""
  return { summary, body: lines.join("\n\n") }
}

/** Neon 이 간헐적으로 끊긴다(pooler). 이식은 오래 돌므로 몇 번 다시 시도한다. */
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
  const entries = Object.entries(raw)
    .filter(([id]) => ONLY.length === 0 || ONLY.includes(id))
    // 목록은 최신이 위. position 은 날짜 내림차순으로 매긴다.
    .sort((a, b) => (a[1].date === b[1].date ? a[0].localeCompare(b[0]) : b[1].date.localeCompare(a[1].date)))

  console.log(`라이브러리 ${entries.length}건${DRY ? " (dry-run)" : ""}${TRANSLATE ? "" : " · 번역 없음"}`)
  const summary: string[] = []

  for (const [index, [id, item]] of entries.entries()) {
    const position = index
    const { summary: sub, body } = splitText(item.text, item.links)

    // 1) 사진 업로드 — 원본 파일명을 그대로 쓴다(두 번 돌려도 같은 키).
    const blocks: PostBlock[] = []
    let thumbnail: string | null = null
    for (const [n, img] of item.images.entries()) {
      const file = path.join(IMG_DIR, img.file)
      if (!fs.existsSync(file)) {
        summary.push(`${id}: 사진 없음 ${img.file}`)
        continue
      }
      const ext = path.extname(img.file).toLowerCase()
      const contentType = MIME[ext]
      if (!contentType) throw new Error(`${id}: 지원하지 않는 형식 ${ext}`)
      const bytes = fs.readFileSync(file)
      const url = DRY
        ? `/omnis/api/website/media/${id}/${img.file}`
        : (await retry(`${id} 사진`, () => storeMedia({ postId: id, bytes, contentType, name: img.file }))).url
      blocks.push({ type: "image", src: url, alt: `${item.title} 이미지 ${n + 1}` })
      if (!thumbnail) {
        const thumbBytes = await sharp(bytes).resize(640, 640, { fit: "inside" }).webp({ quality: 85 }).toBuffer()
        thumbnail = DRY
          ? `/omnis/api/website/media/${id}/thumb.webp`
          : (await retry(`${id} 썸네일`, () => storeMedia({ postId: id, bytes: thumbBytes, contentType: "image/webp", name: "thumb.webp" }))).url
      }
    }

    // 2) 본문 · 원문 링크
    if (body) blocks.push({ type: "text", text: body })
    if (item.links.length) blocks.push({ type: "links", title: "원문 보기", items: item.links })

    const ko: PostLocale = { title: item.title, summary: sub, blocks }

    // 3) 영문 — 글자만 번역하고 사진은 같은 src 를 쓴다.
    let en: PostLocale | undefined
    if (TRANSLATE) {
      try {
        const t = await translateLocale(ko, "ko", "en")
        // 사진은 **주소만** 한국어 블록에서 가져온다. 블록을 통째로 갈면 번역된 alt 까지 한글로 돌아간다.
        en = {
          ...t,
          blocks: t.blocks.map((b, i) => {
            const src = blocks[i]
            return b.type === "image" && src?.type === "image" ? { ...b, src: src.src } : b
          }),
        }
      } catch (err) {
        summary.push(`${id}: 번역 실패 — ${err instanceof Error ? err.message : err}`)
      }
    }

    const input = PostInputSchema.parse({
      category: "library",
      date: item.date,
      sourceLang: "ko",
      thumbnail,
      externalHref: null,
      content: { ko, ...(en ? { en } : {}) },
      deck: null,
    })

    if (!DRY) {
      const data = {
        category: input.category,
        date: input.date,
        sourceLang: input.sourceLang,
        thumbnail: input.thumbnail,
        externalHref: input.externalHref,
        content: input.content as Prisma.InputJsonValue,
        deck: Prisma.JsonNull,
        updatedById: USER,
      }
      await retry(`${id} 저장`, () =>
        prisma.websitePost.upsert({
          where: { id },
          create: { id, position, ...data },
          update: { position, ...data },
        })
      )
    }

    console.log(
      `${String(index + 1).padStart(3)}/${entries.length} ${id} ${item.date} ${item.title.slice(0, 34)} · 사진 ${blocks.filter((b) => b.type === "image").length} · 본문 ${body.length}자${en ? " · 영문" : ""}`
    )
  }

  if (summary.length) console.log(`\n남은 문제 ${summary.length}건\n${summary.join("\n")}`)
  console.log(`\n${DRY ? "(dry-run) " : ""}${entries.length}건 완료`)
  await prisma.$disconnect()
}

run().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
