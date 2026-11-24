import { NextResponse } from "next/server"
import { Readable } from "node:stream"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { demoStorageBlocked } from "@/lib/demo"
import { fileResponseHeaders } from "@/lib/file-serving"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { SLOT_DB, SLOT_LABEL, parseSlot } from "@/lib/hr/rules"
import { getApplicationFile } from "@/lib/hr/storage"

interface Props {
  params: Promise<{ id: string; slot: string }>
}

/**
 * 지원서 파일 내려받기 — 채용 담당만. 내려받을 때마다 누가 · 언제 · 어느 지원서의 것을 활동 기록에 남긴다.
 * 캐시하지 않는다(no-store) — 캐시되면 두 번째부터 기록이 빠진다. 미리보기도 띄우지 않는다(서명 · 직인과 같은 까닭).
 * AI 도구로는 열지 않는다(결정 D8 — 파일 · 연락처 · 지원 동기는 AI 에 보내지 않는다).
 */
export async function GET(_req: Request, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!(await isHrReviewer(session.user.id))) return NextResponse.json({ error: "채용 담당만 볼 수 있습니다" }, { status: 403 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const { id, slot: raw } = await params
  const slot = parseSlot(raw)
  if (!slot) return NextResponse.json({ error: "없는 파일입니다" }, { status: 404 })
  const file = await prisma.jobApplicationFile.findUnique({
    where: { applicationId_slot: { applicationId: id, slot: SLOT_DB[slot] } },
    select: { objectKey: true, fileName: true, deletedAt: true, application: { select: { code: true, stage: true, purgedAt: true } } },
  })
  if (!file || file.deletedAt || file.application.purgedAt || file.application.stage === "RECEIVING") {
    return NextResponse.json({ error: "없는 파일입니다" }, { status: 404 })
  }

  let object
  try {
    object = await getApplicationFile(file.objectKey)
  } catch (err) {
    console.error("[hr] NAS 읽기 실패", id, slot, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "시놀로지에서 파일을 읽지 못했습니다" }, { status: 502 })
  }

  const label = SLOT_LABEL[SLOT_DB[slot]]
  await writeActivity({
    userId: session.user.id,
    action: "hr.application.file_downloaded",
    entity: "job_application",
    entityId: id,
    title: `지원서 ${label} 내려받기: ${file.application.code ?? id}`,
    metadata: { slot },
  })
  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      ...fileResponseHeaders({ mimeType: "application/pdf", name: `${file.application.code ?? "지원서"}_${label}.pdf`, attachment: true }),
      "Cache-Control": "no-store",
    },
  })
}
