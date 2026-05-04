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
const DEADLINE_RE = /(D-\d+|오늘|내일|\d{4}-\d{2}-\d{2})/

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

function resolveDeadline(label: string): Date | null {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  if (label === "오늘") return now
  if (label === "내일") {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return d
  }
  const dDay = label.match(/^D-(\d+)$/)
  if (dDay) {
    const d = new Date(now)
    d.setDate(d.getDate() + Number(dDay[1]))
    return d
  }
  const iso = label.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 59, 999)
  }
  return null
}

export function isTaskCommand(text: string): boolean {
  return text.trim().startsWith("/업무")
}
