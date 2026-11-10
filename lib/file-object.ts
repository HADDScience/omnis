// 첨부 파일의 실물을 연다. 올린 파일이든 NAS 연결이든 읽는 곳은 이것만 부른다.
// 읽는 곳: /api/files/[id]/raw · MCP read_file · MCP 내려받기 링크
import { Readable } from "node:stream"
import { MAX_UPLOAD_BYTES } from "@/lib/constants"
import { getObject, getObjectRange, objectKeyFor, type DavResponse } from "@/lib/storage"
import { readFile, normalizeNasPath } from "@/lib/nas"
import { nasPathOf } from "@/lib/file-source"
import { findTransfer, openTempObject } from "@/lib/large-upload/read"
import { isTempReadable, parseRange } from "@/lib/large-upload/rules"
import { findR2Object } from "@/lib/r2/read"
import { openR2Object } from "@/lib/r2/server"

/** 큰 첨부(FileTransfer 행이 있는 파일)면 응답 길이 · 범위를 알려 준다. 나머지 파일은 지금 모양 그대로다 */
export type FileObject = DavResponse & {
  large?: { contentLength: number; contentRange?: string; unsatisfiable?: boolean }
}

export async function openFileObject(
  file: { id: string; name: string; path: string; size: number },
  opts: { rangeHeader?: string | null } = {},
): Promise<FileObject> {
  const linked = nasPathOf(file.path)
  if (linked === null) {
    // 4MB 이하는 표를 찾아보지 않는다 — 작은 파일 읽기에 DB 질의를 더하지 않는다
    const transfer = file.size > MAX_UPLOAD_BYTES ? await findTransfer(file.id) : null
    if (transfer) return openLargeObject(file, transfer, opts.rangeHeader)
    // R2 에 올린 큰 첨부 — 화면 열람은 /raw 가 서명 주소로 보낸다. 여기는 서버가 바이트를 직접 읽어야 할 때(MCP read_file 등)
    const r2 = file.size > MAX_UPLOAD_BYTES ? await findR2Object(file.id) : null
    if (r2) return openR2Large(file, r2.key, opts.rangeHeader)
    return getObject(objectKeyFor(file.id, file.name))
  }

  // 행을 만들 때 걸렀지만 DB 값을 그대로 NAS 로 보내지 않는다 — 공유폴더 밖으로 나가는 경로는 여기서도 막는다
  const path = normalizeNasPath(linked)
  const res = path ? await readFile(path) : null
  if (!res) throw new Error("시놀로지에서 파일을 찾지 못했습니다 — 옮겨졌거나 지워졌을 수 있습니다")
  return res
}

function rangeInfo(size: number, rangeHeader?: string | null) {
  const range = parseRange(rangeHeader, size)
  if (range === "unsatisfiable") return { range, large: { contentLength: 0, contentRange: `bytes */${size}`, unsatisfiable: true } } as const
  const large = range ? { contentLength: range.end - range.start + 1, contentRange: `bytes ${range.start}-${range.end}/${size}` } : { contentLength: size }
  return { range, large } as const
}

async function openR2Large(file: { size: number }, key: string, rangeHeader?: string | null): Promise<FileObject> {
  const { range, large } = rangeInfo(file.size, rangeHeader)
  if (range === "unsatisfiable") return { status: 416, body: Readable.from([]), headers: {}, large }
  return { ...(await openR2Object(key, range)), large }
}

/** VERIFIED 전에는 임시본, 뒤에는 NAS. 어느 쪽이든 Range 를 지킨다 */
async function openLargeObject(
  file: { id: string; name: string; size: number },
  transfer: { state: string; blobPathname: string },
  rangeHeader?: string | null,
): Promise<FileObject> {
  const range = parseRange(rangeHeader, file.size)
  if (range === "unsatisfiable") {
    return { status: 416, body: Readable.from([]), headers: {}, large: { contentLength: 0, contentRange: `bytes */${file.size}`, unsatisfiable: true } }
  }
  const large = range
    ? { contentLength: range.end - range.start + 1, contentRange: `bytes ${range.start}-${range.end}/${file.size}` }
    : { contentLength: file.size }
  if (isTempReadable(transfer.state)) return { ...(await openTempObject(transfer.blobPathname, range)), large }

  const key = objectKeyFor(file.id, file.name)
  const res = range ? await getObjectRange(key, range.start, large.contentLength) : await getObject(key)
  if (range && res.status !== 206) {
    res.body.resume()
    throw new Error(`시놀로지 범위 읽기 실패 (HTTP ${res.status})`)
  }
  return { ...res, large }
}
