import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { fileResponseHeaders } from "@/lib/file-serving"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { buildApplicantPack, packFileName } from "@/lib/hr/interview-pack"
import { loadApplicantPack, logPackDownload, packFonts, pdfStream } from "@/lib/hr/interview-pack-server"

export const runtime = "nodejs"
export const maxDuration = 60

interface Props {
  params: Promise<{ id: string }>
}

/**
 * 지원자 한 명의 면접자료 PDF — 지원서 요약 1쪽 + 이력서 + 포트폴리오, 책갈피. 채용 담당만, 서류 합격(INTERVIEW · OFFERED) · 최종 합격만.
 * 즉석으로 만들고 저장하지 않는다(no-store). 받을 때마다 활동 기록에 남는다.
 */
export async function GET(_req: Request, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!(await isHrReviewer(session.user.id))) return NextResponse.json({ error: "채용 담당만 받을 수 있습니다" }, { status: 403 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked
  const { id } = await params
  const loaded = await loadApplicantPack(id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { input, jobTitle } = loaded.value
  const pack = await buildApplicantPack(input, jobTitle, await packFonts())
  await logPackDownload(session.user.id, [input.applicant], null)
  return new NextResponse(pdfStream(pack.bytes), {
    headers: {
      ...fileResponseHeaders({ mimeType: "application/pdf", name: packFileName(input.applicant), attachment: true }),
      "Cache-Control": "no-store",
    },
  })
}
