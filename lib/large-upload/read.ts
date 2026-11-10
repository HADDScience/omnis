// 큰 첨부 읽기 — lib/file-object.ts 가 부른다. 이 파일은 Workflow 를 끌어오지 않는다(카톡 이식 같은 스크립트도 file-object 를 쓴다)
import { Readable } from "node:stream"
import { get } from "@vercel/blob"
import { prisma } from "@/lib/db"
import type { DavResponse } from "@/lib/storage"
import type { ByteRange } from "./rules"

/** 표가 아직 없는 운영(마이그레이션 전)에서는 지금처럼 NAS 파일로 읽는다 */
export async function findTransfer(fileId: string) {
  try {
    return await prisma.fileTransfer.findUnique({ where: { fileId }, select: { state: true, blobPathname: true } })
  } catch (e) {
    if ((e as { code?: string }).code === "P2021") return null
    throw e
  }
}

/** 임시본을 연다. 브라우저에 주소를 주지 않는다 — 권한은 /raw 의 findVisibleFile 이 이미 봤다 */
export async function openTempObject(pathname: string, range: ByteRange | null): Promise<DavResponse> {
  const res = await get(pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
  })
  if (!res?.stream) throw new Error("임시 저장소에서 파일을 찾지 못했습니다")
  return {
    status: range ? 206 : 200,
    body: Readable.fromWeb(res.stream as Parameters<typeof Readable.fromWeb>[0]),
    headers: {},
  }
}
