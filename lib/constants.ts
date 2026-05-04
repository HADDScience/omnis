// ─── 업무 상태 ───────────────────────────────────────────

export const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "할 일",
  IN_PROGRESS: "진행 중",
  REVIEW: "리뷰",
  DONE: "완료",
}

export const TASK_STATUS_COLORS: Record<string, string> = {
  TODO: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-primary/15 text-primary dark:bg-primary/20",
  REVIEW: "bg-[var(--color-warn)]/15 text-[var(--color-warn)] dark:bg-[var(--color-warn)]/20",
  DONE: "bg-[var(--color-success)]/15 text-[var(--color-success)] dark:bg-[var(--color-success)]/20",
}

// ─── 우선순위 ────────────────────────────────────────────

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "☆☆☆",
  NORMAL: "★★☆",
  HIGH: "★★★",
}

// ─── 역할 ────────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "관리자",
  MEMBER: "팀원",
}

// ─── 주간보고 상태 ───────────────────────────────────────

export const REPORT_STATUS = {
  DRAFT: "작성 중",
  SUBMITTED: "제출 완료",
} as const

// ─── 네비게이션 ──────────────────────────────────────────

export const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: "Dashboard02Icon" },
  { href: "/chat", label: "채팅", icon: "MessageMultiple01Icon" },
  { href: "/tasks", label: "업무", icon: "Task01Icon" },
  { href: "/reports", label: "주간보고", icon: "FileTextIcon" },
  { href: "/omnis", label: "HADD DB", icon: "BookOpen01Icon" },
  { href: "/settings", label: "설정", icon: "Settings02Icon" },
] as const
