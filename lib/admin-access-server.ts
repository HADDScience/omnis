import { notFound } from "next/navigation"

import { apiError } from "./api"
import { auth } from "./auth"
import { adminGate, type AdminSessionLike } from "./admin-access"

/** /admin 화면 — 관리자가 아니면 404. 관리자면 그 사람 id */
export async function requireAdminPage(): Promise<string> {
  const gate = adminGate((await auth()) as AdminSessionLike, "page")
  if (!gate.ok) notFound()
  return gate.userId
}

/** /api/admin — 로그인 안 했으면 401, 관리자가 아니면 403 */
export async function requireAdminApi(): Promise<{ userId: string } | { fail: Response }> {
  const gate = adminGate((await auth()) as AdminSessionLike, "api")
  if (gate.ok) return { userId: gate.userId }
  return { fail: apiError(gate.status, gate.status === 401 ? "인증 필요" : "관리자만 볼 수 있습니다") }
}
