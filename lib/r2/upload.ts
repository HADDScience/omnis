// R2 큰 첨부 — 세션 열기 · 조각 서명 · 남은 조각 · 버리기 · 완료. 라우트: app/api/uploads/*
// 권한 · 크기 · 참여자 전용(privateToUserId) 규칙은 #158 과 같다 — 다른 것은 바이트가 가는 곳뿐이다.
import { randomUUID } from "node:crypto"
import { ATTACH_MAX_BYTES, MAX_UPLOAD_BYTES } from "@/lib/constants"
import { prisma } from "@/lib/db"
import { ATTACH_MAX_MB, blobPathnameFor, partCount, sanitizeUploadName, SESSION_TTL_MS, UPLOAD_PART_BYTES } from "@/lib/large-upload/rules"
import { signUploadSession, type UploadSession } from "@/lib/large-upload/session"
import { missingParts, partsProblem, r2StorageCapBytes, signablePartNumbers } from "./rules"
import { abortUpload, completeUpload, createUpload, deleteR2Object, listUploadedParts, objectSize, r2Bucket, signPartUrls } from "./server"

const MiB = 1024 * 1024
const MONTHLY_CAP_BYTES = () => Number(process.env.LARGE_UPLOAD_MONTHLY_CAP_MB || 20_480) * MiB

type Fail = { ok: false; status: number; error: string }

/** 이 세션의 저장 키. 파일 이름을 넣지 않는다 — 버킷 목록 · 로그에 이름이 남지 않게(#158 과 같은 모양) */
export const r2KeyOf = (session: Pick<UploadSession, "fileId">) => blobPathnameFor(session.fileId)

async function capRefusal(size: number): Promise<string | null> {
  const kst = new Date(Date.now() + 9 * 3_600_000)
  const monthStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3_600_000)
  const [stored, monthly, monthlyBlob] = await Promise.all([
    prisma.file.aggregate({ _sum: { size: true }, where: { r2Object: { isNot: null } } }),
    prisma.file.aggregate({ _sum: { size: true }, where: { r2Object: { uploadedAt: { gte: monthStart } } } }),
    prisma.file.aggregate({ _sum: { size: true }, where: { transfer: { uploadedAt: { gte: monthStart } } } }),
  ])
  if ((stored._sum.size ?? 0) + size > r2StorageCapBytes()) return "큰 첨부 저장 한도를 다 썼습니다. 관리자에게 알려 주세요."
  if ((monthly._sum.size ?? 0) + (monthlyBlob._sum.size ?? 0) + size > MONTHLY_CAP_BYTES())
    return "이번 달 큰 첨부 한도를 다 썼습니다. 시놀로지에 올린 뒤 「시놀로지 파일 연결」 로 첨부해 주세요."
  return null
}

export type OpenR2Result = { ok: true; backend: "r2"; session: string; pathname: string; partBytes: number } | Fail

export async function openR2Session(input: { userId: string; name: string; size: number; mimeType: string; isPrivate: boolean }): Promise<OpenR2Result> {
  if (input.size <= MAX_UPLOAD_BYTES) return { ok: false, status: 400, error: "작은 파일은 일반 첨부로 올립니다" }
  if (input.size > ATTACH_MAX_BYTES) return { ok: false, status: 413, error: `파일이 너무 큽니다. ${ATTACH_MAX_MB}MB 이하만 올릴 수 있습니다.` }
  const refusal = await capRefusal(input.size)
  if (refusal) return { ok: false, status: 429, error: refusal }

  const fileId = randomUUID()
  const key = blobPathnameFor(fileId)
  const uploadId = await createUpload(key)
  const session: UploadSession = {
    fileId,
    userId: input.userId,
    name: sanitizeUploadName(input.name),
    size: input.size,
    mimeType: input.mimeType || "application/octet-stream",
    isPrivate: input.isPrivate,
    expiresAt: Date.now() + SESSION_TTL_MS,
    r2UploadId: uploadId,
  }
  return { ok: true, backend: "r2", session: signUploadSession(session), pathname: key, partBytes: UPLOAD_PART_BYTES }
}

