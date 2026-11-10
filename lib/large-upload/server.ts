// 큰 첨부 — 세션 열기 · 토큰 · 완료 · 읽기 · 크론 점검. 복사는 ./workflow.ts · ./steps.ts
import { randomUUID } from "node:crypto"
import { del, head, list } from "@vercel/blob"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getRun, start } from "workflow/api"
import { ATTACH_MAX_BYTES, MAX_UPLOAD_BYTES } from "@/lib/constants"
import { prisma } from "@/lib/db"
import { nasReachable } from "@/lib/storage"
import {
  ATTACH_MAX_MB,
  blobPathnameFor,
  COPY_SEGMENT_BYTES,
  ORPHAN_BLOB_MS,
  sanitizeUploadName,
  SESSION_TTL_MS,
  STALE_TRANSFER_MS,
  UPLOAD_PART_BYTES,
} from "./rules"
import { alertTransfer } from "./alert"
import { signUploadSession, type UploadSession } from "./session"
import { copyToNasWorkflow } from "./workflow"

const MiB = 1024 * 1024
/** Hobby 의 Blob 포함량이 1GB 라 그 아래에서 멈춘다. Pro 로 올리면 값만 올린다 */
const TEMP_CAP_BYTES = Number(process.env.LARGE_UPLOAD_TEMP_CAP_MB || 700) * MiB
const MONTHLY_CAP_BYTES = Number(process.env.LARGE_UPLOAD_MONTHLY_CAP_MB || 20_480) * MiB
const TOKEN_TTL_MS = 3_600_000
/** Blob CDN 캐시. 함수로만 읽으므로 노출이 늘지 않고, 복사 때 다시 읽어 오는 일이 준다 */
const CACHE_MAX_AGE_SECONDS = 3_600

export function largeUploadEnabled(): boolean {
  return process.env.LARGE_UPLOAD_ENABLED === "1"
}

function blobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN 이 없습니다")
  return token
}

export type OpenSessionResult =
  | { ok: true; session: string; pathname: string; partBytes: number; token: string }
  | { ok: false; status: number; error: string }

/** 저장 합계 · 월 합계 — 세션을 열 때 한 번 센다. 올리는 중인 파일은 행이 없어 세지 않는다 */
async function capRefusal(size: number): Promise<string | null> {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3_600_000)
  const monthStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3_600_000)
  const [stored, monthly] = await Promise.all([
    prisma.file.aggregate({ _sum: { size: true }, where: { transfer: { blobDeletedAt: null } } }),
    prisma.file.aggregate({ _sum: { size: true }, where: { transfer: { uploadedAt: { gte: monthStart } } } }),
  ])
  if ((stored._sum.size ?? 0) + size > TEMP_CAP_BYTES) return "NAS 로 옮기는 중인 파일이 많아 지금은 큰 파일을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요."
  if ((monthly._sum.size ?? 0) + size > MONTHLY_CAP_BYTES) return "이번 달 큰 첨부 한도를 다 썼습니다. 시놀로지에 올린 뒤 「시놀로지 파일 연결」 로 첨부해 주세요."
  return null
}

function callbackUrl(origin: string): string | undefined {
  // 로컬은 임시 저장소가 닿지 못한다. 완료 요청 쪽으로 끝난다
  return origin.startsWith("https://") ? `${origin}/api/uploads/webhook` : undefined
}

export function clientTokenFor(session: UploadSession, sessionToken: string, origin: string): Promise<string> {
  const url = callbackUrl(origin)
  return generateClientTokenFromReadWriteToken({
    token: blobToken(),
    pathname: blobPathnameFor(session.fileId),
    maximumSizeInBytes: ATTACH_MAX_BYTES,
    validUntil: Date.now() + TOKEN_TTL_MS,
    addRandomSuffix: false,
    cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
    ...(url ? { onUploadCompleted: { callbackUrl: url, tokenPayload: sessionToken } } : {}),
  })
}

