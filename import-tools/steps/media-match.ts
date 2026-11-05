// 첨부 짝짓기와 나눠 올리기의 판단만 모은 곳 — DB · NAS 없이 시험한다(media-match.test.ts).
export interface Candidate {
  path: string
  name: string
  size: number
  stamp: Date | null
  /** 서랍 「파일」 칸에서 받은 것 — media/files/<보낸 시각>/<원래 이름>. 이름이 확실해 그 이름의 자리표시에만 붙는다 */
  named: boolean
}

export const WINDOW_MS = 3 * 60 * 1000
/** 이보다 크면 나눠 올린다. NAS 요청 한도(30초 무응답)에 큰 본문 한 번이 걸리지 않게 한다 */
export const CHUNK_BYTES = 16 * 1024 * 1024
/** lib/constants.ts ATTACH_MAX_BYTES 와 같다. 앱의 큰 첨부 플래그와 무관하게 이식이 스스로 지키는 상한이다 */
export { ATTACH_MAX_BYTES as IMPORT_MAX_BYTES } from "../../lib/constants"

const STAMP_DIR = /(?:^|[\\/])files[\\/](\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?$/

/** media/files/<보낸 시각> 폴더면 그 시각. 아니면 null */
export function stampOfNamedDir(dir: string): Date | null {
  const m = dir.match(STAMP_DIR)
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`) : null
}

/** 자리표시 이름과 같은 서랍 파일 중 보낸 시각이 가장 가까운 것. 같은 이름을 시각으로 가른다. ±3분 밖이면 붙이지 않는다 */
export function pickNamed(name: string, t: Date, files: Candidate[], used: Set<string>): Candidate | undefined {
  const target = name.replace(/\//g, ":")
  return files
    .filter((f) => f.named && f.name === target && f.stamp && !used.has(f.path) && Math.abs(f.stamp.getTime() - t.getTime()) <= WINDOW_MS)
    .sort((a, b) => Math.abs(a.stamp!.getTime() - t.getTime()) - Math.abs(b.stamp!.getTime() - t.getTime()))[0]
}

/**
 * 큰 파일을 나눠 올린다. 조각 하나는 세 번까지 다시 보낸다 — 같은 범위를 다시 써도 결과가 같다.
 * 끝난 뒤 NAS 의 크기를 재서 다르면 실패로 본다.
 */
export async function uploadInChunks(opts: {
  size: number
  chunkBytes?: number
  read: (start: number, length: number) => Promise<Buffer>
  putRange: (body: Buffer, start: number, total: number) => Promise<number>
  stat: () => Promise<number | null>
}): Promise<void> {
  const chunk = opts.chunkBytes ?? CHUNK_BYTES
  for (let start = 0; start < opts.size; start += chunk) {
    const body = await opts.read(start, Math.min(chunk, opts.size - start))
    let status = 0
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        lastError = null
        status = await opts.putRange(body, start, opts.size)
        if (status >= 200 && status < 300) break
      } catch (e) {
        lastError = e
      }
    }
    if (lastError) throw lastError
    if (status < 200 || status >= 300) throw new Error(`시놀로지 나눠 올리기 실패 (HTTP ${status})`)
  }
  const stored = await opts.stat()
  if (stored !== opts.size) throw new Error(`시놀로지 크기가 다름: ${stored} ≠ ${opts.size}`)
}
