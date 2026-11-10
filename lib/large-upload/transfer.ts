// 복사 단계의 본문 — 저장소 · DB 를 만지는 쪽. Workflow 에서는 ./steps.ts 로 부른다.
// 임시본을 지우는 곳은 deleteTemp 하나뿐이다. 판단은 ./copy-rules.ts (시험: copy-rules.test.ts)
import { Readable } from "node:stream"
import { del, get } from "@vercel/blob"
import { prisma } from "@/lib/db"
import { getObjectRange, objectKeyFor, putObjectRange, statObjectSize } from "@/lib/storage"
import { alertTransfer } from "./alert"
import type { CopyResult } from "./copy-loop"
import { copyOneSegment, verifyBeforeDelete } from "./copy-rules"
import { COPY_CONCURRENCY, segmentCount, segmentRange } from "./rules"

export type { CopyResult } from "./copy-loop"

async function collect(body: Readable, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const c of body) {
    const chunk = Buffer.from(c as Uint8Array)
    total += chunk.length
    // 범위를 무시하고 전체를 주면 메모리에 올리지 않고 끊는다
    if (total > limit) {
      body.destroy()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readBlobRange(pathname: string, start: number, length: number): Promise<Buffer | "missing" | null> {
  const res = await get(pathname, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN, headers: { Range: `bytes=${start}-${start + length - 1}` } })
  if (!res?.stream) return "missing"
  const buf = await collect(Readable.fromWeb(res.stream as Parameters<typeof Readable.fromWeb>[0]), length)
  return buf && buf.length === length ? buf : null
}

async function readNasRange(key: string, start: number, length: number): Promise<Buffer | null> {
  const res = await getObjectRange(key, start, length)
  if (res.status !== 206) {
    res.body.resume()
    return null
  }
  const buf = await collect(res.body, length)
  return buf && buf.length === length ? buf : null
}

async function loadRow(fileId: string) {
  return prisma.fileTransfer.findUnique({
    where: { fileId },
    select: {
      state: true, blobPathname: true, segmentSize: true, segmentsDone: true, manifestSha256: true,
      file: { select: { id: true, name: true, size: true } },
    },
  })
}

export async function loadCopyPlan(fileId: string) {
  const row = await loadRow(fileId)
  if (!row) return null
  return {
    state: row.state as string,
    segments: segmentCount(row.file.size, row.segmentSize),
    segmentsDone: row.segmentsDone,
    manifestSha256: row.manifestSha256,
  }
}

/**
 * 복사 자리를 잡는다 — 전체 동시 2개. 한 문장으로 세고 바꿔 자리 다툼을 줄인다.
 * 15분 넘게 소식 없는 COPYING 은 세지 않는다(실행이 사라졌을 수 있다).
 */
export async function claimCopySlot(fileId: string): Promise<"ok" | "busy" | "stop"> {
  const updated = await prisma.$executeRaw`
    UPDATE "FileTransfer" SET "state" = 'COPYING', "updatedAt" = now()
    WHERE "fileId" = ${fileId}
      AND ("state" = 'COPYING' OR (
        "state" IN ('UPLOADED', 'WAITING_NAS')
        AND (SELECT count(*) FROM "FileTransfer" WHERE "state" = 'COPYING' AND "updatedAt" > now() - interval '15 minutes') < ${COPY_CONCURRENCY}
      ))`
  if (updated > 0) return "ok"
  const row = await prisma.fileTransfer.findUnique({ where: { fileId }, select: { state: true } })
  return row && (row.state === "UPLOADED" || row.state === "WAITING_NAS") ? "busy" : "stop"
}

/** 한 단계: 임시본 범위 읽기 → 해시 → NAS 쓰기 → NAS 되읽기 → 해시 대조. 같은 범위를 다시 해도 결과가 같다 */
export async function copySegment(fileId: string, index: number, previousManifest: string | null): Promise<CopyResult> {
  const row = await loadRow(fileId)
  if (!row) return { kind: "blob_missing" }
  const { start, length } = segmentRange(index, row.file.size, row.segmentSize)
  const key = objectKeyFor(row.file.id, row.file.name)
  return copyOneSegment(
    {
      readTemp: () => readBlobRange(row.blobPathname, start, length),
      writeNas: (body) => putObjectRange(key, body, start, row.file.size),
      readNas: () => readNasRange(key, start, length),
    },
    previousManifest,
  )
}

export async function recordProgress(fileId: string, segmentsDone: number, manifest: string | null) {
  await prisma.fileTransfer.updateMany({ where: { fileId, segmentsDone: { lte: segmentsDone } }, data: { segmentsDone, manifestSha256: manifest } })
}

export async function markWaiting(fileId: string, segmentsDone: number, manifest: string | null, reason: string) {
  await prisma.fileTransfer.updateMany({
    where: { fileId, state: { in: ["UPLOADED", "COPYING"] } },
    data: { state: "WAITING_NAS", segmentsDone, manifestSha256: manifest, lastError: reason },
  })
}

export async function verifyWholeSize(fileId: string): Promise<{ ok: boolean; expected: number; actual: number | null }> {
  const row = await loadRow(fileId)
  if (!row) return { ok: false, expected: 0, actual: null }
  const actual = await statObjectSize(objectKeyFor(row.file.id, row.file.name))
  return { ok: actual === row.file.size, expected: row.file.size, actual }
}

/** 모든 조각의 되읽기와 전체 크기가 맞을 때만 부른다. 이 순간부터 읽기는 NAS 로 간다 */
export async function markVerified(fileId: string, segmentsDone: number, manifest: string | null) {
  await prisma.fileTransfer.updateMany({
    where: { fileId, state: { in: ["COPYING", "WAITING_NAS"] } },
    data: { state: "VERIFIED", segmentsDone, manifestSha256: manifest, verifiedAt: new Date(), lastError: null },
  })
}

export async function failTransfer(fileId: string, reason: string) {
  await prisma.fileTransfer.updateMany({ where: { fileId, state: { not: "TEMP_DELETED" } }, data: { state: "FAILED", lastError: reason } })
  await alertTransfer(fileId, reason)
}

/**
 * 임시본을 지운다. VERIFIED 일 때만, 그리고 크기 · 표본 범위를 임시본과 한 번 더 대조한 뒤에.
 * 대조가 틀리면 지우지 않고 FAILED 로 둔다 — 읽기가 임시본으로 돌아간다.
 */
export async function deleteTemp(fileId: string): Promise<"TEMP_DELETED" | "FAILED" | "SKIPPED" | "retry"> {
  const row = await loadRow(fileId)
  if (!row || row.state !== "VERIFIED") return "SKIPPED"

  const key = objectKeyFor(row.file.id, row.file.name)
  const check = await verifyBeforeDelete(
    {
      statNas: () => statObjectSize(key),
      readTemp: (start, length) => readBlobRange(row.blobPathname, start, length),
      readNas: (start, length) => readNasRange(key, start, length),
    },
    row.file.size,
  )
  if (check.kind === "retry") return "retry"
  if (check.kind === "bad") {
    await prisma.fileTransfer.updateMany({ where: { fileId, state: "VERIFIED" }, data: { state: "FAILED", lastError: check.reason } })
    await alertTransfer(fileId, check.reason)
    return "FAILED"
  }

  await del(row.blobPathname, { token: process.env.BLOB_READ_WRITE_TOKEN })
  await prisma.fileTransfer.updateMany({ where: { fileId, state: "VERIFIED" }, data: { state: "TEMP_DELETED", blobDeletedAt: new Date() } })
  return "TEMP_DELETED"
}
