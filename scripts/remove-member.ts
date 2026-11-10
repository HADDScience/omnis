/**
 * 회사를 떠난 사람을 Omnis 에서 **없앤다** — 계정·인력 정보는 지우고, 남이 쓴 글 속 이름은 가린다.
 * 지우기 전에 되돌릴 수 있는 백업을 남긴다.
 *
 * 「계정만 막기(isActive)」 와 다르다. 본인이 흔적을 남기지 않기를 원할 때 쓴다(2026-10-29 작업지시자 확정).
 * 백업에는 지운 행 원문(비밀번호 해시·개인정보 포함)이 들어 있다 — 저장소 밖, 권한이 좁은 곳에 둔다.
 *
 * 세 갈래로 다르게 다룬다:
 *
 * - **지운다** — 그 사람에 관한 행: 계정, 인력 정보(휴대폰·생년월일·과학기술인번호), 업무 담당 줄, 알림, 소셜 연결 …
 *   업무 담당 줄은 지워도 업무 카드는 남는다. 다른 담당자와 내용이 그대로다.
 * - **가린다** — 남이 쓴 글 속 이름(업무 배경·카드 원문 기록·체크리스트·채팅). 이름만 `(전 구성원)` 으로 바꾼다.
 *   글을 지우면 그 업무의 맥락이 끊긴다. 검색 색인은 바뀐 글로 다시 만든다 — 글자만 바꾸면 벡터에 원문이 남는다.
 * - **두지 않는다** — 그 사람이 **업무 기록의 주인**인 경우(지시한 업무·쓴 채팅·주간보고·카드 결정 …).
 *   지우면 남의 기록이 깨지므로 멈춘다. 그런 사람은 익명 계정으로 옮기는 방식이 따로 필요하다.
 *
 * 여기서 손대지 않는 것: CRM 연락처(다른 회사 소속으로서의 거래 기록이다), 외부 캘린더에서 받아 온 일정(다음 동기화에 다시 온다).
 * 끝나면 무엇이 남았는지 전부 다시 찾아 보여 준다.
 *
 *   npx tsx scripts/remove-member.ts 홍길동                           # 무엇을 지우고 가릴지만 보여준다
 *   npx tsx scripts/remove-member.ts 홍길동 --apply --backup <파일>    # 백업을 쓰고 다시 읽어 확인한 뒤 적용
 *   npx tsx scripts/remove-member.ts --restore <파일>                  # 되돌릴 것만 보여준다
 *   npx tsx scripts/remove-member.ts --restore <파일> --apply          # 되돌린다
 *
 * 운영에 돌릴 때는 DATABASE_URL · GEMINI_API_KEY 를 운영 값으로 덮는다.
 */
import "dotenv/config"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { prisma } from "../lib/db"
import { syncEmbeddingsBatch, type EmbeddingSource } from "../lib/embeddings"

const REPLACEMENT = "(전 구성원)"

/** 지워도 남의 기록이 깨지지 않는, 그 사람에 관한 표. `ip.members` 는 지식재산권 열람 권한이다 */
const DELETABLE = ["UserIdentity", "TaskAssignee", "Notification", "PushSubscription", "Bookmark", "OmnisViewLog", "OmnisQuery", "StaffProfile", "ip.members"]

/** 이름을 가릴 표. 글자 칸(text · jsonb)을 전부 본다 */
const REDACT = ["Task", "Checklist", "ChatMessage"]

type Row = Record<string, unknown>
interface Backup {
  name: string
  userId: string
  email: string | null
  host: string
  at: string
  /**
   * 되살릴 순서대로 — User 가 먼저. table 은 SQL 에 그대로 쓰는 이름(`"User"` · `ip.members`).
   * 지울 때는 `key` 칸이 `values` 중 하나인 행을 지운다 — 담당 줄처럼 id 가 없는 표가 있어서다.
   */
  deleted: { table: string; key: string; values: string[]; rows: Row[] }[]
  redacted: { table: string; id: string; column: string; type: string; before: string; after: string }[]
  /** 다시 만들 검색 색인 */
  embeddings: { source: EmbeddingSource; sourceId: string }[]
}

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const valueOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const restoreFile = valueOf("--restore")
const backupFile = valueOf("--backup")
const host = new URL(process.env.DATABASE_URL!).hostname

const q = <T = Row>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params)
const id = (t: string) => `"${t}"`

