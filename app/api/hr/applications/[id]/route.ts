import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { changeApplicationStage } from "@/lib/hr/stage"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ id: string }>
}

/**
 * 지원서 단계 바꾸기 — 채용 담당만(지원서함과 같은 권한). 지원서함 보드에서 카드를 옮기거나 카드 메뉴로 부른다.
 * 지원자에게 메일을 보내지 않는다. 이벤트(JobApplicationEvent)와 활동 기록에 남는다(lib/hr/stage.ts).
 */
export async function PATCH(req: Request, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!(await isHrReviewer(session.user.id))) return NextResponse.json({ error: "채용 담당만 바꿀 수 있습니다" }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { stage?: unknown; note?: unknown } | null
  const r = await changeApplicationStage(session.user.id, id, body?.stage, {
    note: typeof body?.note === "string" ? body.note : undefined,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ id: r.id, code: r.code, from: r.from, to: r.to }, { headers: { "cache-control": "no-store" } })
}
