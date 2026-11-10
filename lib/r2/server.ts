// R2(S3 호환) 저장소 — 서버 쪽. 파일 바이트는 여기를 지나지 않는다(MCP read_file 처럼 서버가 직접 읽는 경우만 예외).
// 서버가 R2 에 직접 부르는 것: Create · ListParts · Complete · Abort · Head (본문 없는 제어 호출).
// 브라우저에 주는 것: 조각 PUT · 열람 GET 의 서명 주소뿐이다. 설계 · 켜는 법: mydocs/manual/r2-upload.md
import type { Readable } from "node:stream"
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { DavResponse } from "@/lib/storage"
import type { ByteRange } from "@/lib/large-upload/rules"
import { GET_URL_TTL_SECONDS, PART_URL_TTL_SECONDS, type R2Part } from "./rules"

export type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }

/**
 * 값이 다 있어야 R2 다. 하나라도 없으면 null — 그러면 큰 첨부는 지금(#158) 경로 그대로다.
 * R2_ENDPOINT 는 비우면 계정 id 로 만든다. 로컬 시험(MinIO)만 주소를 직접 준다.
 */
export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const endpoint = env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "")
  const bucket = env.R2_BUCKET ?? ""
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? ""
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? ""
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return { endpoint, bucket, accessKeyId, secretAccessKey }
}

/** 새 큰 첨부를 R2 로 받는가 — 플래그와 값이 다 있을 때만. 이미 R2 에 있는 파일 읽기는 이 값과 상관없다(r2Config 만 본다) */
export function r2UploadEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LARGE_UPLOAD_BACKEND === "r2" && r2Config(env) !== null
}

let cached: { key: string; client: S3Client } | null = null

function client(config: R2Config): S3Client {
  const key = `${config.endpoint}|${config.accessKeyId}`
  if (cached?.key === key) return cached.client
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: "auto",
    // 버킷 이름을 주소 앞(가상 호스트)에 붙이지 않는다 — R2 · MinIO 둘 다 경로 방식이 된다
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // SDK 가 조각마다 체크섬 헤더를 요구하면 브라우저의 서명 PUT 이 그 값을 모른다 — 필요할 때만 붙인다
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
  cached = { key, client: s3 }
  return s3
}

function need(): { config: R2Config; s3: S3Client } {
  const config = r2Config()
  if (!config) throw new Error("R2 설정(R2_BUCKET · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_ACCOUNT_ID 또는 R2_ENDPOINT)이 없습니다")
  return { config, s3: client(config) }
}

export function r2Bucket(): string {
  return need().config.bucket
}

export async function createUpload(key: string): Promise<string> {
  const { config, s3 } = need()
  // 형식은 일반 바이너리로 둔다 — 열 때 서명 주소가 안전한 형식으로 바꿔 내보낸다(lib/file-serving.ts)
  const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: config.bucket, Key: key, ContentType: "application/octet-stream" }))
  if (!r.UploadId) throw new Error("R2 가 업로드 번호를 주지 않았습니다")
  return r.UploadId
}

export async function signPartUrls(key: string, uploadId: string, partNumbers: number[]): Promise<Record<number, string>> {
  const { config, s3 } = need()
  const entries = await Promise.all(
    partNumbers.map(async (n) => [n, await getSignedUrl(s3, new UploadPartCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId, PartNumber: n }), { expiresIn: PART_URL_TTL_SECONDS })] as const),
  )
  return Object.fromEntries(entries)
}

const isMissingUpload = (e: unknown) => {
  const name = (e as { name?: string; Code?: string })?.name ?? ""
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  return name === "NoSuchUpload" || status === 404
}

/** 올라간 조각. 업로드가 이미 합쳐졌거나 없어졌으면 null */
export async function listUploadedParts(key: string, uploadId: string): Promise<R2Part[] | null> {
  const { config, s3 } = need()
  const parts: R2Part[] = []
  let marker: string | undefined
  try {
    do {
      const r = await s3.send(new ListPartsCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }))
      for (const p of r.Parts ?? []) if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 })
      marker = r.IsTruncated ? r.NextPartNumberMarker : undefined
    } while (marker)
  } catch (e) {
    if (isMissingUpload(e)) return null
    throw e
  }
  return parts
}

export async function completeUpload(key: string, uploadId: string, parts: R2Part[]): Promise<string | null> {
  const { config, s3 } = need()
  const r = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  )
  return r.ETag ?? null
}

/** 올리다 버린 조각을 지운다. 이미 없으면 조용히 끝난다 — 남은 것은 버킷 수명 규칙이 지운다 */
export async function abortUpload(key: string, uploadId: string): Promise<void> {
  const { config, s3 } = need()
  try {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId }))
  } catch (e) {
    if (!isMissingUpload(e)) throw e
  }
}

export async function objectSize(key: string): Promise<number | null> {
  const { config, s3 } = need()
  try {
    return (await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))).ContentLength ?? null
  } catch (e) {
    if ((e as { name?: string }).name === "NotFound" || isMissingUpload(e)) return null
    throw e
  }
}

/**
 * 열람 서명 주소. 응답 형식 · 내려받기 이름은 우리가 정한 값(fileResponseHeaders)으로 덮는다 —
 * 저장된 값을 그대로 내보내면 올린 HTML 이 열릴 수 있다. 캐시는 private.
 */
export async function signedGetUrl(
  key: string,
  headers: { "Content-Type": string; "Content-Disposition": string },
  opts: { isPrivate: boolean },
): Promise<string> {
  const { config, s3 } = need()
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ResponseContentType: headers["Content-Type"],
      ResponseContentDisposition: headers["Content-Disposition"],
      ResponseCacheControl: opts.isPrivate ? "private, no-store" : "private, max-age=3600",
    }),
    { expiresIn: GET_URL_TTL_SECONDS },
  )
}

/** 서버가 직접 읽는다 — MCP read_file 처럼 바이트가 서버에 필요할 때만. 화면 열람은 signedGetUrl */
export async function openR2Object(key: string, range: ByteRange | null): Promise<DavResponse> {
  const { config, s3 } = need()
  const r = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }))
  if (!r.Body) throw new Error("R2 에서 파일을 찾지 못했습니다")
  return { status: range ? 206 : 200, body: r.Body as Readable, headers: {} }
}

/** 합친 뒤 크기가 틀린 파일처럼, 행이 없어 잃을 것이 없는 객체만 지운다 */
export async function deleteR2Object(key: string): Promise<void> {
  const { config, s3 } = need()
  await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
}
