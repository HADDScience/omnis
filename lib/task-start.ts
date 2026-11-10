/**
 * 「Omnis 와 함께 업무 시작하기」 — 업무를 옴니스 새 대화에 넘기는 첫 글과, 그 글을 한 번만 보내게 하는 일회용 표.
 * 순수 함수(buildTaskStartPrompt · 저장 형식) — 시험: task-start.test.ts
 *
 * 첫 글은 사람이 읽기 좋은 짧은 문장 + 업무 참조(#슬러그 · ID)다. 옴니스는 #슬러그로 get_task 를 불러 원문 · 체크리스트 · 최근 대화를
 * 직접 읽는다(lib/agent/prompt.ts) — 그래서 배경 · 기대 결과는 짧게 잘라 넣고, 남은 체크리스트도 앞 몇 개만 적는다.
 *
 * 넘기는 길: 업무 화면에서 확인하면 sessionStorage 에 { 글, 보냈나 } 를 일회용 키로 적고, 옴니스 방이 그 키를 받아
 * **보내기 전에** 보냈다고 적은 뒤 보낸다. 더블탭 · 뒤로 가기 뒤 다시 들어와도 같은 키는 다시 보내지 않는다.
 * 보내다 실패하면 옴니스 방이 입력칸에 글을 남긴다(omnis-room ask) — 손으로 다시 보내면 된다.
 */

export interface TaskStartInput {
  id: string
  slug: string
  name: string
  background?: string | null
  expectedResult?: string | null
  /** 아직 안 끝난 체크리스트 이름 */
  openChecklist: string[]
}

const CLIP = 160
const MAX_ITEMS = 8

function clip(text: string | null | undefined, max = CLIP): string | null {
  const t = text?.replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function buildTaskStartPrompt(t: TaskStartInput): string {
  const lines = [
    `#${t.slug} 「${t.name}」 업무를 지금부터 함께 진행하자. 먼저 남은 체크리스트를 기준으로 다음 할 일을 제안해 줘.`,
    "",
    `- 업무: #${t.slug} (ID ${t.id})`,
  ]
  const bg = clip(t.background)
  if (bg) lines.push(`- 배경: ${bg}`)
  const exp = clip(t.expectedResult)
  if (exp) lines.push(`- 기대 결과: ${exp}`)
  const open = t.openChecklist.map((n) => clip(n, 80)).filter((n): n is string => !!n)
  if (open.length === 0) lines.push("- 남은 체크리스트: 없음")
  else {
    lines.push(`- 남은 체크리스트 ${open.length}개:`)
    for (const n of open.slice(0, MAX_ITEMS)) lines.push(`  - ${n}`)
    if (open.length > MAX_ITEMS) lines.push(`  - 그 밖 ${open.length - MAX_ITEMS}개(get_task 로 확인)`)
  }
  return lines.join("\n")
}

// ─── 일회용 표 ─────────────────────────────────────────────

export const TASK_START_PARAM = "start"
const PREFIX = "omnis:task-start:"
/** 넘긴 뒤 이 시간이 지나면 받지 않는다 — 오래된 탭이 뒤늦게 보내지 않게 */
export const TASK_START_TTL_MS = 10 * 60_000

export interface TaskStartEntry {
  text: string
  taskId: string
  at: number
  sent: boolean
}

export function taskStartStorageKey(key: string): string {
  return `${PREFIX}${key}`
}

/** 읽은 값을 확인한다. 모양이 틀리면 null */
export function parseTaskStartEntry(raw: string | null): TaskStartEntry | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<TaskStartEntry>
    if (typeof v.text !== "string" || typeof v.taskId !== "string" || typeof v.at !== "number" || typeof v.sent !== "boolean") return null
    return { text: v.text, taskId: v.taskId, at: v.at, sent: v.sent }
  } catch {
    return null
  }
}

/** 이 표로 지금 보낼 것인가 — 있고 · 아직 안 보냈고 · 오래되지 않았을 때만 */
export function shouldSendTaskStart(entry: TaskStartEntry | null, now: number): boolean {
  return !!entry && !entry.sent && now - entry.at <= TASK_START_TTL_MS && entry.text.trim().length >= 2
}

/** 브라우저 — 표를 적고 키를 돌려준다. 저장소를 못 쓰면 null(그때는 넘기지 못한다) */
export function queueTaskStart(taskId: string, text: string): string | null {
  const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    const entry: TaskStartEntry = { text, taskId, at: Date.now(), sent: false }
    window.sessionStorage.setItem(taskStartStorageKey(key), JSON.stringify(entry))
    return key
  } catch {
    return null
  }
}

/**
 * 브라우저 — 보낼 글을 꺼내며 **보냈다고 먼저 적는다**. 이미 보냈거나 없거나 오래됐으면 null.
 * 같은 키로 두 번 불러도(StrictMode · 다시 들어오기) 한 번만 글을 준다
 */
export function claimTaskStart(key: string, now = Date.now()): string | null {
  try {
    const storageKey = taskStartStorageKey(key)
    const entry = parseTaskStartEntry(window.sessionStorage.getItem(storageKey))
    if (!entry || !shouldSendTaskStart(entry, now)) return null
    window.sessionStorage.setItem(storageKey, JSON.stringify({ ...entry, sent: true }))
    return entry.text
  } catch {
    return null
  }
}
