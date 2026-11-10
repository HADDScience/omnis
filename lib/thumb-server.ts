// 미리보기 만들기 · 캐시 — 서버 전용. 규칙은 lib/thumb.ts
import sharp from "sharp"
import { openFileObject } from "@/lib/file-object"
import { getObjectIfExists, putObject } from "@/lib/storage"
import { thumbCacheKey, THUMB_MAX_INPUT_BYTES, type ThumbWidth } from "@/lib/thumb"

/** 디코드할 화소 상한 — 4천만(폰 카메라 4800만 화소 미만). 이보다 크면 원본으로 보낸다. 메모리 한도를 지키려는 것 */
const MAX_INPUT_PIXELS = 48_000_000
const QUALITY = 72

/**
 * 회전 보정(EXIF) → 폭 width · 높이 2×width 안으로 줄임(키우지 않음) → WebP.
 * sharp 는 withMetadata 를 부르지 않으면 EXIF · GPS · ICC 를 싣지 않는다.
 */
export async function makeThumb(input: Buffer, width: ThumbWidth): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
    .rotate()
    .resize({ width, height: width * 2, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 4 })
    .toBuffer()
}

/** 같은 인스턴스에서 같은 미리보기를 동시에 여러 번 부르면 한 번만 만든다 */
const inflight = new Map<string, Promise<Buffer>>()

export type ThumbResult = { body: Buffer; cache: "hit" | "miss" }

/**
 * NAS 캐시에 있으면 그것, 없으면 원본을 읽어 만들고 저장은 save 로 넘긴다(응답 뒤에 돌리도록).
 * 원본을 못 읽거나 만들지 못하면 던진다 — 호출부가 원본으로 돌린다.
 */
export async function loadThumb(
  file: { id: string; name: string; path: string; size: number },
  width: ThumbWidth,
  save: (task: () => Promise<unknown>) => void,
): Promise<ThumbResult> {
  const key = thumbCacheKey(file.id, width)
  const cached = await getObjectIfExists(key).catch(() => null)
  if (cached) return { body: await readAll(cached.body), cache: "hit" }

  let job = inflight.get(key)
  if (!job) {
    job = (async () => {
      const obj = await openFileObject(file)
      const original = await readAll(obj.body, THUMB_MAX_INPUT_BYTES)
      const thumb = await makeThumb(original, width)
      save(() => putObject(key, thumb, "image/webp"))
      return thumb
    })().finally(() => inflight.delete(key))
    inflight.set(key, job)
  }
  return { body: await job, cache: "miss" }
}

async function readAll(body: AsyncIterable<unknown>, limit = Infinity): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of body) {
    const b = Buffer.from(c as Uint8Array)
    size += b.length
    if (size > limit) throw new Error("미리보기를 만들기에 원본이 큽니다")
    chunks.push(b)
  }
  return Buffer.concat(chunks)
}
