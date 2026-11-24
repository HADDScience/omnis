import { completeApplication } from "@/lib/hr/intake"
import { json, serverGate, UUID } from "@/lib/hr/http"

/** ⑤ 접수 확정 — 홈페이지 app/api/career/apply/complete 가 브라우저 대신 부른다(서버 간). 다시 불러도 결과가 같다 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const fail = serverGate(req)
  if (fail) return fail
  const { id } = await params
  if (!UUID.test(id)) return json({ error: "not_found" }, 404)
  try {
    const r = await completeApplication(id)
    return json(r.body, r.status)
  } catch (e) {
    console.error("[hr] 접수 확정 실패", id, e instanceof Error ? e.message : e)
    return json({ error: "unavailable" }, 503)
  }
}
