import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import {
  STAFF_ASSET_MAX_BYTES,
  deleteStaffAsset,
  putStaffAsset,
  sniffImage,
  staffAssetKey,
} from "@/lib/staff-assets"
import { demoStorageBlocked } from "@/lib/demo"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ staffId: string }>
}

const KIND_LABEL = { SIGNATURE: "서명", SEAL: "직인" } as const
/** 이보다 좁으면 인쇄할 때 흐리게 나온다 — 막지는 않고 알려 준다 */
const SMALL_WIDTH = 300

/**
 * 서명 · 직인을 올리거나 바꾼다 — 관리자만. multipart: file(PNG · JPG), kind(SIGNATURE · SEAL).
 *
 * 같은 사람 · 같은 종류의 예전 이미지는 새 이미지가 저장된 뒤에 지운다(순서가 반대면 실패 때 둘 다 잃는다).
 * 누가 누구의 것을 바꿨는지 활동 기록에 남긴다 — 이미지 자체는 기록에 넣지 않는다.
 */
export async function POST(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if ((session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 서명·직인을 바꿀 수 있습니다" }, { status: 403 })
  }
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const { staffId } = await params
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId }, select: { id: true, name: true, employment: true } })
  if (!staff) return NextResponse.json({ error: "없는 사람입니다" }, { status: 404 })
  if (staff.employment !== "EMPLOYED") {
    return NextResponse.json({ error: "비재직자의 서명·직인은 보관하지 않습니다" }, { status: 400 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  const kind = form?.get("kind")
  if (!(file instanceof File)) return NextResponse.json({ error: "이미지 파일이 필요합니다" }, { status: 400 })
  if (kind !== "SIGNATURE" && kind !== "SEAL") return NextResponse.json({ error: "kind 는 SIGNATURE 또는 SEAL" }, { status: 400 })
  if (file.size > STAFF_ASSET_MAX_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다. ${STAFF_ASSET_MAX_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다` }, { status: 413 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const image = sniffImage(buf)
  if (!image) return NextResponse.json({ error: "PNG 또는 JPG 이미지만 올릴 수 있습니다" }, { status: 415 })

  const key = staffAssetKey(staff.id, kind, buf, image.ext)
  const previous = await prisma.staffAsset.findMany({
    where: { staffId: staff.id, kind },
    select: { id: true, objectKey: true, width: true, height: true },
  })
  if (previous.some((p) => p.objectKey === key)) {
    return NextResponse.json({ error: "지금 등록된 것과 같은 이미지입니다" }, { status: 409 })
  }

  try {
    await putStaffAsset(key, buf, image.mimeType)
  } catch (err) {
    console.error("[staff-assets] NAS 저장 실패", { staffId, err })
    return NextResponse.json({ error: "NAS 에 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요" }, { status: 502 })
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.staffAsset.create({
      data: {
        staffId: staff.id,
        kind,
        objectKey: key,
        fileName: file.name.slice(0, 200) || `${KIND_LABEL[kind]}.${image.ext}`,
        mimeType: image.mimeType,
        size: buf.length,
        width: image.width,
        height: image.height,
      },
    })
    if (previous.length) await tx.staffAsset.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } })
    return row
  })

  // 예전 파일은 기록을 바꾼 뒤에 지운다. 실패해도 새 이미지는 이미 쓰이고 있다 — 남은 파일은 로그로 알린다
  for (const p of previous) {
    await deleteStaffAsset(p.objectKey).catch((err) => console.error("[staff-assets] 예전 파일 삭제 실패", { key: p.objectKey, err }))
  }

  const dims = (w: number | null, h: number | null) => (w && h ? `${w}×${h}` : "크기 모름")
  const label = KIND_LABEL[kind]
  await writeActivity({
    userId: session.user.id,
    action: previous.length ? "staff.asset.replaced" : "staff.asset.uploaded",
    entity: "STAFF_ASSET",
    entityId: created.id,
    title: previous.length
      ? `${label} 교체: ${staff.name} (${dims(previous[0].width, previous[0].height)} → ${dims(image.width, image.height)})`
      : `${label} 등록: ${staff.name} (${dims(image.width, image.height)})`,
    metadata: { staffId: staff.id, kind, width: image.width, height: image.height, replaced: previous.length },
  })

  return NextResponse.json(
    {
      id: created.id,
      width: image.width,
      height: image.height,
      replaced: previous.length,
      small: image.width !== null && image.width < SMALL_WIDTH,
    },
    { status: 201 }
  )
}
