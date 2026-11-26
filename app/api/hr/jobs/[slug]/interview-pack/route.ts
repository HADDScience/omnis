import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { fileResponseHeaders } from "@/lib/file-serving"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { buildBundle, bundleFileName } from "@/lib/hr/interview-pack"
import { loadBundle, logPackDownload, packFonts, pdfStream } from "@/lib/hr/interview-pack-server"
import { loadJobMeta } from "@/lib/hr/job-meta-server"
import { metaLines } from "@/lib/hr/job-meta"

export const runtime = "nodejs"
export const maxDuration = 60

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * 공고 보드 「서류 합격」 열 전체의 면접자료 묶음 — 표지(공고 · 적어 둔 면접 일시 · 장소 · 방식 · 지원자와 시작 쪽) + 지원자별 자료, 지원자 · 문서 책갈피.
 * 채용 담당만. 즉석으로 만들고 저장하지 않는다. 묶음에 든 지원자마다 활동 기록이 남는다.
 */
export async function GET(_req: Request, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!(await isHrReviewer(session.user.id))) return NextResponse.json({ error: "채용 담당만 받을 수 있습니다" }, { status: 403 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked
  const { slug } = await params
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) return NextResponse.json({ error: "없는 공고입니다" }, { status: 404 })
  const loaded = await loadBundle(slug)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { inputs, jobTitle } = loaded.value
  const [fonts, meta] = await Promise.all([packFonts(), loadJobMeta(slug)])
  const pack = await buildBundle(inputs, jobTitle, fonts, new Date(), metaLines(meta))
  await logPackDownload(session.user.id, inputs.map((i) => i.applicant), slug)
  return new NextResponse(pdfStream(pack.bytes), {
    headers: {
      ...fileResponseHeaders({ mimeType: "application/pdf", name: bundleFileName(slug), attachment: true }),
      "Cache-Control": "no-store",
    },
  })
}