export async function openUploadSession(input: {
  userId: string
  name: string
  size: number
  mimeType: string
  isPrivate: boolean
  origin: string
}): Promise<OpenSessionResult> {
  if (input.size <= MAX_UPLOAD_BYTES) return { ok: false, status: 400, error: "작은 파일은 일반 첨부로 올립니다" }
  if (input.size > ATTACH_MAX_BYTES) return { ok: false, status: 413, error: `파일이 너무 큽니다. ${ATTACH_MAX_MB}MB 이하만 올릴 수 있습니다.` }
  const refusal = await capRefusal(input.size)
  if (refusal) return { ok: false, status: 429, error: refusal }

  const session: UploadSession = {
    fileId: randomUUID(),
    userId: input.userId,
    name: sanitizeUploadName(input.name),
    size: input.size,
    mimeType: input.mimeType || "application/octet-stream",
    isPrivate: input.isPrivate,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  const sessionToken = signUploadSession(session)
  return {
    ok: true,
    session: sessionToken,
    pathname: blobPathnameFor(session.fileId),
    partBytes: UPLOAD_PART_BYTES,
    token: await clientTokenFor(session, sessionToken, input.origin),
  }
}

export type FinalizeResult =
  | { ok: true; file: { id: string; name: string; path: string; size: number; mimeType: string } }
  | { ok: false; status: number; error: string }

/**
 * 올리기가 끝났다 — 크기를 대조하고 파일 행을 만든 뒤 복사를 시작한다. 사용자에게는 여기서 완료다.
 * 화면과 Blob 웹훅이 둘 다 부를 수 있다. 행을 먼저 만든 쪽만 복사를 시작한다.
 */
export async function finalizeUpload(session: UploadSession): Promise<FinalizeResult> {
  const pathname = blobPathnameFor(session.fileId)
  const fileData = { id: session.fileId, name: session.name, path: `/api/files/${session.fileId}/raw`, size: session.size, mimeType: session.mimeType }

  const existing = await prisma.file.findUnique({ where: { id: session.fileId }, select: { id: true } })
  if (existing) return { ok: true, file: fileData }

  const blob = await head(pathname, { token: blobToken() }).catch(() => null)
  if (!blob) return { ok: false, status: 409, error: "임시 저장소에서 파일을 찾지 못했습니다" }
  if (blob.size !== session.size) {
    // 고른 파일과 크기가 다르면 무엇이 올라갔는지 모른다. 행이 없으니 지워도 잃을 것이 없다
    await del(pathname, { token: blobToken() }).catch(() => {})
    return { ok: false, status: 422, error: "올라간 크기가 파일과 다릅니다. 다시 올려 주세요." }
  }

  try {
    await prisma.file.create({
      data: {
        ...fileData,
        privateToUserId: session.isPrivate ? session.userId : null,
        transfer: { create: { blobPathname: pathname, segmentSize: COPY_SEGMENT_BYTES } },
      },
    })
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: true, file: fileData } // 웹훅과 완료 요청이 겹쳤다
    throw e
  }
  await startCopy(session.fileId)
  return { ok: true, file: fileData }
}

/** 시작하지 못해도 사용자의 완료를 막지 않는다 — 임시본은 그대로 있고, 크론이 다시 시작한다 */
async function startCopy(fileId: string) {
  try {
    const run = await start(copyToNasWorkflow, [fileId])
    await prisma.fileTransfer.update({ where: { fileId }, data: { runId: run.runId } })
  } catch (e) {
    console.error("[large-upload] 복사 시작 실패", fileId, e)
  }
}

/** 매일 크론 — 멈춘 전송을 다시 시작하고, 행 없는 임시본을 지우고, 실패를 다시 알린다 */
export async function runTransferUpkeep(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_TRANSFER_MS)
  const stale = await prisma.fileTransfer.findMany({
    where: { state: { in: ["UPLOADED", "COPYING", "WAITING_NAS", "VERIFIED"] }, updatedAt: { lt: staleBefore } },
    select: { fileId: true, runId: true, uploadedAt: true, attempts: true },
    take: 20,
  })
  let restarted = 0
  // NAS 가 꺼져 있으면 다시 시작해도 또 기다릴 뿐이다
  if (stale.length > 0 && (await nasReachable())) {
    for (const t of stale) {
      if (t.runId) await getRun(t.runId).cancel().catch(() => {})
      await prisma.fileTransfer.update({ where: { fileId: t.fileId }, data: { attempts: { increment: 1 } } })
      await startCopy(t.fileId)
      restarted++
      if (now.getTime() - t.uploadedAt.getTime() > 3 * 86_400_000) await alertTransfer(t.fileId, "사흘 넘게 복사가 끝나지 않았습니다")
    }
  }

  const failed = await prisma.fileTransfer.findMany({
    where: { state: "FAILED", OR: [{ notifiedAt: null }, { notifiedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } }] },
    select: { fileId: true, lastError: true },
    take: 20,
  })
  for (const t of failed) await alertTransfer(t.fileId, `복사 실패 상태가 이어지고 있습니다 (${t.lastError ?? "사유 없음"})`)

  // 행 없는 임시본 — 올리다 버린 파일. 행이 있는 것은 어떤 상태든 여기서 지우지 않는다
  let removedOrphans = 0
  let cursor: string | undefined
  do {
    const page = await list({ prefix: "uploads/", token: blobToken(), cursor, limit: 500 })
    const old = page.blobs.filter((b) => now.getTime() - b.uploadedAt.getTime() > ORPHAN_BLOB_MS)
    if (old.length > 0) {
      const ids = old.map((b) => b.pathname.split("/")[1])
      const known = new Set((await prisma.fileTransfer.findMany({ where: { fileId: { in: ids } }, select: { fileId: true } })).map((t) => t.fileId))
      const orphans = old.filter((b) => !known.has(b.pathname.split("/")[1]))
      if (orphans.length > 0) {
        await del(orphans.map((b) => b.url), { token: blobToken() })
        removedOrphans += orphans.length
      }
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  return { stale: stale.length, restarted, failed: failed.length, removedOrphans }
}
