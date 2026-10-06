// 5단계 — 카톡에서 따로 내려받은 첨부 실물을 메시지에 붙인다.
//
// 카톡 내보내기 CSV 에는 첨부가 `File: 이름.pdf` · `Photo` · `3 photos` · `Video` 같은
// 자리표시로만 남는다. 실물은 따로 받아야 하고, 그 폴더를 `--media` 로 주면 여기서 짝을 맞춘다.
// 받는 길은 둘이다.
//   - PC 채팅방 서랍에서 저장  → KakaoTalk_Photo_2026-09-03-15-30-14 001.jpeg · 원래 파일 이름
//   - 휴대폰 「대화 내보내기」 zip → 20260903_153014_12.jpeg · 20260903_153014.pdf (원래 이름이 없다)
// 두 꼴 모두 이름의 시각이 **보낸 시각**이다(휴대폰 zip 1,023개 중 984개가 자리표시와 60초 안, 2026-10-06 실측).
//
//   File: 이름  → 같은 이름의 파일. 없으면 같은 확장자 중 시각이 ±3분 안에서 가장 가까운 것
//                 (휴대폰 zip 은 이름이 없으므로) — 붙일 때 이름은 자리표시의 원래 이름을 쓴다
//   Photo · N photos · Video → 시각 ±3분 안의 사진(또는 영상)을 가까운 순으로 N개
//
// 짝이 안 맞는 것은 붙이지 않고 목록으로 보고한다 — 엉뚱한 사진이 붙는 것보다 낫다.
// 제외 목록의 줄 ±2분 안에 있는 사진·영상은 붙이지 않는다. 가린 대화의 대상이 사진인 경우가 많다
// (뒷말과 함께 돈 사진 등) — 글만 가리고 사진을 붙이면 가린 의미가 없다. 문서 파일은 붙인다.
// 그 사진도 「쓴 것」으로 쳐서 옆 사진 메시지에 잘못 붙지 않게 한다.
// 크기 상한(앱 업로드의 4MB)은 두지 않는다. 그 상한은 Vercel 요청 본문 때문이고, 여기서는 NAS 에 바로 올리며
// 내려받기(`/api/files/[id]/raw`)는 NAS 에서 스트리밍한다.
import { randomUUID } from "crypto"
import { readdirSync, readFileSync, statSync } from "fs"
import { extname, join } from "path"
import { prisma, ROOMS, messageSourceId, parseKst, type RawSession } from "../kakao-common"
import { loadExclude } from "../redaction"
import { putObject, objectKeyFor } from "../../lib/storage"

const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".heic": "image/heic", ".mp4": "video/mp4", ".mov": "video/quicktime", ".zip": "application/zip",
  ".hwp": "application/x-hwp", ".hwpx": "application/x-hwp", ".ai": "application/postscript",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain", ".csv": "text/csv",
}
const mimeOf = (name: string) => MIME[extname(name).toLowerCase()] ?? "application/octet-stream"
const IMAGE = /\.(png|jpe?g|gif|heic|webp)$/i
const VIDEO = /\.(mp4|mov|m4v)$/i

interface Candidate { path: string; name: string; size: number; stamp: Date | null }