/** 그 표를 가리키는 외래키. 표 이름은 SQL 에 쓰는 꼴(`"User"` · `ip.members`)로 주고 받는다 */
async function foreignKeysTo(table: string) {
  return q<{ sql: string; col: string }>(`
    select c.conrelid::regclass::text sql, a.attname col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = $1::regclass`, table)
    .then((rs) => rs.map((r) => ({ ...r, child: r.sql.replace(/"/g, "") })))
}

async function plan(name: string): Promise<Backup> {
  const [user] = await q<{ id: string; email: string | null }>(`select id, email from "User" where name = $1`, name)
  if (!user) throw new Error(`${name} 계정이 없다`)

  // 1. 그 사람을 가리키는 행
  const deleted: Backup["deleted"] = []
  const blocked: string[] = []
  for (const fk of await foreignKeysTo(id("User"))) {
    const rows = (await q<{ j: Row }>(`select to_jsonb(x) j from ${fk.sql} x where ${id(fk.col)}::text = $1`, user.id)).map((r) => r.j)
    if (rows.length === 0) continue
    if (!DELETABLE.includes(fk.child)) { blocked.push(`${fk.child}.${fk.col} ${rows.length}건`); continue }
    if (fk.child === "StaffProfile") continue // 아래에서 이름과 함께 잡는다
    deleted.push({ table: fk.sql, key: fk.col, values: [user.id], rows })
  }
  // 인력 정보는 계정과 이어지지 않았어도 이름으로 잡는다
  const staff = (await q<{ j: Row }>(`select to_jsonb(x) j from "StaffProfile" x where name = $1 or "userId" = $2`, name, user.id)).map((r) => r.j)
  if (staff.length) deleted.push({ table: id("StaffProfile"), key: "id", values: staff.map((r) => r.id as string), rows: staff })
  // 지울 행을 다시 가리키는 행이 있으면(서명·직인 이미지 등) 그것까지 따라가지 않고 멈춘다
  for (const d of deleted) {
    const ids = d.rows.map((r) => r.id).filter(Boolean)
    if (ids.length === 0) continue
    for (const fk of await foreignKeysTo(d.table)) {
      const [{ n }] = await q<{ n: number }>(`select count(*)::int n from ${fk.sql} where ${id(fk.col)}::text = any($1::text[])`, ids)
      if (n) blocked.push(`${fk.child}.${fk.col} → ${d.table} ${n}건`)
    }
  }
  if (blocked.length) throw new Error(`지우면 남의 기록이 깨지는 참조가 있다 — 멈춘다:\n  ${blocked.join("\n  ")}`)
  const [userRow] = await q<{ j: Row }>(`select to_jsonb(x) j from "User" x where id = $1`, user.id)
  deleted.unshift({ table: id("User"), key: "id", values: [user.id], rows: [userRow.j] })

  // 2. 남이 쓴 글 속 이름
  const redacted: Backup["redacted"] = []
  for (const table of REDACT) {
    const cols = await q<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = $1 and data_type in ('text', 'character varying', 'jsonb')`, table)
    for (const c of cols) {
      const rows = await q<{ id: string; v: string }>(
        `select id, ${id(c.column_name)}::text v from ${id(table)} where ${id(c.column_name)}::text like '%' || $1 || '%'`, name)
      for (const r of rows) {
        redacted.push({ table, id: r.id, column: c.column_name, type: c.data_type, before: r.v, after: r.v.replaceAll(name, REPLACEMENT) })
      }
    }
  }

  // 3. 다시 만들 검색 색인 — 이름이 든 청크 + 고친 글
  const keys = new Set<string>()
  for (const r of await q<{ source: string; sourceId: string }>(`select source::text, "sourceId" from "EmbeddingChunk" where title || content like '%' || $1 || '%'`, name)) {
    keys.add(`${r.source}|${r.sourceId}`)
  }
  for (const r of redacted) {
    if (r.table === "Task") keys.add(`TASK|${r.id}`)
    if (r.table === "ChatMessage") keys.add(`CHAT_MESSAGE|${r.id}`)
    if (r.table === "Checklist") {
      const [c] = await q<{ taskId: string }>(`select "taskId" from "Checklist" where id = $1`, r.id)
      keys.add(`TASK|${c.taskId}`)
    }
  }
  const embeddings = [...keys].map((k) => { const [source, sourceId] = k.split("|"); return { source: source as EmbeddingSource, sourceId } })

  return { name, userId: user.id, email: user.email, host, at: new Date().toISOString(), deleted, redacted, embeddings }
}

async function reindex(list: Backup["embeddings"]) {
  const bySource = new Map<EmbeddingSource, string[]>()
  for (const e of list) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e.sourceId])
  for (const [source, ids] of bySource) {
    const r = await syncEmbeddingsBatch(source, ids)
    console.log(`  색인 ${source}: 다시 만듦 ${r.embedded} · 그대로 ${r.unchanged} · 지움 ${r.removed}`)
  }
}

/** 지운 뒤에도 남은 언급 — 이름 · 계정 ID · 이메일로 모든 표를 훑는다 */
async function leftovers(b: Pick<Backup, "name" | "userId" | "email">) {
  const tables = await q<{ t: string }>(`
    select format('%I.%I', schemaname, tablename) t from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema') and tablename <> '_prisma_migrations'`)
  const needles: [string, string][] = [[b.name, "이름"], [b.userId, "계정 ID"], ...(b.email ? [[b.email, "이메일"] as [string, string]] : [])]
  const found: string[] = []
  for (const { t } of tables) {
    for (const [n, label] of needles) {
      const [{ c }] = await q<{ c: number }>(`select count(*)::int c from ${t} x where x::text like '%' || $1 || '%'`, n)
      if (c) found.push(`${t} ∋ ${label} ${c}건`)
    }
  }
  console.log(found.length ? `남은 언급:\n  ${found.join("\n  ")}` : "남은 언급 없음")
}

function summarize(b: Backup) {
  console.log(`계정 ${b.name} (${b.userId})`)
  console.log("지울 행:")
  for (const d of b.deleted) console.log(`  ${d.table} ${d.rows.length}건`)
  console.log(`가릴 글: ${b.redacted.length}칸 — 「${b.name}」 → 「${REPLACEMENT}」`)
  for (const r of b.redacted) {
    const i = r.before.indexOf(b.name)
    console.log(`  ${r.table}.${r.column} ${r.id.slice(0, 8)} …${r.before.slice(Math.max(0, i - 25), i + 25).replace(/\s+/g, " ")}…`)
  }
  console.log(`다시 만들 색인: ${b.embeddings.length}건`)
}

async function remove(name: string) {
  const b = await plan(name)
  summarize(b)
  if (!apply) return console.log("\n아무것도 바꾸지 않았습니다. --apply --backup <파일> 을 붙이면 적용합니다.")
  if (!backupFile) throw new Error("--backup <파일> 이 필요하다")
  if (existsSync(backupFile)) throw new Error(`${backupFile} 이 이미 있다 — 덮어쓰지 않는다`)

  // 백업이 온전히 읽혀야만 지운다
  writeFileSync(backupFile, JSON.stringify(b, null, 1))
  const reread = JSON.parse(readFileSync(backupFile, "utf8")) as Backup
  if (reread.deleted.reduce((a, d) => a + d.rows.length, 0) !== b.deleted.reduce((a, d) => a + d.rows.length, 0) || reread.redacted.length !== b.redacted.length) {
    throw new Error("백업을 다시 읽은 결과가 다르다 — 멈춘다")
  }
  console.log(`\n백업: ${backupFile}`)

  await prisma.$transaction(async (tx) => {
    // raw 로 고쳐 updatedAt 을 건드리지 않는다 — 지난 카드가 오늘 고친 것으로 보이면 안 된다
    for (const r of b.redacted) {
      const cast = r.type === "jsonb" ? "::jsonb" : ""
      const n = await tx.$executeRawUnsafe(
        `update ${id(r.table)} set ${id(r.column)} = $1${cast} where id = $2 and ${id(r.column)}::text = $3`, r.after, r.id, r.before)
      if (n !== 1) throw new Error(`${r.table}.${r.column} ${r.id} 가 미리보기 뒤에 바뀌었다 — 되돌린다`)
    }
    for (const d of [...b.deleted].reverse()) {
      const n = await tx.$executeRawUnsafe(`delete from ${d.table} where ${id(d.key)}::text = any($1::text[])`, d.values)
      if (n !== d.rows.length) throw new Error(`${d.table}: ${d.rows.length}건이어야 하는데 ${n}건 — 되돌린다`)
    }
  })
  console.log("가리기 · 지우기 끝")
  await reindex(b.embeddings)
  await leftovers(b)
}

async function restore(file: string) {
  const b = JSON.parse(readFileSync(file, "utf8")) as Backup
  console.log(`백업 ${file} — ${b.name} · 원래 DB ${b.host} · ${b.at}`)
  if (b.host !== host) console.log(`⚠ 지금 DB(${host})가 백업을 뜬 DB 와 다르다`)
  for (const d of b.deleted) console.log(`  되살릴 ${d.table} ${d.rows.length}건`)
  // 가린 뒤 누가 그 글을 다시 고쳤으면 덮지 않는다
  const stale: string[] = []
  for (const r of b.redacted) {
    const [cur] = await q<{ v: string }>(`select ${id(r.column)}::text v from ${id(r.table)} where id = $1`, r.id)
    if (cur?.v !== r.after) stale.push(`${r.table}.${r.column} ${r.id}`)
  }
  console.log(`  되돌릴 글 ${b.redacted.length - stale.length}칸${stale.length ? ` · 그 뒤 바뀌어 건너뛸 칸 ${stale.length}: ${stale.join(", ")}` : ""}`)
  if (!apply) return console.log("\n아무것도 바꾸지 않았습니다. --apply 를 붙이면 되돌립니다.")

  await prisma.$transaction(async (tx) => {
    for (const d of b.deleted) {
      await tx.$executeRawUnsafe(`insert into ${d.table} select * from jsonb_populate_recordset(null::${d.table}, $1::jsonb)`, JSON.stringify(d.rows))
    }
    for (const r of b.redacted) {
      if (stale.includes(`${r.table}.${r.column} ${r.id}`)) continue
      const cast = r.type === "jsonb" ? "::jsonb" : ""
      await tx.$executeRawUnsafe(`update ${id(r.table)} set ${id(r.column)} = $1${cast} where id = $2`, r.before, r.id)
    }
  })
  console.log("되살리기 끝")
  await reindex(b.embeddings)
}

async function main() {
  console.log(`대상: ${host}`)
  console.log(apply ? "모드: 적용\n" : "모드: 미리보기\n")
  if (restoreFile) await restore(restoreFile)
  else if (args[0] && !args[0].startsWith("--")) await remove(args[0])
  else throw new Error("이름 또는 --restore <파일> 을 주세요")
}

main()
  .catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
