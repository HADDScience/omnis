// 지식재산권 건의 이미지 — DB 쪽. 규칙은 lib/ip-images.ts(순수).
// 표는 ip.case_images(raw SQL — ip 스키마는 Prisma 시야 밖이다, lib/ip-data.ts 머리말).
// 실물은 기존 첨부 File(NAS · R2)이다. 여기서 파일을 지우지 않는다 — 연결만 걸고 푼다.

import { prisma } from "@/lib/db"
import { withActor, type EntityKind } from "@/lib/ip-data"
import { IMAGES_PER_CASE_MAX, isImageMime, sortImages, type CaseImage } from "@/lib/ip-images"

type Row = {
  id: string
  entity_kind: string
  entity_id: string
  file_id: string
  name: string
  mime_type: string
  memo: string
  taken_on: Date | string | null
  is_primary: boolean
  created_at: Date
}

const ymd = (v: Date | string | null): string | null =>
  v === null ? null : typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10)

const toImage = (r: Row): CaseImage => ({
  id: r.id,
  entityKind: r.entity_kind as EntityKind,
  entityId: r.entity_id,
  fileId: r.file_id,
  name: r.name,
  mimeType: r.mime_type,
  memo: r.memo,
  date: ymd(r.taken_on),
  isPrimary: r.is_primary,
  createdAt: r.created_at.toISOString(),
})

/** 전부 — 화면 스냅샷용. 백여 건 × 몇 장이라 한 번에 읽는다 */
export async function listCaseImages(): Promise<CaseImage[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT i.id::text, i.entity_kind, i.entity_id, i.file_id, f.name, f."mimeType" AS mime_type,
           i.memo, i.taken_on, i.is_primary, i.created_at
      FROM ip.case_images i
      JOIN public."File" f ON f.id = i.file_id
     ORDER BY i.entity_kind, i.entity_id, i.created_at`
  return rows.map(toImage)
}

/** 한 건의 이미지 — 대표가 맨 앞 */
export async function listImagesFor(kind: EntityKind, id: string): Promise<CaseImage[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT i.id::text, i.entity_kind, i.entity_id, i.file_id, f.name, f."mimeType" AS mime_type,
           i.memo, i.taken_on, i.is_primary, i.created_at
      FROM ip.case_images i
      JOIN public."File" f ON f.id = i.file_id
     WHERE i.entity_kind = ${kind} AND i.entity_id = ${id}`
  return sortImages(rows.map(toImage))
}

export async function caseExists(kind: EntityKind, id: string): Promise<boolean> {
  const rows =
    kind === "trademark"
      ? await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM ip.trademarks WHERE id = ${id}`
      : await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM ip.patents WHERE id = ${id}`
  return rows.length > 0
}

export class ImageError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export interface NewImage {
  kind: EntityKind
  entityId: string
  fileId: string
  memo: string
  date: string | null
  /** 생략하면 그 건의 첫 이미지만 대표가 된다 */
  isPrimary?: boolean
}

/**
 * 이미 올린 파일(POST /api/files · MCP upload_file)을 건에 건다.
 * 참여자만 보는 방의 파일(privateToUserId)은 받지 않는다 — 지식재산권 화면은 구성원 모두가 본다.
 */