/** 카톡이 저장할 때 붙이는 이름에서 시각을 읽는다. 없으면 null. */
function stampOf(name: string): Date | null {
  let m = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`)
  m = name.match(/KakaoTalk_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`)
  // 휴대폰 「대화 내보내기」 zip — 20260903_153014_12.jpeg
  m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?\.\w+$/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`)
  return null
}

function scan(dir: string): Candidate[] {
  const out: Candidate[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...scan(p))
    else out.push({ path: p, name: e.name.normalize("NFC"), size: statSync(p).size, stamp: stampOf(e.name) })
  }
  return out
}

/** 사진 자리표시가 몇 장인지. 사진·영상이 아니면 0. */
function photoCount(m: string): { n: number; video: boolean } {
  const s = m.trim()
  if (s === "Photo") return { n: 1, video: false }
  if (s === "Video") return { n: 1, video: true }
  const k = s.match(/^(\d+) photos$/)
  return k ? { n: Number(k[1]), video: false } : { n: 0, video: false }
}
const fileNameOf = (m: string) => (m.startsWith("File: ") ? m.slice(6).trim().normalize("NFC") : null)
const WINDOW_MS = 3 * 60 * 1000
const NEAR_EXCLUDED_MS = 2 * 60 * 1000

export async function attachMedia(sessions: RawSession[], dir: string, opts: { dry: boolean }) {
  const files = scan(dir)
  const byName = new Map<string, Candidate>()
  for (const f of files) byName.set(f.name, f)
  const stamped = files.filter((f) => f.stamp)
  console.log(`  폴더 파일 ${files.length}개 (시각 있는 것 ${stamped.length})`)

  // 자리표시 메시지 목록 — DB 에 있는 것만 (메시지 이식이 먼저다).
  const excludedAt = new Map<string, number[]>()
  for (const e of loadExclude()) if (e.room && e.t) excludedAt.set(e.room, [...(excludedAt.get(e.room) ?? []), parseKst(e.t).getTime()])
  const placeholders: { sourceId: string; t: Date; name: string | null; n: number; video: boolean; nearExcluded: boolean }[] = []
  for (const s of sessions) {
    if (!ROOMS[s.room]) continue
    for (const m of s.msgs) {
      const name = fileNameOf(m.m)
      const { n, video } = photoCount(m.m)
      if (!name && n === 0) continue
      const t = parseKst(m.t)
      const nearExcluded = (excludedAt.get(s.room) ?? []).some((x) => Math.abs(x - t.getTime()) <= NEAR_EXCLUDED_MS)
      placeholders.push({ sourceId: messageSourceId(s.room, m), t, name, n, video, nearExcluded })
    }
  }
  const dbMsgs = await prisma.chatMessage.findMany({
    where: { sourceId: { in: placeholders.map((p) => p.sourceId) }, deletedAt: null },
    select: { id: true, sourceId: true, files: { select: { name: true } } },
  })
  const msgBySource = new Map(dbMsgs.map((m) => [m.sourceId!, m]))

  const plan: { messageId: string; file: Candidate; name: string; how: string }[] = []
  const used = new Set<string>()
  /** 시각 ±3분 안에서 아직 안 쓴 후보를 가까운 순으로. 같은 거리면 이름 순(_1, _2 …). */
  const nearest = (t: Date, ok: (f: Candidate) => boolean) =>
    stamped
      .filter((f) => !used.has(f.path) && ok(f) && Math.abs(f.stamp!.getTime() - t.getTime()) <= WINDOW_MS)
      .sort((a, b) => Math.abs(a.stamp!.getTime() - t.getTime()) - Math.abs(b.stamp!.getTime() - t.getTime()) || a.name.localeCompare(b.name, "en", { numeric: true }))
  let alreadyAttached = 0, unmatchedFiles = 0, unmatchedPhotos = 0, shortPhotos = 0, skippedNear = 0

  for (const p of [...placeholders].sort((a, b) => a.t.getTime() - b.t.getTime())) {
    const msg = msgBySource.get(p.sourceId)
    if (!msg) continue
    if (p.name) {
      if (msg.files.some((f) => f.name.normalize("NFC") === p.name)) { alreadyAttached++; continue }
      const exact = byName.get(p.name)
      const ext = extname(p.name).toLowerCase()
      const f = exact && !used.has(exact.path) ? exact : ext ? nearest(p.t, (c) => extname(c.name).toLowerCase() === ext)[0] : undefined
      if (!f) { unmatchedFiles++; continue }
      plan.push({ messageId: msg.id, file: f, name: p.name, how: f === exact ? "이름" : "시각" }); used.add(f.path)
    } else {
      if (msg.files.length > 0) { alreadyAttached++; continue }
      const near = nearest(p.t, (c) => (p.video ? VIDEO : IMAGE).test(c.name)).slice(0, p.n)
      if (near.length === 0) { unmatchedPhotos++; continue }
      if (p.nearExcluded) { for (const f of near) used.add(f.path); skippedNear += near.length; continue }
      if (near.length < p.n) shortPhotos++
      for (const f of near) { plan.push({ messageId: msg.id, file: f, name: f.name, how: "시각" }); used.add(f.path) }
    }
  }
  const leftover = files.filter((f) => !used.has(f.path))
  if (skippedNear > 0) console.log(`  제외한 대화 옆이라 붙이지 않은 사진·영상 ${skippedNear}개`)
  const mb = (n: number) => (n / 1048576).toFixed(0)
  console.log(`  붙일 것 ${plan.length}개 · ${mb(plan.reduce((a, p) => a + p.file.size, 0))}MB (이름 ${plan.filter((p) => p.how === "이름").length} · 시각 ${plan.filter((p) => p.how === "시각").length}) · 이미 붙음 ${alreadyAttached}`)
  console.log(`  못 맞춘 것 — 파일 자리표시 ${unmatchedFiles} · 사진 자리표시 ${unmatchedPhotos} (장수 모자람 ${shortPhotos}) · 폴더에 남은 파일 ${leftover.length}`)
  if (leftover.length > 0 && leftover.length <= 40) for (const f of leftover) console.log(`    - ${f.name}`)
  if (opts.dry || plan.length === 0) return { attached: 0 }

  let attached = 0
  for (const { messageId, file, name } of plan) {
    const id = randomUUID()
    const body = readFileSync(file.path)
    const mimeType = mimeOf(name)
    // NAS에 먼저 올리고, 성공한 뒤에만 DB에 기록한다 (앱의 업로드 경로와 같은 순서).
    await putObject(objectKeyFor(id, name), body, mimeType)
    await prisma.file.create({ data: { id, name, path: `/api/files/${id}/raw`, size: file.size, mimeType, messageId } })
    attached++
    process.stdout.write(`\r  올리는 중 ${attached}/${plan.length}`)
  }
  console.log()
  return { attached }
}
