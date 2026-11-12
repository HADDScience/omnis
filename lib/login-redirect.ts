import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { RETURN_HEADER, loginPath } from "@/lib/login-return"

/**
 * 로그인 화면으로 보낸다 — 원래 주소(프록시가 RETURN_HEADER 에 실어 둔 것)를 callbackUrl 로 싣는다.
 * 쿠키가 없으면 프록시가 먼저 307 로 보내므로, 여기는 쿠키는 있지만 세션이 끝난 경우의 길이다.
 */
export async function redirectToLogin(): Promise<never> {
  const h = await headers()
  redirect(loginPath(h.get(RETURN_HEADER)))
}
