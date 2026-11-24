import { receivePart } from "@/lib/hr/intake"
import { PART_BYTES, allowedOrigins, parseSlot } from "@/lib/hr/rules"
import { json, UUID } from "@/lib/hr/http"
import { demoStorageBlocked } from "@/lib/demo"

/**
 * ③ 파일 조각 — 지원자 브라우저가 바로 보낸다(Authorization: Ticket <티켓>). 함수 본문 한도(4.5MB) 때문에 4MB 이하 조각으로 나눠 받아
 * NAS 에 이어 쓴다(lib/storage.ts putRangeAt). 쿠키를 쓰지 않으므로 CORS 는 허용 오리진에만 열고 자격증명은 받지 않는다.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin")
  if (!origin || !allowedOrigins(process.env.WEBSITE_CAREER_ORIGINS).includes(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; slot: string }> }) {
  const headers = cors(req)
  // 데모에는 NAS 가 없다 — 홈페이지가 메일 되돌림으로 떨어지게 계약의 503 으로 답한다
  if (demoStorageBlocked()) return json({ error: "nas_unavailable" }, 503, headers)
  const { id, slot: slotRaw } = await params
  const slot = parseSlot(slotRaw)
  if (!UUID.test(id) || !slot) return json({ error: "not_found" }, 404, headers)
  const ticket = (req.headers.get("authorization") ?? "").replace(/^Ticket\s+/i, "").trim()
  if (!ticket) return json({ error: "bad_ticket" }, 401, headers)
  const part = Number(new URL(req.url).searchParams.get("part"))
  // 본문을 읽기 전에 크기부터 — 큰 본문은 플랫폼이 먼저 자르지만, 로컬 · 다른 호스트에서도 같게
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > PART_BYTES) return json({ error: "bad_part", detail: "조각이 너무 큽니다" }, 400, headers)
  const body = Buffer.from(await req.arrayBuffer())
  if (body.length > PART_BYTES) return json({ error: "bad_part", detail: "조각이 너무 큽니다" }, 400, headers)
  try {
    const r = await receivePart({ applicationId: id, slot, part, ticket, body })
    return json(r.body, r.status, headers)
  } catch (e) {
    console.error("[hr] 조각 받기 실패", id, slot, e instanceof Error ? e.message : e)
    return json({ error: "unavailable" }, 503, headers)
  }
}
