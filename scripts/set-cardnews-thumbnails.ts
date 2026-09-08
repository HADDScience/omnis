/**
 * 재작성한 카드뉴스 글의 썸네일을 스펙의 `thumbnail`(옛 사이트가 쓰던 카드)로 바꾼다. 카드는 다시 굽지 않고,
 * 이미 올라간 카드 그림을 NAS 에서 읽어 640 으로 줄여 새 이름으로 올린다.
 *
 *   npx tsx scripts/set-cardnews-thumbnails.ts --site ~/work/hadd-website --ids 172090069,… [--dry-run] [--prod]
 *
 * rebuild-cardnews.ts 를 다시 돌리면 같은 규칙으로 썸네일이 나오므로, 이 스크립트는 다시 굽지 않을 때의 지름길이다.
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"

import { Prisma } from "../generated/prisma"
import sharp from "sharp"

import type { PostLocale } from "../lib/schemas/website"
import { prisma } from "../lib/db"
import { getObject } from "../lib/storage"
import { MEDIA_PUBLIC_BASE, mediaKey, storeMedia } from "../lib/website-media"

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const SITE = path.resolve(opt("--site") ?? path.join(process.env.HOME ?? "", "work/hadd-website"))
const IDS = (opt("--ids") ?? "").split(",").filter(Boolean)
const DRY = flag("--dry-run")
const RUN = new Date().toISOString().slice(2, 16).replace(/[-T:]/g, "")

{
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "")
  console.log(`DB 대상: ${host}`)
  if (host.includes("neon.tech") !== flag("--prod")) {
    console.error(flag("--prod") ? "--prod 인데 Neon 이 아니다" : "Neon 인데 --prod 가 없다")
    process.exit(1)
  }
}

interface Spec {
  id: string
  thumbnail?: string
  cards: { source: string; card?: unknown; cards?: unknown[] }[]
}

async function readMedia(url: string): Promise<Buffer> {
  if (!url.startsWith(MEDIA_PUBLIC_BASE + "/")) throw new Error(`사이트 밖 사진: ${url}`)
  const [postId, name] = url.slice(MEDIA_PUBLIC_BASE.length + 1).split("/")
  const res = await getObject(mediaKey(postId, name))
  const chunks: Buffer[] = []
  for await (const c of res.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  return Buffer.concat(chunks)
}

async function run(id: string) {
  const spec = JSON.parse(fs.readFileSync(path.join(SITE, "content/data/cardnews-rebuild", `${id}.json`), "utf8")) as Spec
  if (!spec.thumbnail) {
    console.log(`${id}: thumbnail 없음 — 건너뜀`)
    return
  }
  // 옛 카드 → 새 카드 번호. 옛 카드가 여러 장으로 나뉘었으면 그 첫 장. rebuild-cardnews.ts 의 thumbIndex 와 같은 규칙.
  const flat = spec.cards.flatMap((sc) => (sc.cards ?? [sc.card]).map(() => sc))
  const at = flat.findIndex((sc) => sc.source === spec.thumbnail)
  if (at < 0) throw new Error(`${id}: thumbnail "${spec.thumbnail}" 이 cards 의 source 에 없다`)

  const row = await prisma.websitePost.findUnique({ where: { id } })
  if (!row) throw new Error(`${id}: WebsitePost 없음`)
  const content = row.content as Partial<Record<"ko" | "en", PostLocale>>
  const next: Partial<Record<"ko" | "en", PostLocale>> = { ...content }
  let postThumb = row.thumbnail
  for (const lang of ["ko", "en"] as const) {
    const loc = content[lang]
    if (!loc) continue
    const images = loc.blocks.filter((b) => b.type === "image")
    const block = images[at]
    if (!block || block.type !== "image") throw new Error(`${id} ${lang}: ${at + 1}번째 카드 그림이 없다 (그림 ${images.length}장)`)
    console.log(`${id} ${lang}: 옛 ${spec.thumbnail} → 새 ${at + 1}/${images.length} ${block.src}`)
    if (DRY) continue
    const bytes = await sharp(await readMedia(block.src)).resize(640, 640).webp({ quality: 85 }).toBuffer()
    const stored = await storeMedia({ postId: id, bytes, contentType: "image/webp", name: `rebuild-${RUN}-thumb${lang === "ko" ? "" : "-en"}.webp` })
    if (lang === "ko") postThumb = stored.url
    else next.en = { ...loc, thumbnail: stored.url }
  }
  if (DRY) return
  await prisma.websitePost.update({ where: { id }, data: { thumbnail: postThumb, content: next as Prisma.InputJsonValue } })
}

async function main() {
  if (!IDS.length) throw new Error("--ids 가 필요하다")
  try {
    for (const id of IDS) await run(id)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((err) => {
  console.error(err)
  process.exit(1)
})