/** 조각 PUT 서명 — 이 세션이 가진 업로드 번호에만, 파일 안의 조각 번호에만 */
export async function signR2Parts(session: UploadSession, parts: unknown): Promise<{ ok: true; urls: Record<number, string> } | Fail> {
  if (!session.r2UploadId) return { ok: false, status: 410, error: "이어 올릴 수 없습니다. 처음부터 다시 올려 주세요." }
  const numbers = signablePartNumbers(parts, session.size, UPLOAD_PART_BYTES)
  if (!numbers) return { ok: false, status: 400, error: "조각 번호가 맞지 않습니다" }
  return { ok: true, urls: await signPartUrls(r2KeyOf(session), session.r2UploadId, numbers) }
}

/** 새로 고친 뒤 · 끊긴 뒤 — 저장소에 남은 조각과 아직 보낼 조각. 업로드가 사라졌으면 410(처음부터) */
export async function r2UploadState(session: UploadSession): Promise<{ ok: true; done: number[]; missing: number[] } | Fail> {
  if (!session.r2UploadId) return { ok: false, status: 410, error: "이어 올릴 수 없습니다. 처음부터 다시 올려 주세요." }
  const parts = await listUploadedParts(r2KeyOf(session), session.r2UploadId)
  if (!parts) return { ok: false, status: 410, error: "올리던 조각이 저장소에서 지워졌습니다. 처음부터 다시 올려 주세요." }
  const missing = missingParts(parts, session.size, UPLOAD_PART_BYTES)
  const done = Array.from({ length: partCount(session.size, UPLOAD_PART_BYTES) }, (_, i) => i + 1).filter((n) => !missing.includes(n))
  return { ok: true, done, missing }
}

export async function abortR2Upload(session: UploadSession): Promise<void> {
  if (!session.r2UploadId) return
  // 이미 첨부가 됐으면 업로드 번호는 끝난 것이다 — 아무것도 지우지 않는다
  if (await prisma.file.findUnique({ where: { id: session.fileId }, select: { id: true } })) return
  await abortUpload(r2KeyOf(session), session.r2UploadId)
}

export type FinalizeR2Result = { ok: true; file: { id: string; name: string; path: string; size: number; mimeType: string } } | Fail

/**
 * 다 올렸다 — 저장소의 조각을 서버가 직접 세어 보고 합친다(화면이 준 조각 목록은 믿지 않는다). 그다음 크기를 대조하고 파일 행을 만든다.
 * 같은 세션으로 다시 불러도 같은 파일을 돌려준다(합치기 응답을 못 받은 화면이 다시 부른다).
 */
export async function finalizeR2Upload(session: UploadSession): Promise<FinalizeR2Result> {
  if (!session.r2UploadId) return { ok: false, status: 410, error: "세션이 만료되었습니다. 다시 올려 주세요." }
  const key = r2KeyOf(session)
  const fileData = { id: session.fileId, name: session.name, path: `/api/files/${session.fileId}/raw`, size: session.size, mimeType: session.mimeType }
  if (await prisma.file.findUnique({ where: { id: session.fileId }, select: { id: true } })) return { ok: true, file: fileData }

  let size = await objectSize(key)
  let etag: string | null = null
  if (size === null) {
    const parts = await listUploadedParts(key, session.r2UploadId)
    if (!parts) return { ok: false, status: 409, error: "저장소에서 파일을 찾지 못했습니다" }
    const problem = partsProblem(parts, session.size, UPLOAD_PART_BYTES)
    if (problem) return { ok: false, status: 409, error: `아직 다 올라가지 않았습니다 (${problem})` }
    etag = await completeUpload(key, session.r2UploadId, parts)
    size = await objectSize(key)
  }
  if (size !== session.size) {
    // 고른 파일과 크기가 다르면 무엇이 올라갔는지 모른다. 행이 없으니 지워도 잃을 것이 없다
    await deleteR2Object(key).catch(() => {})
    return { ok: false, status: 422, error: "올라간 크기가 파일과 다릅니다. 다시 올려 주세요." }
  }

  try {
    await prisma.file.create({
      data: {
        ...fileData,
        privateToUserId: session.isPrivate ? session.userId : null,
        r2Object: { create: { bucket: r2Bucket(), key, etag, partBytes: UPLOAD_PART_BYTES, partCount: partCount(session.size, UPLOAD_PART_BYTES) } },
      },
    })
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: true, file: fileData } // 같은 세션의 완료 요청이 겹쳤다
    throw e
  }
  return { ok: true, file: fileData }
}
