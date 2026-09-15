// 채팅 · 업무 스레드 메시지 목록의 배치 규칙. 화면 두 곳(채팅 패널 · 업무 스레드)이 같은 규칙을 쓴다.
//
// 참고한 것 (2026-09-15 조사):
//   - 같은 사람이 짧은 간격으로 이어 보내면 이름 · 아바타를 한 번만 — Discord 는 첫 메시지부터 7~8분, Slack 도 묶고 시간은 hover
//   - 날짜는 줄마다 쓰지 않고 날이 바뀔 때 구분선 한 줄
//   - 한글 본문은 어절 단위 줄바꿈(keep-all) · 행간 150% 이상
// 순수 함수만 둔다 — 서버 · 클라이언트 · 테스트가 같이 쓴다.

/** 이어 보낸 메시지로 묶는 간격. 묶음 첫 메시지 기준이라 한 묶음이 한없이 길어지지 않는다 */
export const GROUP_WINDOW_MS = 5 * 60 * 1000

export interface LayoutMessage {
  id: string
  createdAt: string
  author: { id: string }
  /** 사람이 쓴 메시지만 묶는다. 업무 생성 · 완료 같은 사건은 따로 그린다 */
  isEvent?: boolean
}

export type LayoutRow<M> =
  | { type: "day"; key: string; label: string }
  | { type: "message"; key: string; message: M; groupStart: boolean; groupEnd: boolean }

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** 날짜 구분선 · 묶음 시작/끝을 붙인 줄 목록 */
export function layoutMessages<M extends LayoutMessage>(messages: M[], now = new Date()): LayoutRow<M>[] {
  const rows: LayoutRow<M>[] = []
  let prevDay = ""
  let groupAuthor: string | null = null
  let groupStartAt = 0

  messages.forEach((m, i) => {
    const at = new Date(m.createdAt)
    const day = dayKey(at)
    if (day !== prevDay) {
      rows.push({ type: "day", key: `day-${day}-${m.id}`, label: dayLabel(at, now) })
      prevDay = day
      groupAuthor = null
    }

    const joins =
      !m.isEvent && groupAuthor === m.author.id && at.getTime() - groupStartAt <= GROUP_WINDOW_MS
    if (!joins) {
      groupAuthor = m.isEvent ? null : m.author.id
      groupStartAt = at.getTime()
    }

    const next = messages[i + 1]
    const nextAt = next ? new Date(next.createdAt) : null
    const nextJoins =
      !!next &&
      !next.isEvent &&
      !m.isEvent &&
      next.author.id === m.author.id &&
      dayKey(nextAt!) === day &&
      nextAt!.getTime() - groupStartAt <= GROUP_WINDOW_MS

    rows.push({ type: "message", key: m.id, message: m, groupStart: !joins, groupEnd: !nextJoins })
  })
  return rows
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"]

/** 오늘 · 어제 · 9월 14일 (일) · 해가 다르면 2025년 9월 14일 (일) */
export function dayLabel(d: Date, now = new Date()): string {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diff === 0) return "오늘"
  if (diff === 1) return "어제"
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}

/** 오후 2:08 — 줄 머리에 쓰는 짧은 시간 */
export function timeLabel(d: Date): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, "0")
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${m}`
}

/** 2026년 9월 14일 (일) 오후 2:08 — hover 로 보여 줄 전체 시각 */
export function fullTimeLabel(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]}) ${timeLabel(d)}`
}

/** 빈 줄이 여러 개 이어지면 하나로. 앞뒤 빈 줄은 없앤다 */
export function tidyBody(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

// 이름마다 늘 같은 색 — 한 글자 아바타만으로는 누가 누군지 구분이 안 된다
const AVATAR_TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200",
] as const

export function avatarTone(key: string): string {
  // FNV-1a — `h*31+c` 는 한글 음절(코드포인트가 촘촘)에서 8로 나눈 나머지가 몰려 팀장 · 부팀장 · 사원1 이 한 색이 됐다
  let h = 0x811c9dc5
  for (const ch of key) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // `^` 결과는 부호 있는 32비트라 음수가 될 수 있다 — 부호 없이 바꾼 뒤 나눈다
  return AVATAR_TONES[((h ^ (h >>> 16)) >>> 0) % AVATAR_TONES.length]
}

/** 아바타 글자 — 한글 이름은 성을 뺀 두 글자(허채정 → 채정), 그 밖은 첫 글자 */
export function avatarText(name: string): string {
  const n = name.trim()
  if (/^[가-힣]{3,4}$/.test(n)) return n.slice(1, 3)
  return n.charAt(0).toUpperCase()
}
