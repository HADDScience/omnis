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

// ─── 채팅 ────────────────────────────────────────────────

/** 채팅 메시지 페이지 크기 — 초기 로드 및 무한 스크롤 1페이지 단위 */
export const CHAT_PAGE_SIZE = 30

/**
 * 지운 글이 목록에서 차지하는 자리. 본문 대신 이 문장만 내려보낸다.
 * 행은 DB 에 그대로 있다 — 답장이 가리키는 글 · 업무 연결 · 색인이 함께 사라지지 않게(2026-09-16).
 */
export const CHAT_DELETED_TEXT = "삭제된 메시지입니다"

// ─── 파일 ────────────────────────────────────────────────

/**
 * 한 파일의 업로드 상한. 파일은 Vercel 함수를 거쳐 NAS 로 가는데, Vercel 은 4.5MB 가 넘는 요청 본문을
 * 함수에 닿기 전에 413 으로 끊는다 — 서버 로그에도 남지 않는다. 그래서 화면이 고를 때 먼저 막는다.
 * 서버 라우트는 lib/storage 가 다시 내보내는 같은 값을 쓴다(storage 는 node:tls 를 써 화면이 못 읽는다).
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

// ─── 네비게이션 ──────────────────────────────────────────

export const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: "Dashboard02Icon" },
  { href: "/chat", label: "채팅", icon: "MessageMultiple01Icon" },
  { href: "/tasks", label: "업무", icon: "Task01Icon" },
  { href: "/reports", label: "주간보고", icon: "FileTextIcon" },
  { href: "/omnis", label: "HADD DB", icon: "BookOpen01Icon" },
  { href: "/settings", label: "설정", icon: "Settings02Icon" },
] as const
