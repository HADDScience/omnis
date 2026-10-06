// Omnis 실험 DB → 실물 WeKnora 에 넣을 Markdown 말뭉치. DB 는 읽기만 한다.
//
//   npx tsx bench/wk-real/export.ts            # $WK_CORPUS_DIR/*.md + manifest.json
//
// 범위 = Omnis 색인과 같은 범위: "EmbeddingChunk" 에 행이 있는 소스만 (TASK · CHAT_MESSAGE · IP_CASE · WEEKLY_REPORT · OMNIS_CARD).
// 색인에 없는 것(짧은 잡담·시스템 메시지·보관된 업무·카톡 이식 제외 대상)은 들어가지 않는다 — 범위를 넓히지 않는다.
//
// 문서 단위
//   TASK          업무 1건 = 문서 1개: 업무 필드 + 체크리스트 + 그 업무의 채팅 스레드(색인된 메시지만, 시간순)
//   CHAT_DAY      업무 스레드에 들어가지 않은 색인 메시지를 방 × 날짜(KST)로 묶어 문서 1개
//                 (업무가 없거나, 업무가 색인 밖(보관)인 메시지. 후자는 Omnis 청크처럼 "관련 업무:" 줄을 단다)
//   IP_CASE · WEEKLY_REPORT · OMNIS_CARD   1건 = 문서 1개. 본문은 Omnis 색인 청크 본문 그대로
//
// 대조 표식: 각 문서 첫 줄 `omnis:<SOURCE>:<sourceId>` (채팅 묶음은 `omnis:CHAT_DAY:<날짜>`).
// manifest.json 에 문서별 대표 소스(source·sourceId)와 포함한 CHAT_MESSAGE id 목록, 메시지 줄의 앞머리(청크 대조용)를 남긴다.
// WeKnora 의 knowledge metadata 에는 대표 소스와 메시지 수만 넣는다(ingest.ts) — id 목록은 여기 manifest 에 있다.
import "dotenv/config"
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import { prisma } from "@/lib/db"
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants"
import { corpusDir } from "./client"

export interface ManifestMessage {
  id: string
  /** 문서 안 메시지 줄의 앞머리 — WeKnora 청크 본문에서 이 문자열을 찾아 청크가 담은 메시지를 가린다 */
  probe: string
}

export interface ManifestDoc {
  /** 파일 이름이자 문서 키. WeKnora 의 knowledge 제목·파일명이 된다 */
  file: string
  kind: "TASK" | "CHAT_DAY" | "IP_CASE" | "WEEKLY_REPORT" | "OMNIS_CARD"
  title: string
  /** 대표 소스 — CHAT_DAY 는 없다 */
  source?: string
  sourceId?: string
  messages: ManifestMessage[]
  chars: number
  /** ingest.ts 가 채운다 */
  knowledgeId?: string
}

export interface Manifest {
  exportedAt: string
  dbHost: string
  docs: ManifestDoc[]
}

const kst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "")
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()

/** 메시지 한 건 → Markdown 목록 줄. 여러 줄 본문은 들여쓴 이어 줄로 */
function messageLines(m: { createdAt: Date; author: { name: string }; content: string }, extra?: string): { text: string; probe: string } {
  const head = `[${kst(m.createdAt)}] ${m.author.name}:`
  const body = m.content.trim().split("\n").map((l) => l.trimEnd())
  const first = `- ${head} ${body[0] ?? ""}`
  const rest = body.slice(1).map((l) => `  ${l}`)
  if (extra) rest.push(`  (${extra})`)
  // 청크 경계가 줄 중간에 걸려도 대개 줄 앞머리는 한 청크에 온전히 든다. 앞머리 + 본문 첫 12자
  const probe = `${head} ${oneLine(body[0] ?? "").slice(0, 12)}`.trim()
  return { text: [first, ...rest].join("\n"), probe }
}

