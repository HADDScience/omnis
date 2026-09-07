// 5단계 — 카톡에서 따로 내려받은 첨부 실물을 메시지에 붙인다.
//
// 카톡 내보내기 CSV 에는 첨부가 `File: 이름.pdf` · `Photo` · `3 photos` · `Video` 같은
// 자리표시로만 남는다. 실물은 채팅방 서랍(사진·파일)에서 따로 저장해야 하고, 그 폴더를
// `--media` 로 주면 여기서 짝을 맞춘다.
//
//   File: 이름  → 파일 이름이 같은 것 (확실)
//   Photo/Video → 파일 이름에 박힌 시각과 메시지 시각이 ±3분 안 (카톡이 붙이는
//                 KakaoTalk_Photo_2026-09-03-15-30-14 001.jpeg 꼴일 때만)
//
// 짝이 안 맞는 것은 붙이지 않고 목록으로 보고한다 — 엉뚱한 사진이 붙는 것보다 낫다.
import { randomUUID } from "crypto"
import { readdirSync, readFileSync, statSync } from "fs"
import { extname, join } from "path"
import { prisma, ROOMS, messageSourceId, parseKst, type RawSession } from "../kakao-common"
import { putObject, objectKeyFor, MAX_UPLOAD_BYTES } from "../../lib/storage"

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

interface Candidate { path: string; name: string; size: number; stamp: Date | null }

/** 카톡이 저장할 때 붙이는 이름에서 시각을 읽는다. 없으면 null. */
function stampOf(name: string): Date | null {
  let m = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`)
  m = name.match(/KakaoTalk_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
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

const isPhotoLike = (m: string) => /^(Photo|\d+ photos|Video)$/.test(m.trim())
const fileNameOf = (m: string) => (m.startsWith("File: ") ? m.slice(6).trim().normalize("NFC") : null)
const WINDOW_MS = 3 * 60 * 1000

export async function attachMedia(sessions: RawSession[], dir: string, opts: { dry: boolean }) {
  const files = scan(dir)
  const byName = new Map<string, Candidate>()
  for (const f of files) byName.set(f.name, f)
  const stamped = files.filter((f) => f.stamp).sort((a, b) => a.stamp!.getTime() - b.stamp!.getTime())
  console.log(`  폴더 파일 ${files.length}개 (시각 있는 것 ${stamped.length})`)

  // 자리표시 메시지 목록 — DB 에 있는 것만 (메시지 이식이 먼저다).
  const placeholders: { sourceId: string; t: Date; name: string | null; photo: boolean }[] = []
  for (const s of sessions) {
    if (!ROOMS[s.room]) continue
    for (const m of s.msgs) {
      const name = fileNameOf(m.m)
      const photo = isPhotoLike(m.m)
      if (!name && !photo) continue
      placeholders.push({ sourceId: messageSourceId(s.room, m), t: parseKst(m.t), name, photo })
    }
  }
  const dbMsgs = await prisma.chatMessage.findMany({
    where: { sourceId: { in: placeholders.map((p) => p.sourceId) } },
    select: { id: true, sourceId: true, files: { select: { name: true } } },
  })
  const msgBySource = new Map(dbMsgs.map((m) => [m.sourceId!, m]))

  const plan: { messageId: string; file: Candidate; how: string }[] = []
  const used = new Set<string>()
  let alreadyAttached = 0, unmatchedFiles = 0, unmatchedPhotos = 0, tooBig = 0

  for (const p of placeholders) {
    const msg = msgBySource.get(p.sourceId)
    if (!msg) continue
    if (p.name) {
      if (msg.files.some((f) => f.name.normalize("NFC") === p.name)) { alreadyAttached++; continue }
      const f = byName.get(p.name)
      if (!f) { unmatchedFiles++; continue }
      if (f.size > MAX_UPLOAD_BYTES) { tooBig++; console.log(`  ⚠ 너무 큼 (${(f.size / 1048576).toFixed(1)}MB): ${f.name}`); continue }
      plan.push({ messageId: msg.id, file: f, how: "이름" }); used.add(f.path)
    } else if (p.photo) {
      if (msg.files.length > 0) { alreadyAttached++; continue }
      const near = stamped.filter((f) => !used.has(f.path) && Math.abs(f.stamp!.getTime() - p.t.getTime()) <= WINDOW_MS)
      if (near.length === 0) { unmatchedPhotos++; continue }
      for (const f of near) {
        if (f.size > MAX_UPLOAD_BYTES) { tooBig++; continue }
        plan.push({ messageId: msg.id, file: f, how: "시각" }); used.add(f.path)
      }
    }
  }
  const leftover = files.filter((f) => !used.has(f.path))
  console.log(`  붙일 것 ${plan.length}개 (이름 ${plan.filter((p) => p.how === "이름").length} · 시각 ${plan.filter((p) => p.how === "시각").length}) · 이미 붙음 ${alreadyAttached} · 너무 큼 ${tooBig}`)
  console.log(`  못 맞춘 것 — 파일 자리표시 ${unmatchedFiles} · 사진 자리표시 ${unmatchedPhotos} · 폴더에 남은 파일 ${leftover.length}`)
  if (leftover.length > 0 && leftover.length <= 20) for (const f of leftover) console.log(`    - ${f.name}`)
  if (opts.dry || plan.length === 0) return { attached: 0 }

  let attached = 0
  for (const { messageId, file } of plan) {
    const id = randomUUID()
    const body = readFileSync(file.path)
    const mimeType = mimeOf(file.name)
    // NAS에 먼저 올리고, 성공한 뒤에만 DB에 기록한다 (앱의 업로드 경로와 같은 순서).
    await putObject(objectKeyFor(id, file.name), body, mimeType)
    await prisma.file.create({ data: { id, name: file.name, path: `/api/files/${id}/raw`, size: file.size, mimeType, messageId } })
    attached++
    process.stdout.write(`\r  올리는 중 ${attached}/${plan.length}`)
  }
  console.log()
  return { attached }
}