export async function addCaseImage(userId: string, input: NewImage): Promise<CaseImage> {
  if (!(await caseExists(input.kind, input.entityId))) {
    throw new ImageError(404, `${input.entityId} 는 지식재산권 목록에 없습니다`)
  }
  const file = await prisma.file.findUnique({
    where: { id: input.fileId },
    select: { id: true, mimeType: true, privateToUserId: true },
  })
  if (!file) throw new ImageError(404, "파일을 찾을 수 없습니다 — 다시 올려 주세요")
  if (file.privateToUserId !== null) {
    throw new ImageError(409, "참여자만 보는 방(옴니스 1:1 · 단톡방)에 올린 파일은 걸 수 없습니다 — IP 화면에서 올리거나 upload_file 로 다시 올려 주세요")
  }
  if (!isImageMime(file.mimeType)) throw new ImageError(415, "PNG · JPG · WebP · GIF 이미지만 걸 수 있습니다")

  const id = await withActor(userId, async (tx) => {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM ip.case_images WHERE entity_kind = ${input.kind} AND entity_id = ${input.entityId}`
    if (Number(n) >= IMAGES_PER_CASE_MAX) throw new ImageError(409, `한 건에 이미지는 ${IMAGES_PER_CASE_MAX}장까지입니다`)
    const dup = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM ip.case_images
       WHERE entity_kind = ${input.kind} AND entity_id = ${input.entityId} AND file_id = ${input.fileId}`
    if (dup.length > 0) throw new ImageError(409, "이미 이 건에 걸린 이미지입니다")

    const primary = input.isPrimary ?? Number(n) === 0
    if (primary) {
      await tx.$executeRaw`
        UPDATE ip.case_images SET is_primary = false
         WHERE entity_kind = ${input.kind} AND entity_id = ${input.entityId} AND is_primary`
    }
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO ip.case_images (entity_kind, entity_id, file_id, memo, taken_on, is_primary, created_by)
      VALUES (${input.kind}, ${input.entityId}, ${input.fileId}, ${input.memo}, ${input.date}::date, ${primary}, ${userId})
      RETURNING id::text`
    return row.id
  })
  const created = (await listImagesFor(input.kind, input.entityId)).find((i) => i.id === id)
  if (!created) throw new ImageError(500, "이미지를 걸었지만 다시 읽지 못했습니다")
  return created
}

async function findImage(id: string): Promise<{ kind: EntityKind; entityId: string; isPrimary: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const rows = await prisma.$queryRaw<{ entity_kind: string; entity_id: string; is_primary: boolean }[]>`
    SELECT entity_kind, entity_id, is_primary FROM ip.case_images WHERE id = ${id}::uuid`
  const r = rows[0]
  return r ? { kind: r.entity_kind as EntityKind, entityId: r.entity_id, isPrimary: r.is_primary } : null
}

/** 메모 · 날짜 고치기, 대표로 정하기. 대표를 끄면 그 건은 대표 없이 최근 이미지가 표지가 된다 */
export async function updateCaseImage(
  userId: string,
  id: string,
  patch: { memo?: string; date?: string | null; isPrimary?: boolean }
): Promise<CaseImage> {
  const found = await findImage(id)
  if (!found) throw new ImageError(404, "이미지를 찾을 수 없습니다")
  await withActor(userId, async (tx) => {
    if (patch.isPrimary === true) {
      await tx.$executeRaw`
        UPDATE ip.case_images SET is_primary = false
         WHERE entity_kind = ${found.kind} AND entity_id = ${found.entityId} AND is_primary AND id <> ${id}::uuid`
    }
    if (patch.memo !== undefined) await tx.$executeRaw`UPDATE ip.case_images SET memo = ${patch.memo} WHERE id = ${id}::uuid`
    if (patch.date !== undefined) await tx.$executeRaw`UPDATE ip.case_images SET taken_on = ${patch.date}::date WHERE id = ${id}::uuid`
    if (patch.isPrimary !== undefined) await tx.$executeRaw`UPDATE ip.case_images SET is_primary = ${patch.isPrimary} WHERE id = ${id}::uuid`
  })
  const updated = (await listImagesFor(found.kind, found.entityId)).find((i) => i.id === id)
  if (!updated) throw new ImageError(404, "이미지를 찾을 수 없습니다")
  return updated
}

/** 건에서 뗀다. 파일은 남긴다(다른 데 쓰였을 수 있다). 대표였으면 남은 것 중 최근 것이 대표가 된다 */
export async function removeCaseImage(userId: string, id: string): Promise<void> {
  const found = await findImage(id)
  if (!found) throw new ImageError(404, "이미지를 찾을 수 없습니다")
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`DELETE FROM ip.case_images WHERE id = ${id}::uuid`
    if (found.isPrimary) {
      await tx.$executeRaw`
        UPDATE ip.case_images SET is_primary = true
         WHERE id = (SELECT id FROM ip.case_images
                      WHERE entity_kind = ${found.kind} AND entity_id = ${found.entityId}
                      ORDER BY coalesce(taken_on, created_at::date) DESC, created_at DESC LIMIT 1)`
    }
  })
}
