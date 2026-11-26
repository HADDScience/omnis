import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { updateJobMeta } from "@/lib/hr/job-meta-server"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * 공고별 면접 정보(일시 · 장소 · 방식 · 화상 링크 · 메모) 고치기 — 채용 담당만. 공고 보드 머리의 제자리 편집이 칸 하나씩 부른다.
 * 화면은 고치기 전에 본 값을 expect 로 붙인다 — 그새 그 칸이 바뀌었으면 409. 도구(update_job_posting)는 expect 없이 같은 함수를 부른다.
 */
export async function PATCH(req: Request, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!(await isHrReviewer(session.user.id))) return NextResponse.json({ error: "채용 담당만 고칠 수 있습니다" }, { status: 403 })
  const { slug } = await params
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "값이 올바르지 않습니다" }, { status: 400 })
  const { expect, ...body } = raw
  const r = await updateJobMeta(session.user.id, slug, body, expect)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ meta: r.meta, changed: r.changed }, { headers: { "cache-control": "no-store" } })
}
