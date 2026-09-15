import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { getStaffAsset } from "@/lib/staff-assets"
import { demoStorageBlocked } from "@/lib/demo"

interface Props {
  params: Promise<{ assetId: string }>
}

const KIND_LABEL = { SIGNATURE: "서명", SEAL: "직인" } as const

/**
 * 서명 · 직인 이미지를 꺼낸다. 과제 대리 작성 때 한글에 붙여 넣으려고 쓴다.
 *
 * - 관리자만. 인력 화면도 관리자만 연다.
 * - `purpose` 가 있어야 한다(copy · download). 꺼낼 때마다 누가 · 언제 · 누구의 것을 활동 로그에 남긴다 —
 *   나중에 「이 제출 서류에 누구 서명이 쓰였나」 를 되짚을 수 있어야 해서.
 * - 목록 화면에 미리보기를 띄우지 않는다. 띄우면 열 때마다 로그가 쌓이거나, 로그 없이 이미지가 나간다.
 * - 캐시하지 않는다(no-store). 캐시되면 두 번째부터 로그가 빠진다.
 *
 * 설계: mydocs/plans/2026-09-14-company-context.md 「인력 — 대리 작성과 서명」
 */
export async function GET(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if ((session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 서명·직인을 꺼낼 수 있습니다" }, { status: 403 })
  }
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const purpose = req.nextUrl.searchParams.get("purpose")
  if (purpose !== "copy" && purpose !== "download") {
    return NextResponse.json({ error: "purpose 는 copy 또는 download" }, { status: 400 })
  }

  const { assetId } = await params
  const asset = await prisma.staffAsset.findUnique({
    where: { id: assetId },
    select: { id: true, kind: true, objectKey: true, mimeType: true, staff: { select: { id: true, name: true } } },
  })
  if (!asset) return NextResponse.json({ error: "없는 이미지입니다" }, { status: 404 })

  let object
  try {
    object = await getStaffAsset(asset.objectKey)
  } catch (err) {
    console.error("[staff-assets] NAS 읽기 실패", { assetId, err })
    return NextResponse.json({ error: "NAS 에서 이미지를 읽지 못했습니다" }, { status: 502 })
  }

  const label = KIND_LABEL[asset.kind]
  await writeActivity({
    userId: session.user.id,
    action: purpose === "copy" ? "staff.asset.copied" : "staff.asset.downloaded",
    entity: "STAFF_ASSET",
    entityId: asset.id,
    title: `${label} ${purpose === "copy" ? "복사" : "내려받기"}: ${asset.staff.name}`,
    metadata: { staffId: asset.staff.id, kind: asset.kind },
  })

  const fileName = `${asset.staff.name}_${label}.${asset.mimeType === "image/jpeg" ? "jpg" : "png"}`
  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Disposition": `${purpose === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  })
}
