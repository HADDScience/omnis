/**
 * 홈페이지 저장소의 기사(JSON + 사진)를 Neon 의 WebsitePost / NAS 로 옮긴다.
 *
 *   npx tsx scripts/import-website-posts.ts --site ~/work/hadd-website            # 로컬 DB
 *   npx tsx scripts/import-website-posts.ts --site ~/work/hadd-website --prod     # Neon
 *   npx tsx scripts/import-website-posts.ts --site ~/work/hadd-website --dry-run  # 쓰지 않고 검사만
 *
 * 두 번 돌려도 같은 결과다 — 기사는 id 로 upsert, 사진은 같은 키가 목록에 있으면 올리지 않는다.
 * 사진 이름은 원본 파일명을 그대로 쓴다(`website/<id>/01.webp`). 이식된 사진은 다시 쓰이지
 * 않으므로 고유 이름 규칙(무작위)을 따르지 않아도 캐시가 어긋나지 않는다.
 *
 * DB 대상을 먼저 찍고, Neon 이면 --prod 가 있어야 진행한다 (migration-traps 의 함정).
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"

import { prisma } from "../lib/db"
import { PostInputSchema, type PostInput } from "../lib/schemas/website"
import { mediaUrl, storeMedia } from "../lib/website-media"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const SITE = path.resolve(opt("--site") ?? path.join(process.env.HOME ?? "", "work/hadd-website"))
const DRY = flag("--dry-run")
const NEWS_DIR = path.join(SITE, "content/data/news")
const PUBLIC_DIR = path.join(SITE, "public")

const MIME: Record<string, string> = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" }

function guardTarget() {
  const url = process.env.DATABASE_URL ?? ""
  const host = url.replace(/^.*@/, "").replace(/\/.*$/, "")
  console.log(`DB 대상: ${host}`)
  if (host.includes("neon.tech") && !flag("--prod")) {
    console.error("대상이 Neon 인데 --prod 가 없다 — 중단")
    process.exit(1)
  }
  if (!host.includes("neon.tech") && flag("--prod")) {
    console.error("--prod 를 줬는데 대상이 Neon 이 아니다 — 중단")
    process.exit(1)
  }
}

/** JSON 안의 `/news/<id>/<file>` 경로를 전부 모은다. thumbnail · 블록 · 덱 어디에 있든. */
function collectSrcs(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    if (value.startsWith("/news/")) out.add(value)
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectSrcs(v, out))
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectSrcs(v, out))
  }
}

function replaceSrcs<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map((v) => replaceSrcs(v, map)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, replaceSrcs(v, map)])
    ) as T
  }
  return value
}

async function main() {
  guardTarget()
  const order = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, "order.json"), "utf8")) as string[]
  console.log(`기사 ${order.length}건 (${NEWS_DIR})`)

  let posts = 0
  let uploaded = 0
  let reused = 0
  const failures: string[] = []

  for (const [position, id] of order.entries()) {
    const raw = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, `${id}.json`), "utf8")) as Record<string, unknown>

    const toInput = (v: Record<string, unknown>) =>
      PostInputSchema.safeParse({
        date: v.date,
        sourceLang: v.sourceLang,
        thumbnail: v.thumbnail || null,
        externalHref: v.externalHref ?? null,
        content: v.content,
        deck: v.deck ?? null,
      })

    const first = toInput(raw)
    if (!first.success) {
      failures.push(`${id}: ${first.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
      continue
    }

    // 사진 행은 기사 id 를 외래키로 가리키므로 기사 행이 먼저 있어야 한다.
    // 옛 경로(/news/…)를 담은 채 먼저 넣고, 사진을 올린 뒤 새 URL 로 고쳐 쓴다.
    if (!DRY) {
      const data = { position, ...first.data, deck: first.data.deck ?? undefined }
      await prisma.websitePost.upsert({ where: { id }, create: { id, ...data }, update: data })
    }

    const srcs = new Set<string>()
    collectSrcs(raw, srcs)
    const urlOf = new Map<string, string>()
    for (const src of srcs) {
      const file = path.join(PUBLIC_DIR, src)
      const name = path.basename(src)
      const contentType = MIME[path.extname(name).toLowerCase()]
      if (!fs.existsSync(file) || !contentType) {
        failures.push(`${id}: 사진 없음 ${src}`)
        continue
      }
      if (DRY) {
        urlOf.set(src, mediaUrl(id, name))
        continue
      }
      const stored = await storeMedia({ postId: id, bytes: fs.readFileSync(file), contentType, name })
      urlOf.set(src, stored.url)
      if (stored.reused) reused++
      else uploaded++
    }

    const fixed = toInput(replaceSrcs(raw, urlOf))
    if (!fixed.success) {
      failures.push(`${id}: ${fixed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
      continue
    }
    const input: PostInput = fixed.data
    if (!DRY) {
      await prisma.websitePost.update({
        where: { id },
        data: { ...input, deck: input.deck ?? undefined },
      })
    }
    posts++
    process.stdout.write(`\r${posts}/${order.length} ${id}        `)
  }

  console.log(`\n\n기사 ${posts}건 ${DRY ? "검사" : "저장"}, 사진 올림 ${uploaded} · 이미 있음 ${reused}, 실패 ${failures.length}`)
  for (const f of failures) console.error(`  - ${f}`)
  await prisma.$disconnect()
  process.exit(failures.length ? 1 : 0)
}

main()
