// 카톡 글의 멱등 키(sourceId)를 새 기준으로 한 번 옮긴다 — 표시명 대신 계정 · 외부 발화자, 본문은 표시명을 계정 이름으로 바꾼 것.
// 운영의 카톡 글(kakao:%) · 마스터(raw/messages.json) · 제외 목록(exclude.json)의 키를 함께 바꾸고, 글 본문의 멘션 · 초대 줄도
// 계정 이름으로 바꾼다. 카드 연결 · 첨부는 글 id 에 붙어 있어 그대로다. 바뀐 본문의 검색 색인은 다음 이식의 임베딩 단계가
// contentHash 를 보고 다시 만든다.
//
//   npx tsx import-tools/migrate-source-ids.ts                                    로컬 · 보기만
//   npx tsx import-tools/migrate-source-ids.ts --target prod --report <파일>       운영 · 보기만. 집계 · 예시 · 새 키 목록은 <파일>에만
//   npx tsx import-tools/migrate-source-ids.ts --target prod --write-to <폴더>     옮긴 마스터 · 제외 목록을 그 폴더에만 쓴다 (건식 확인용)
//   npx tsx import-tools/migrate-source-ids.ts --target prod --apply              운영에 적용 (백업을 먼저 쓴다)
//   npx tsx import-tools/migrate-source-ids.ts --target prod --restore <백업>     백업대로 되돌린다
//
// 옛 키 → 새 키는 마스터의 원문 줄로 센다(운영 본문은 자리표시 빼기 · 가리기로 원문과 다를 수 있다).
// 마스터에 없는 운영 글 · 새 키가 겹치는 글(서로 다른 글이 같은 키)이 하나라도 있으면 --apply 는 쓰지 않고 멈춘다.
// --apply 는 바꿀 글의 id · 옛 키 · 옛 본문과 마스터 · 제외 목록 사본을 KAKAO_DATA_DIR/sourceid-backup-<시각>/(600)에 먼저 쓴다.
// 고칠 때는 키 · 본문이 백업과 같은 글만 고친다. 알림 · 재구성은 부르지 않고 고친 표시(editedAt)도 달지 않는다.
// 보고 파일에는 이름 · 글이 들어가므로 저장소 밖에 쓴다.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { resolve } from "path"
import { pointAtProd } from "./prod-env"

const args = process.argv.slice(2)
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
const prod = opt("--target") === "prod"
const apply = args.includes("--apply")
const restore = opt("--restore")
const reportPath = opt("--report")
const CHUNK = 500

interface Row { id: string; sourceId: string; content: string; roomId: string; room: string; author: string; deleted: boolean }
interface Backup { target: string; at: string; rows: { id: string; oldSourceId: string; newSourceId: string; before: string; after: string }[] }

