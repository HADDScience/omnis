import { randomBytes } from "node:crypto"

import { prisma } from "@/lib/db"
import { deleteObject, putObject } from "@/lib/storage"

/**
 * 홈페이지 사진의 저장 규칙 — 업로드 · 이식 · 삭제 · 공개 URL 이 전부 여기를 거친다.
 *
 * 실물은 NAS(lib/storage.ts) 의 `website/<postId>/<name>` 에 있고, 목록은 WebsiteMedia 다.
 * 사이트와 관리 화면은 `/omnis/api/website/media/<postId>/<name>` 로 읽는다 — 같은 도메인의
 * 상대 경로라 사이트가 어느 오리진에 떠 있든 통한다.
 *
 * 이름은 업로드마다 새로 만든다(무작위 16자). 같은 이름을 다시 쓰지 않으므로 응답을 영구 캐시할 수
 * 있고, NAS 가 잠깐 꺼져도 한 번 나간 사진은 엣지에서 계속 나간다.
 */

const NAS_PREFIX = "website"

/** 사이트가 쓰는 공개 경로의 앞부분. basePath(/omnis)가 포함된 값이다. */
export const MEDIA_PUBLIC_BASE = process.env.WEBSITE_MEDIA_BASE ?? "/omnis/api/website/media"

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const ID_RE = /^[0-9]{6,}(-[0-9]{4})?$/

export function mediaKey(postId: string, name: string): string {
  if (!ID_RE.test(postId) || !NAME_RE.test(name)) throw new Error("사진 경로가 올바르지 않습니다")
  return `${NAS_PREFIX}/${postId}/${name}`
}

export function mediaUrl(postId: string, name: string): string {
  return `${MEDIA_PUBLIC_BASE}/${postId}/${name}`
}

/** 공개 경로의 두 조각(postId, name)이 규칙에 맞는지. 아니면 null — 호출부는 404. */
export function parseMediaPath(postId: string, name: string): { key: string } | null {
  if (!ID_RE.test(postId) || !NAME_RE.test(name)) return null
  return { key: mediaKey(postId, name) }
}

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/svg+xml": "svg",
}

export function extensionFor(contentType: string): string | null {
  return EXT[contentType] ?? null
}

/**
 * 사진을 NAS 에 올리고 목록에 적는다. `name` 을 주면 그 이름을, 아니면 새 이름을 만든다.
 * 같은 키가 이미 목록에 있으면 올리지 않는다 — 이식 스크립트를 두 번 돌려도 안전하도록.
 */
export async function storeMedia(opts: {
  postId: string
  bytes: Buffer
  contentType: string
  name?: string
}): Promise<{ url: string; key: string; reused: boolean }> {
  const ext = extensionFor(opts.contentType)
  if (!ext) throw new Error(`지원하지 않는 사진 형식: ${opts.contentType}`)
  const name = opts.name ?? `${randomBytes(8).toString("hex")}.${ext}`
  const key = mediaKey(opts.postId, name)

  const existing = await prisma.websiteMedia.findUnique({ where: { key }, select: { id: true } })
  if (existing) return { url: mediaUrl(opts.postId, name), key, reused: true }

  await putObject(key, opts.bytes, opts.contentType)
  await prisma.websiteMedia.create({
    data: { postId: opts.postId, key, contentType: opts.contentType, size: opts.bytes.length },
  })
  return { url: mediaUrl(opts.postId, name), key, reused: false }
}

/** 기사의 사진을 NAS 에서 전부 지운다. 목록 행은 기사와 함께 cascade 로 사라진다. */
export async function deletePostMedia(postId: string): Promise<number> {
  const rows = await prisma.websiteMedia.findMany({ where: { postId }, select: { key: true } })
  for (const row of rows) await deleteObject(row.key)
  return rows.length
}
