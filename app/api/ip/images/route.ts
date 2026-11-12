import { NextRequest } from "next/server"

import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"
import { checkImageInput } from "@/lib/ip-images"
import {
  addCaseImage,
  ImageError,
  listImagesFor,
  removeCaseImage,
  updateCaseImage,
} from "@/lib/ip-images-server"
import type { EntityKind } from "@/lib/ip-data"

/**
 * 지식재산권 건의 이미지(상표 도안 · 로고 · 시안, 특허 대표 도면).
 * 파일은 먼저 POST /api/files 로 올리고, 받은 id 를 여기서 건에 건다 — 실물 저장 경로(NAS · R2)를 따로 두지 않는다.
 */
export const dynamic = "force-dynamic"

const isKind = (v: unknown): v is EntityKind => v === "trademark" || v === "patent"

function fail(err: unknown, cors: Record<string, string>) {
  if (err instanceof ImageError) return bad(err.message, cors, err.status)
  console.error("[ip/images]", err)
  return bad("이미지를 저장하지 못했습니다", cors, 500)
}

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

/** 한 건의 이미지 — ?kind=trademark&id=TM-13 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response
  const kind = req.nextUrl.searchParams.get("kind")
  const id = req.nextUrl.searchParams.get("id")?.trim()
  if (!isKind(kind) || !id) return bad("kind·id 가 필요합니다", auth.cors)
  return ok({ images: await listImagesFor(kind, id) }, auth.cors)
}

/** 올린 파일을 건에 건다 */
export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response
  const input = await body<{ kind?: unknown; entityId?: unknown; fileId?: unknown; memo?: unknown; date?: unknown; isPrimary?: unknown }>(req)
  if (!input || !isKind(input.kind) || typeof input.entityId !== "string" || typeof input.fileId !== "string") {
    return bad("kind·entityId·fileId 가 필요합니다", auth.cors)
  }
  const checked = checkImageInput(input)
  if (!checked.ok) return bad(checked.error, auth.cors)
  try {
    const image = await addCaseImage(auth.caller.userId, {
      kind: input.kind,
      entityId: input.entityId.trim(),
      fileId: input.fileId.trim(),
      memo: checked.value.memo ?? "",
      date: checked.value.date ?? null,
      isPrimary: checked.value.isPrimary,
    })
    return ok({ image }, auth.cors)
  } catch (err) {
    return fail(err, auth.cors)
  }
}

/** 메모 · 날짜 · 대표 고치기 */
export async function PATCH(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response
  const input = await body<{ id?: unknown; memo?: unknown; date?: unknown; isPrimary?: unknown }>(req)
  if (!input || typeof input.id !== "string") return bad("id 가 필요합니다", auth.cors)
  const checked = checkImageInput(input)
  if (!checked.ok) return bad(checked.error, auth.cors)
  try {
    return ok({ image: await updateCaseImage(auth.caller.userId, input.id, checked.value) }, auth.cors)
  } catch (err) {
    return fail(err, auth.cors)
  }
}

/** 건에서 떼기 — ?id=… 파일 자체는 남는다 */
export async function DELETE(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response
  const id = req.nextUrl.searchParams.get("id")?.trim()
  if (!id) return bad("id 가 필요합니다", auth.cors)
  try {
    await removeCaseImage(auth.caller.userId, id)
    return ok({ ok: true }, auth.cors)
  } catch (err) {
    return fail(err, auth.cors)
  }
}
