import { addDays, addWeeks, addMonths, endOfWeek, endOfMonth } from "date-fns"

export interface ParsedTaskCommand {
  raw: string
  title: string | null
  ownerName: string | null
  deadlineLabel: string | null
  deadline: Date | null
  projectName: string | null
}

const USER_RE = /@([A-Za-z0-9가-힣_]+)/
const PROJECT_RE = /#([A-Za-z0-9가-힣_-]+)/
// "이번주까지"처럼 뒤에 "까지"가 붙어도 핵심 표현(그룹 1)만 추출
const DEADLINE_RE =
  /(D-\d+|오늘|내일|모레|이번\s?주|다음\s?주|차주|이번\s?달|다음\s?달|\d{4}-\d{2}-\d{2})(?:까지)?/

/**
 * 쓸 수 있는 슬래시 명령 목록.
 *
 * 명령이 있어도 아무 데도 적혀 있지 않으면 없는 것과 같다.
 * "/"를 치면 이 목록이 그대로 떠서, 외우지 않아도 눈에 보이게 한다.
 * 새 명령을 추가할 때는 여기에만 넣으면 입력창 자동완성에 자동으로 나온다.
 */
export interface SlashCommand {
  /** 명령어 본체 (슬래시 포함) */
  name: string
  /** 한 줄 설명 */
  description: string
  /** 입력 예시 */
  example: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/업무",
    description: "업무 카드 만들기 — 담당자·마감·체크리스트를 AI가 채웁니다",
    example: "/업무 @우창 이번주까지 판넬 최종본 정리",
  },
]

export function parseSlashTask(raw: string): ParsedTaskCommand | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("/업무")) return null

  let body = trimmed.slice("/업무".length).trim()

  const ownerMatch = body.match(USER_RE)
  const ownerName = ownerMatch?.[1] ?? null
  if (ownerMatch) body = body.replace(ownerMatch[0], " ").trim()

  const projectMatch = body.match(PROJECT_RE)
  const projectName = projectMatch?.[1] ?? null
  if (projectMatch) body = body.replace(projectMatch[0], " ").trim()

  const deadlineMatch = body.match(DEADLINE_RE)
  const deadlineLabel = deadlineMatch?.[1] ?? null
  let deadline: Date | null = null
  if (deadlineLabel) {
    body = body.replace(deadlineMatch![0], " ").trim()
    deadline = resolveDeadline(deadlineLabel)
  }

  const title = body.replace(/\s+/g, " ").trim() || null

  return {
    raw: trimmed,
    title,
    ownerName,
    deadlineLabel,
    deadline,
    projectName,
  }
}

/**
 * 한국어 상대 마감일 표현을 실제 날짜로 변환한다.
 * "오늘"·"내일"·"모레"·"이번 주"·"다음 주"·"이번 달"·"다음 달"·"D-N"·ISO(YYYY-MM-DD) 지원.
 * 슬래시 명령 파싱과 AI 자동완성(deadlineHint)에서 공용으로 쓰인다.
 */
export function resolveDeadline(label: string): Date | null {
  const base = new Date()
  base.setHours(23, 59, 59, 999)
  const key = label.replace(/\s+/g, "")

  switch (key) {
    case "오늘":
      return base
    case "내일":
      return addDays(base, 1)
    case "모레":
      return addDays(base, 2)
    case "이번주":
      return endOfWeek(base, { weekStartsOn: 1 })
    case "다음주":
    case "차주":
      return endOfWeek(addWeeks(base, 1), { weekStartsOn: 1 })
    case "이번달":
      return endOfMonth(base)
    case "다음달":
      return endOfMonth(addMonths(base, 1))
  }

  const dDay = key.match(/^D-(\d+)$/)
  if (dDay) return addDays(base, Number(dDay[1]))

  const iso = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 59, 999)
  }
  return null
}

export function isTaskCommand(text: string): boolean {
  return text.trim().startsWith("/업무")
}