async function main() {
  const dir = corpusDir()
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) if (f.endsWith(".md")) unlinkSync(join(dir, f))

  const chunks = await prisma.embeddingChunk.findMany({ select: { source: true, sourceId: true, chunkIndex: true, title: true, content: true }, orderBy: [{ source: "asc" }, { sourceId: "asc" }, { chunkIndex: "asc" }] })
  const ids = (src: string) => [...new Set(chunks.filter((c) => c.source === src).map((c) => c.sourceId))]
  const taskIds = new Set(ids("TASK"))
  const chatIds = ids("CHAT_MESSAGE")

  const docs: ManifestDoc[] = []
  const write = (d: Omit<ManifestDoc, "chars">, body: string) => {
    writeFileSync(join(dir, d.file), body)
    docs.push({ ...d, chars: body.length })
  }

  // ── 채팅 (색인된 메시지만) ──
  const messages = await prisma.chatMessage.findMany({
    where: { id: { in: chatIds } },
    select: { id: true, content: true, createdAt: true, taskId: true, roomId: true, room: { select: { name: true } }, author: { select: { name: true } }, task: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  })
  const byTask = new Map<string, typeof messages>()
  const loose: typeof messages = []
  for (const m of messages) {
    if (m.taskId && taskIds.has(m.taskId)) byTask.set(m.taskId, [...(byTask.get(m.taskId) ?? []), m])
    else loose.push(m)
  }

  // ── 업무 ──
  const tasks = await prisma.task.findMany({
    where: { id: { in: [...taskIds] } },
    include: {
      project: { select: { name: true } },
      product: { select: { name: true } },
      instructor: { select: { name: true } },
      assignees: { select: { user: { select: { name: true } } } },
      checklists: { select: { name: true, done: true, memo: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  })
  const now = Date.now()
  for (const t of tasks) {
    const thread = byTask.get(t.id) ?? []
    const overdue = t.deadline && t.status !== "DONE" && t.deadline.getTime() < now
    const fields = [
      `- 상태: ${TASK_STATUS_LABELS[t.status] ?? t.status}`,
      `- 우선순위: ${PRIORITY_LABELS[t.priority] ?? t.priority}`,
      t.deadline ? `- 마감일: ${ymd(t.deadline)}${overdue ? " — 지연 (마감일이 지났으나 완료되지 않음)" : ""}` : "",
      t.workStart || t.workEnd ? `- 작업 기간: ${ymd(t.workStart)} ~ ${ymd(t.workEnd)}` : "",
      t.project?.name ? `- 프로젝트: ${t.project.name}` : "",
      t.product?.name ? `- 제품: ${t.product.name}` : "",
      `- 지시자: ${t.instructor.name}`,
      `- 담당자: ${t.assignees.map((a) => a.user.name).join(", ") || "(없음)"}`,
      `- 등록일: ${ymd(t.createdAt)}`,
    ].filter(Boolean)
    const lines = thread.map((m) => messageLines(m))
    const body = [
      `omnis:TASK:${t.id}`,
      `# [업무] ${t.name}`,
      "",
      ...fields,
      ...(t.background ? ["", "## 배경", t.background.trim()] : []),
      ...(t.expectedResult ? ["", "## 기대결과", t.expectedResult.trim()] : []),
      ...(t.checklists.length ? ["", "## 체크리스트", ...t.checklists.map((c) => `- [${c.done ? "x" : " "}] ${c.name}${c.memo ? ` — 메모: ${oneLine(c.memo)}` : ""}`)] : []),
      ...(lines.length ? ["", `## 채팅 스레드 (${lines.length}건, 시간순)`, ...lines.map((l) => l.text)] : []),
      "",
    ].join("\n")
    write({ file: `TASK-${t.id}.md`, kind: "TASK", title: t.name, source: "TASK", sourceId: t.id, messages: thread.map((m, i) => ({ id: m.id, probe: lines[i].probe })) }, body)
  }

  // 색인에는 있는데 Task 행이 없는 업무(지워진 업무의 남은 색인) — Omnis 검색에는 걸리므로 색인 청크 본문으로 문서를 만든다
  const found = new Set(tasks.map((t) => t.id))
  for (const sid of [...taskIds].filter((id) => !found.has(id))) {
    const cs = chunks.filter((c) => c.source === "TASK" && c.sourceId === sid)
    const thread = byTask.get(sid) ?? []
    const lines = thread.map((m) => messageLines(m))
    const body = [`omnis:TASK:${sid}`, `# ${cs[0].title}`, "", ...cs.map((c) => c.content.trim()), ...(lines.length ? ["", `## 채팅 스레드 (${lines.length}건, 시간순)`, ...lines.map((l) => l.text)] : []), ""].join("\n")
    write({ file: `TASK-${sid}.md`, kind: "TASK", title: cs[0].title, source: "TASK", sourceId: sid, messages: thread.map((m, i) => ({ id: m.id, probe: lines[i].probe })) }, body)
    console.log(`업무 ${sid}: Task 행 없음 — 색인 청크 본문으로 문서를 만듦`)
  }

  // ── 업무 밖 채팅: 방 × 날짜 ──
  const days = new Map<string, typeof messages>()
  for (const m of loose) {
    const k = `${m.roomId}|${kst(m.createdAt).slice(0, 10)}`
    days.set(k, [...(days.get(k) ?? []), m])
  }
  for (const [k, ms] of [...days.entries()].sort()) {
    const [roomId, day] = k.split("|")
    const room = ms[0].room.name
    const lines = ms.map((m) => messageLines(m, m.task?.name ? `관련 업무: ${m.task.name}` : undefined))
    const body = [`omnis:CHAT_DAY:${day}`, `# [채팅] ${room} · ${day} (${ms.length}건)`, "", ...lines.map((l) => l.text), ""].join("\n")
    write({ file: `CHAT-${day}-${roomId.slice(0, 8)}.md`, kind: "CHAT_DAY", title: `${room} ${day}`, messages: ms.map((m, i) => ({ id: m.id, probe: lines[i].probe })) }, body)
  }

  // ── 지식재산권 · 주간보고 · 옴니스 카드: 색인 청크 본문 그대로 ──
  for (const src of ["IP_CASE", "WEEKLY_REPORT", "OMNIS_CARD"] as const) {
    for (const sid of ids(src)) {
      const cs = chunks.filter((c) => c.source === src && c.sourceId === sid)
      const body = [`omnis:${src}:${sid}`, `# ${cs[0].title}`, "", ...cs.map((c) => c.content.trim()), ""].join("\n")
      const safe = sid.replace(/[^A-Za-z0-9_-]/g, "_")
      write({ file: `${src}-${safe}.md`, kind: src, title: cs[0].title, source: src, sourceId: sid, messages: [] }, body)
    }
  }

  const dbHost = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\?.*/, "")
  const manifest: Manifest = { exportedAt: new Date().toISOString(), dbHost, docs }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2))

  const count = (k: ManifestDoc["kind"]) => docs.filter((d) => d.kind === k).length
  const msgIn = (k: ManifestDoc["kind"]) => docs.filter((d) => d.kind === k).reduce((a, d) => a + d.messages.length, 0)
  const chars = docs.reduce((a, d) => a + d.chars, 0)
  console.log(`DB ${dbHost} → ${dir}`)
  console.log(`색인 소스: TASK ${taskIds.size} · CHAT_MESSAGE ${chatIds.length} · IP_CASE ${ids("IP_CASE").length} · WEEKLY_REPORT ${ids("WEEKLY_REPORT").length} · OMNIS_CARD ${ids("OMNIS_CARD").length}`)
  console.log(`문서 ${docs.length}: TASK ${count("TASK")} (메시지 ${msgIn("TASK")}) · CHAT_DAY ${count("CHAT_DAY")} (메시지 ${msgIn("CHAT_DAY")}) · IP_CASE ${count("IP_CASE")} · WEEKLY_REPORT ${count("WEEKLY_REPORT")} · OMNIS_CARD ${count("OMNIS_CARD")}`)
  console.log(`글자 ${chars.toLocaleString()} · 최대 문서 ${Math.max(...docs.map((d) => d.chars)).toLocaleString()}자`)
  const missing = chatIds.length - msgIn("TASK") - msgIn("CHAT_DAY")
  if (missing !== 0) console.log(`⚠ 색인 메시지 중 문서에 안 들어간 것 ${missing}건 (ChatMessage 행 없음)`)
  if (tasks.length !== taskIds.size) console.log(`색인 업무 중 Task 행이 없는 것 ${taskIds.size - tasks.length}건 — 색인 청크 본문으로 대신함`)
}

if (process.argv[1]?.endsWith("export.ts")) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
