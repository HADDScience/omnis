/**
 * 사진 설명 일괄 — 아직 설명이 없는 전사방 사진을 이 맥의 Claude 구독으로 설명해 색인한다.
 * 기존 사진(2026-10-29 기준 1,683장)과 카톡 이식으로 들어오는 사진이 이 길로 간다. 앱에 올린 사진은 lib/photo-describe.ts(gpt).
 *
 *   npx tsx scripts/photo-backfill.ts --dry                 # 대상 수만 (로컬 DB)
 *   npx tsx scripts/photo-backfill.ts --limit 50            # 로컬 DB 에 50장
 *   npx tsx scripts/photo-backfill.ts --target prod         # 운영 DB — 작업지시자 승인 뒤
 *   … --since 2026-10-29T00:00:00+09:00                     # 그 시각 뒤에 올라온 것만 (카톡 이식 직후)
 *   … --engine codex                                        # Claude 대신 Codex(ChatGPT 구독). --model 은 Codex 모델 이름
 *
 * 사진 실물은 NAS 마운트(~/NAS)에서 읽기만 한다. 로컬 DB 는 운영 스냅샷이라 운영 첨부 폴더를 읽는다.
 * 멱등: describedAt 이 빈 것만 고른다 — 끊겨도 다시 돌리면 잇는다.
 * 계획: mydocs/plans/2026-10-29-photo-search.md 5단계
 */
import "dotenv/config"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { PhotoLimitError, describeImageWithClaude, describeImageWithCodex } from "../import-tools/photo-describe-cli"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const target = value("--target") ?? "local"
const dry = flag("--dry")
const limit = Number(value("--limit") ?? Infinity)
const since = value("--since")
const workers = Number(value("--workers") ?? 3)
const engine = value("--engine") ?? "claude"
if (engine !== "claude" && engine !== "codex") throw new Error("--engine 은 claude 또는 codex")
const model = value("--model") ?? (engine === "claude" ? "sonnet" : undefined)
const describedBy = engine === "claude" ? `claude-cli:${model}` : `codex-cli:${model ?? "default"}`

/** 운영 첨부 폴더(읽기만). 로컬 DB 도 운영 스냅샷이라 같은 폴더를 본다 */
const NAS_ROOT = join(homedir(), "NAS")
const FILES_DIR = join(NAS_ROOT, "HADD Science/옴니스 첨부파일/files")

