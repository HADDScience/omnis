import { NextResponse } from "next/server"
import { Readable } from "node:stream"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getObject } from "@/lib/storage"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ invoiceId: string }>
}

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" }

/** 올린 세금계산서 원본(NAS)을 연다 */
export async function GET(_req: Request, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { invoiceId } = await params
  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { objectKey: true, fileName: true } })
  if (!inv?.objectKey) return NextResponse.json({ error: "원본 파일이 없습니다" }, { status: 404 })

  let object
  try {
    object = await getObject(inv.objectKey)
  } catch (err) {
    console.error("[crm/invoices/file] NAS 읽기 실패", { invoiceId, err })
    return NextResponse.json({ error: "NAS 에서 파일을 읽지 못했습니다" }, { status: 502 })
  }
  const ext = inv.objectKey.split(".").pop() ?? ""
  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(inv.fileName ?? `세금계산서.${ext}`)}`,
      "Cache-Control": "private, max-age=300",
    },
  })
}
