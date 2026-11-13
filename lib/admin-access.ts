/**
 * 관리자 페이지(/admin) 권한 판정 — 순수 함수(시험: admin-access.test.ts). 세션을 읽는 쪽은 lib/admin-access-server.ts.
 *
 * - 화면: 관리자가 아니면 **404** — 관리자 화면이 있다는 것부터 보이지 않게 한다(로그인 안 했으면 (main) 셸이 /login 으로 보낸다)
 * - API: 로그인 안 했으면 401, 관리자가 아니면 403
 */
export type AdminSessionLike = { user?: { id?: string | null; role?: string | null } | null } | null | undefined

export const isAdminRole = (role: string | null | undefined) => role === "ADMIN"

export type AdminGate = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 404 }

export function adminGate(session: AdminSessionLike, kind: "page" | "api"): AdminGate {
  const userId = session?.user?.id
  const admin = !!userId && isAdminRole(session?.user?.role)
  if (admin) return { ok: true, userId }
  if (kind === "page") return { ok: false, status: 404 }
  return { ok: false, status: userId ? 403 : 401 }
}
