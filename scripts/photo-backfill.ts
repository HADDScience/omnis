/**
 * 사진 설명 일괄 — 아직 설명이 없는 전사방 사진을 이 맥의 Claude 구독으로 설명해 색인한다.
 * 기존 사진(2026-10-29 기준 1,683장)과 카톡 이식으로 들어오는 사진이 이 길로 간다. 앱에 올린 사진은 lib/photo-describe.ts(gpt).
 *
 *   npx tsx scripts/photo-backfill.ts --dry                 # 대상 수만 (로컬 DB)
 *   npx tsx scripts/photo-backfill.ts --limit 50            # 로컬 DB 에 50장
 *   npx tsx scripts/photo-backfill.ts --target prod         # 운영 DB — 작업지시자 승인 뒤
 *   … --since 2026-10-29T00:00:00+09:00                     # 그 시각 뒤에 올라온 것만 (카톡 이식 직후)
 *
 * 사진 실물은 NAS 마운트(~/NAS)에서 읽기만 한다. 로컬 DB 는 운영 스냅샷이라 운영 첨부 폴더를 읽는다.
 * 멱등: describedAt 이 빈 것만 고른다 — 끊겨도 다시 돌리면 잇는다.
 * 계획: mydocs/plans/2026-10-29-photo-search.md 5단계
 */
import "dotenv/config"
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const target = value("--target") ?? "local"
const dry = flag("--dry")
const limit = Number(value("--limit") ?? Infinity)
const since = value("--since")
const workers = Number(value("--workers") ?? 3)
const model = value("--model") ?? "sonnet"

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

/** claude CLI — 앱용 ANTHROPIC_API_KEY 가 넘어가면 구독 대신 그 키로 과금된다. 카톡 이식 도구와 같은 처리 */
function askClaude(prompt: string): Promise<string> {
  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.ANTHROPIC_API_KEY
  return new Promise((resolve, reject) => {
    execFile("claude", ["-p", "--model", model, "--allowedTools", "Read", "--output-format", "json", prompt],
      { env, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 },
      (err, stdout) => {
        if (err) return reject(err)
        try { resolve((JSON.parse(stdout) as { result?: string }).result ?? "") } catch (e) { reject(e) }
      })
  })
}

async function main() {
  const { prisma } = await import("../lib/db")
  const { photoContextFor, savePhotoDescription } = await import("../lib/photo-describe")
  const { photoPrompt } = await import("../lib/photo-text")
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
  console.log(`대상 ${files.length}장${todo.length < files.length ? ` · 이번에 ${todo.length}장` : ""} · ${target} · claude ${model} · 동시 ${workers}`)
  if (dry) return
  if (todo.length === 0) return reindexMissing()

  const tmp = mkdtempSync(join(tmpdir(), "photo-backfill-"))
  let ok = 0, unparsed = 0, failed = 0, done = 0
  const t0 = Date.now()
  const queue = [...todo]
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const linked = nasPathOf(f.path)
        const src = linked ? join(NAS_ROOT, linked) : join(FILES_DIR, objectKeyFor(f.id, f.name))
        const found = await photoContextFor(f.id)
        if (!found || !existsSync(src)) { failed++; console.log(`  ✗ ${f.id} — ${found ? "실물 없음" : "대상 아님"}`); continue }
        const img = join(tmp, `${f.id}.jpg`)
        writeFileSync(img, await sharp(readFileSync(src)).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer())
        const text = await askClaude(`먼저 Read 도구로 이 이미지 파일을 열어 본다: ${img}\n\n${photoPrompt(found.ctx)}`)
        if (await savePhotoDescription(f.id, text, `claude-cli:${model}`)) ok++
        else { unparsed++; console.log(`  ? ${f.id} — 출력을 읽지 못함`) }
        rmSync(img, { force: true })
      } catch (e) {
        failed++
        console.log(`  ✗ ${f.id} — ${(e as Error).message.split("\n")[0].slice(0, 160)}`)
      }
      done++
      if (done % 10 === 0 || done === todo.length) {
        const per = (Date.now() - t0) / done / 1000
        console.log(`  ${done}/${todo.length} (성공 ${ok} · 못 읽음 ${unparsed} · 실패 ${failed}) · 장당 ${per.toFixed(1)}초 · 남은 시간 약 ${Math.round(per * (todo.length - done) / 60)}분`)
      }
    }
  }))
  rmSync(tmp, { recursive: true, force: true })
  console.log(`끝 — 성공 ${ok} · 못 읽음 ${unparsed} · 실패 ${failed}`)
  await reindexMissing()
}

/**
 * 설명은 저장됐는데 색인이 없는 사진 — 설명을 저장한 뒤 임베딩이 실패하면 생긴다(설명은 다시 만들지 않는다).
 * 설명 단계와 따로 둬서, 키 문제로 색인만 실패해도 다시 돌리면 여기서 줍는다.
 */
async function reindexMissing() {
  const { prisma } = await import("../lib/db")
  const { syncEmbeddings } = await import("../lib/embeddings")
  const described = await prisma.file.findMany({ where: { describedAt: { not: null } }, select: { id: true } })
  const indexed = new Set((await prisma.embeddingChunk.findMany({ where: { source: "PHOTO" }, select: { sourceId: true } })).map((c) => c.sourceId))
  const missing = described.filter((f) => !indexed.has(f.id))
  if (missing.length === 0) return
  console.log(`색인 빠진 사진 ${missing.length}장 — 다시 색인`)
  let fail = 0
  for (const f of missing) {
    try { await syncEmbeddings("PHOTO", f.id) } catch (e) { fail++; if (fail <= 3) console.log(`  ✗ ${f.id} — ${(e as Error).message.slice(0, 120)}`) }
  }
  console.log(`  색인 ${missing.length - fail}/${missing.length}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
