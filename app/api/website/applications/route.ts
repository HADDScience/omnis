import { openApplication } from "@/lib/hr/intake"
import { json, serverGate } from "@/lib/hr/http"

/**
 * ② 지원서 열기 — 홈페이지 app/api/career/apply 의 deliver() 가 부른다(서버 간).
 * 응답의 uploads(조각 주소 · 티켓)를 홈페이지가 그대로 브라우저에 넘긴다.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const fail = serverGate(req)
  if (fail) return fail
  const body = await req.json().catch(() => null)
  try {
    const r = await openApplication(body, new URL(req.url).origin)
    return json(r.body, r.status)
  } catch (e) {
    // DB 가 죽어도 500 을 내지 않는다 — 홈페이지는 503 에 메일 되돌림을 띄운다
    console.error("[hr] 지원서 열기 실패", e instanceof Error ? e.message : e)
    return json({ error: "unavailable" }, 503)
  }
}