// 임베딩 키는 .env 값으로 덮는다 — ~/.zshrc 의 옛 GEMINI_API_KEY(잔액 0)가 셸에 남아 있으면 dotenv 가 덮지 않아
// 402 가 난다(2026-10-28 벤치 · 2026-10-29 이 스크립트 첫 실행). .env.production.local 의 값은 [SENSITIVE] 라 쓰지 않는다
if (existsSync(".env")) {
  const key = readFileSync(".env", "utf8").match(/^GEMINI_API_KEY=["']?([^"'\s]+)/m)?.[1]
  if (key) process.env.GEMINI_API_KEY = key
}

if (target === "prod") {
  // .env.production.local 의 Neon 주소로 — lib/db 를 불러오기 전에 바꿔야 Prisma 가 그 주소로 만들어진다
  const f = ".env.production.local"
  if (!existsSync(f)) throw new Error(`${f} 이 없다 — vercel env pull 로 받으세요`)
  const env = Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")] }))
  const url = env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL
  if (!url?.includes("neon.tech")) throw new Error("프로덕션 DB 주소가 Neon 이 아니다. 중단.")
  process.env.DATABASE_URL = url
} else if (!process.env.DATABASE_URL?.includes("localhost")) {
  throw new Error("로컬 대상인데 DATABASE_URL 이 localhost 가 아니다. 운영이면 --target prod 를 준다. 중단.")
}

async function main() {
  const { prisma } = await import("../lib/db")
  const { photoContextFor, savePhotoDescription } = await import("../lib/photo-describe")
  const { objectKeyFor } = await import("../lib/storage")
  const { nasPathOf } = await import("../lib/file-source")

  const files = await prisma.file.findMany({
    where: {
      mimeType: { in: ["image/png", "image/jpeg", "image/webp"] },
      describedAt: null,
      message: { deletedAt: null, room: { kind: "COMPANY" } },
      ...(since ? { createdAt: { gte: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, path: true },
  })
  const todo = files.slice(0, limit)
  console.log(`대상 ${files.length}장${todo.length < files.length ? ` · 이번에 ${todo.length}장` : ""} · ${target} · ${describedBy} · 동시 ${workers}`)
  if (dry) return
  if (todo.length === 0) return reindexMissing()

  let ok = 0, unparsed = 0, failed = 0, done = 0
  let quotaError: PhotoLimitError | null = null
  const t0 = Date.now()
  const queue = [...todo]
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let f = queue.shift(); f && !quotaError; f = queue.shift()) {
      try {
        const linked = nasPathOf(f.path)
        const src = linked ? join(NAS_ROOT, linked) : join(FILES_DIR, objectKeyFor(f.id, f.name))
        const found = await photoContextFor(f.id)
        if (!found || !existsSync(src)) { failed++; console.log(`  ✗ ${f.id} — ${found ? "실물 없음" : "대상 아님"}`); continue }
        const image = readFileSync(src)
        const text = engine === "claude" ? await describeImageWithClaude(image, found.ctx, model) : await describeImageWithCodex(image, found.ctx, model)
        // 색인은 끝에 100장씩 묶어서 — 사진마다 부르면 Gemini 하루 호출 한도(앱과 같이 쓴다)를 이 일괄이 다 쓴다(2026-10-30)
        if (await savePhotoDescription(f.id, text, describedBy, undefined, { embed: false })) ok++
        else { unparsed++; console.log(`  ? ${f.id} — 출력을 읽지 못함`) }
      } catch (e) {
        failed++
        if (e instanceof PhotoLimitError) quotaError = e
        console.log(`  ✗ ${f.id} — ${(e as Error).message.split("\n")[0].slice(0, 160)}`)
      }
      done++
      if (done % 10 === 0 || done === todo.length) {
        const per = (Date.now() - t0) / done / 1000
        console.log(`  ${done}/${todo.length} (성공 ${ok} · 못 읽음 ${unparsed} · 실패 ${failed}) · 장당 ${per.toFixed(1)}초 · 남은 시간 약 ${Math.round(per * (todo.length - done) / 60)}분`)
      }
    }
  }))
  console.log(`끝 — 성공 ${ok} · 못 읽음 ${unparsed} · 실패 ${failed}`)
  if (quotaError) throw quotaError
  await reindexMissing()
}

/**
 * 설명은 저장됐는데 색인이 없는 사진 — 설명 단계는 색인하지 않으므로 여기서 모두 줍는다(설명은 다시 만들지 않는다).
 * 설명 단계와 따로 둬서, 키 문제로 색인만 실패해도 다시 돌리면 여기서 줍는다.
 */
async function reindexMissing() {
  const { prisma } = await import("../lib/db")
  const { syncEmbeddingsBatch } = await import("../lib/embeddings")
  const described = await prisma.file.findMany({ where: { describedAt: { not: null } }, select: { id: true } })
  const indexed = new Set((await prisma.embeddingChunk.findMany({ where: { source: "PHOTO" }, select: { sourceId: true } })).map((c) => c.sourceId))
  const missing = described.filter((f) => !indexed.has(f.id))
  if (missing.length === 0) return
  console.log(`색인 빠진 사진 ${missing.length}장 — 100장씩 묶어 색인`)
  const r = await syncEmbeddingsBatch("PHOTO", missing.map((f) => f.id), {
    onProgress: (done, total) => console.log(`  색인 ${done}/${total}`),
  })
  console.log(`  색인 끝 — 새로 ${r.embedded} · 그대로 ${r.unchanged} · 대상 아님 ${r.removed}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