async function main() {
  const where = prod ? pointAtProd() : (process.env.DATABASE_URL ?? "(.env)").replace(/:\/\/[^@]+@/, "://***@")
  console.log(`대상 DB: ${prod ? "🔴 프로덕션" : "로컬"} ${where} · ${restore ? "되돌리기" : apply ? "적용" : "보기만 (--apply 없음)"}`)
  const { prisma, DATA_DIR, IMPORT_CONFIG, KEYS_V2_MARK, legacyMessageSourceId, messageSourceId, normalizeRow, readJson, rowKey } = await import("./kakao-common")
  const { normalizeBody } = await import("./rooms-config")
  const { EXCLUDE_FILE } = await import("./redaction")
  const RAW = `${DATA_DIR}/raw/messages.json`

  const update = async (rows: { id: string; fromSource: string; fromContent: string; toSource: string; toContent: string }[]) => {
    let n = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK)
      n += await prisma.$executeRawUnsafe(
        `update "ChatMessage" m set "sourceId" = v.s, content = v.c
         from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) as v(id, os, oc, s, c)
         where m.id = v.id and m."sourceId" = v.os and m.content = v.oc`,
        part.map((r) => r.id), part.map((r) => r.fromSource), part.map((r) => r.fromContent), part.map((r) => r.toSource), part.map((r) => r.toContent),
      )
    }
    return n
  }

  if (restore) {
    const backup = JSON.parse(readFileSync(`${restore}/messages.json`, "utf8")) as Backup
    if (backup.target !== (prod ? "prod" : "local")) throw new Error(`백업 대상(${backup.target})과 지금 대상이 다르다`)
    const n = await update(backup.rows.map((r) => ({ id: r.id, fromSource: r.newSourceId, fromContent: r.after, toSource: r.oldSourceId, toContent: r.before })))
    copyFileSync(`${restore}/raw-messages.json`, RAW)
    if (existsSync(KEYS_V2_MARK)) rmSync(KEYS_V2_MARK)
    if (existsSync(`${restore}/exclude.json`)) copyFileSync(`${restore}/exclude.json`, EXCLUDE_FILE)
    console.log(`되돌림 ${n}/${backup.rows.length}건 · 마스터 · 제외 목록 되돌림`)
    return
  }

  // 1. 마스터의 원문 줄로 옛 키 → 새 키
  type Raw = { room: string; t: string; u: string; m: string; src?: "mobile" }
  if (existsSync(KEYS_V2_MARK)) throw new Error(`이미 옮긴 마스터다 (${KEYS_V2_MARK}) — 두 번 옮기면 본문 이름이 또 바뀐다. 중단`)
  const master = readJson<Raw[]>(RAW, [])
  const map = new Map<string, string>()
  for (const r of master) map.set(legacyMessageSourceId(r.room, r), messageSourceId(r.room, normalizeRow(r)))
  const migrated: Raw[] = []
  const seen = new Set<string>()
  let merged = 0
  for (const r of master.map(normalizeRow)) {
    const k = rowKey(r)
    if (seen.has(k)) { merged++; continue }
    seen.add(k); migrated.push(r)
  }
  console.log(`마스터 ${master.length}줄 → ${migrated.length}줄 (같은 사람 · 시각 · 본문으로 합쳐진 줄 ${merged}) · 본문이 바뀌는 줄 ${master.filter((r) => normalizeRow(r) !== r).length}`)

  // 2. 운영 글
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `select m.id, m."sourceId", m.content, m."roomId", r.name room, u.name author, (m."deletedAt" is not null) deleted
     from "ChatMessage" m join "ChatRoom" r on r.id = m."roomId" join "User" u on u.id = m."authorId"
     where m."sourceId" like 'kakao:%' order by m."createdAt"`,
  )
  const todo = rows.map((r) => ({ ...r, newSourceId: map.get(r.sourceId), after: normalizeBody(r.content, IMPORT_CONFIG) }))
  const unmapped = todo.filter((r) => !r.newSourceId)
  const byNew = new Map<string, string[]>()
  for (const r of todo) if (r.newSourceId) byNew.set(r.newSourceId, [...(byNew.get(r.newSourceId) ?? []), r.id])
  const collisions = [...byNew].filter(([, ids]) => ids.length > 1)
  // 새 키가 지금 남의 옛 키와 같으면 바꾸는 도중 유니크 제약에 걸린다
  const oldKeys = new Set(rows.map((r) => r.sourceId))
  const clashOld = todo.filter((r) => r.newSourceId && r.newSourceId !== r.sourceId && oldKeys.has(r.newSourceId))
  const keyChanged = todo.filter((r) => r.newSourceId && r.newSourceId !== r.sourceId)
  const bodyChanged = todo.filter((r) => r.after !== r.content)
  const count = (xs: typeof todo, f: (r: (typeof todo)[number]) => string) => Object.fromEntries([...xs.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]))
  console.log(`운영 카톡 글 ${rows.length}건 · 키가 바뀔 글 ${keyChanged.length} · 본문이 바뀔 글 ${bodyChanged.length} · 마스터에 없는 글 ${unmapped.length} · 새 키 겹침 ${collisions.length} · 옛 키와 부딪힘 ${clashOld.length}`)

  // 3. 제외 목록 — 원문 칸이 있으면 그것으로, 없으면 마스터로
  const exclude = readJson<{ key: string; room?: string; t?: string; u?: string; m?: string }[]>(EXCLUDE_FILE, [])
  let exMapped = 0, exUnmapped = 0
  const exNew = exclude.map((e) => {
    if (!e.key.startsWith("kakao:")) return e
    const key = e.room && e.t && e.u && e.m !== undefined ? messageSourceId(e.room, normalizeRow({ t: e.t, u: e.u, m: e.m })) : map.get(e.key)
    if (!key) { exUnmapped++; return e }
    exMapped++
    return { ...e, key }
  })
  console.log(`제외 목록 ${exclude.length}줄 · 카톡 키 바꿈 ${exMapped} · 못 바꿈 ${exUnmapped}`)

  if (reportPath) {
    const examples = [...bodyChanged.filter((r) => !r.deleted)].sort((a, b) => a.room.localeCompare(b.room)).filter((r, i, xs) => i === 0 || xs[i - 1].room !== r.room || i % 7 === 0).slice(0, 10)
    writeFileSync(reportPath, JSON.stringify({
      at: new Date().toISOString(), target: prod ? "prod" : "local",
      master: { rows: master.length, after: migrated.length, merged },
      prod: { rows: rows.length, keyChanged: keyChanged.length, bodyChanged: bodyChanged.length, unmapped: unmapped.length, collisions: collisions.length, clashOld: clashOld.length },
      bodyByAuthor: count(bodyChanged, (r) => r.author), bodyByRoom: count(bodyChanged, (r) => r.room),
      exclude: { rows: exclude.length, mapped: exMapped, unmapped: exUnmapped },
      examples: examples.map((r) => ({ room: r.room, author: r.author, before: r.content, after: r.after })),
      unmappedSamples: unmapped.slice(0, 20).map((r) => ({ id: r.id, room: r.room, author: r.author, content: r.content.slice(0, 80) })),
      collisionSamples: collisions.slice(0, 20),
      newSourceIds: [...byNew.keys()],
    }, null, 1), { mode: 0o600 })
    console.log(`보고 → ${resolve(reportPath)}`)
  }
  // 건식 확인용 — 옮긴 마스터 · 제외 목록을 다른 폴더에만 쓴다(DB · 원본은 그대로). 그 폴더를 KAKAO_DATA_DIR 로 건식을 돌려 본다
  const writeTo = opt("--write-to")
  if (writeTo) {
    mkdirSync(`${writeTo}/raw`, { recursive: true, mode: 0o700 })
    writeFileSync(`${writeTo}/raw/messages.json`, JSON.stringify(migrated, null, 1), { mode: 0o600 })
    writeFileSync(`${writeTo}/exclude.json`, JSON.stringify(exNew, null, 2), { mode: 0o600 })
    writeFileSync(`${writeTo}/raw/keys-v2`, new Date().toISOString() + "\n", { mode: 0o600 })
    console.log(`옮긴 마스터 · 제외 목록 → ${resolve(writeTo)}`)
  }
  if (!apply) return
  if (unmapped.length || collisions.length || clashOld.length || exUnmapped) throw new Error("마스터에 없는 글 · 겹침 · 부딪힘 · 못 바꾼 제외 줄이 있어 쓰지 않는다. 중단")

  const stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(2, 16).replace(/[-:T]/g, "")
  const dir = `${DATA_DIR}/sourceid-backup-${stamp}`
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const change = todo.filter((r) => r.newSourceId !== r.sourceId || r.after !== r.content)
  const backup: Backup = { target: prod ? "prod" : "local", at: new Date().toISOString(), rows: change.map((r) => ({ id: r.id, oldSourceId: r.sourceId, newSourceId: r.newSourceId!, before: r.content, after: r.after })) }
  writeFileSync(`${dir}/messages.json`, JSON.stringify(backup), { mode: 0o600 })
  copyFileSync(RAW, `${dir}/raw-messages.json`)
  if (existsSync(EXCLUDE_FILE)) copyFileSync(EXCLUDE_FILE, `${dir}/exclude.json`)
  for (const f of ["messages.json", "raw-messages.json", "exclude.json"]) if (existsSync(`${dir}/${f}`)) chmodSync(`${dir}/${f}`, 0o600)
  if ((JSON.parse(readFileSync(`${dir}/messages.json`, "utf8")) as Backup).rows.length !== change.length) throw new Error("백업 건수가 맞지 않는다. 중단")
  console.log(`백업 ${change.length}건 · 마스터 · 제외 목록 → ${dir}`)

  const n = await update(change.map((r) => ({ id: r.id, fromSource: r.sourceId, fromContent: r.content, toSource: r.newSourceId!, toContent: r.after })))
  writeFileSync(`${RAW}.tmp`, JSON.stringify(migrated, null, 1), { mode: 0o600 })
  copyFileSync(`${RAW}.tmp`, RAW)
  writeFileSync(EXCLUDE_FILE, JSON.stringify(exNew, null, 2), { mode: 0o600 })
  writeFileSync(KEYS_V2_MARK, new Date().toISOString() + "\n", { mode: 0o600 })
  console.log(`고침 ${n}/${change.length}건 (그 사이 바뀐 글은 건너뜀) · 마스터 · 제외 목록 이전 · 되돌리기: --restore ${dir}`)
}

main()
  .catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(async () => { const { prisma } = await import("./kakao-common"); await prisma.$disconnect() })
