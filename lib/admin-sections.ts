/** 관리자 페이지(/admin)의 메뉴 — 사용자 · 운영 · 비용·사용량 · 기록 */
export const ADMIN_SECTIONS = [
  { href: "/admin/users", label: "사용자", short: "사용자" },
  { href: "/admin/operations", label: "운영", short: "운영" },
  { href: "/admin/usage", label: "비용·사용량", short: "비용" },
  { href: "/admin/audit", label: "기록", short: "기록" },
] as const

export const ADMIN_HOME = ADMIN_SECTIONS[0].href
