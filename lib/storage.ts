// Synology WebDAV 파일 저장소.
//
// NAS가 Synology 공장 자체서명 인증서(CN=synology)를 쓰고 있어 일반 검증이 통과하지
// 못한다. 검증을 끄는 대신 인증서 지문을 고정한다. 자격증명이 새어나가지 않도록
// TLS 핸드셰이크 직후 지문을 확인하고, 통과한 소켓으로만 요청을 보낸다.
import { connect as tlsConnect, type TLSSocket } from "node:tls"
import { request as httpsRequest } from "node:https"
import type { Readable } from "node:stream"

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`환경변수 ${name}이(가) 설정되지 않았습니다`)
  return v
}

const normalizeFingerprint = (v: string) => v.replace(/[^a-fA-F0-9]/g, "").toLowerCase()

/**
 * NAS 를 기다리는 한도.
 *
 * `tls.connect` 도 `https.request` 도 기본 타임아웃이 없다. NAS 는 사무실에 있고 인터넷을
 * 건너오므로, 전원이 내려가거나 회선이 끊기면 SYN 에 아무도 답하지 않는 상태가 된다 —
 * 그때 이 함수는 **영원히** 매달리고 서버리스 함수가 maxDuration 까지 자리를 잡는다.
 * 파일 하나 못 읽는 것이 화면 전체가 멎는 것보다 낫다.
 */
const CONNECT_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000

/** 지문이 일치하는 TLS 소켓을 만든다. 불일치하면 즉시 끊고 실패한다. */
function connectVerified(): Promise<TLSSocket> {
  const { hostname, port } = new URL(env("SYNOLOGY_WEBDAV_URL"))
  const expected = normalizeFingerprint(env("SYNOLOGY_TLS_FINGERPRINT"))

  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      { host: hostname, port: Number(port) || 443, servername: hostname, rejectUnauthorized: false },
      () => {
        const actual = normalizeFingerprint(socket.getPeerCertificate().fingerprint256 ?? "")
        if (actual !== expected) {
          socket.destroy()
          reject(new Error("NAS 인증서 지문이 일치하지 않습니다. 연결을 중단했습니다."))
          return
        }
        // 핸드셰이크가 끝났으니 연결 한도를 푼다. 본문을 주고받는 한도는 dav() 가 다시 건다
        socket.setTimeout(0)
        resolve(socket)
      },
    )
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy()
      reject(new Error(`NAS 연결이 ${CONNECT_TIMEOUT_MS / 1000}초 안에 열리지 않았습니다`))
    })
    socket.once("error", reject)
  })
}

/** 절대 경로(공유폴더부터 시작)를 WebDAV URL로 바꾼다. 한글·공백이 들어가므로 세그먼트마다 인코딩한다. */
export function davUrl(absolutePath: string): string {
  const encoded = absolutePath.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  return new URL(`/${encoded}`, env("SYNOLOGY_WEBDAV_URL")).toString()
}

function absolutePathFor(key: string): string {
  return `${env("SYNOLOGY_WEBDAV_BASE_PATH").replace(/\/+$/, "")}/${key}`
}


export interface DavResponse {
  status: number
  body: Readable
  headers: Record<string, string | string[] | undefined>
}

export async function dav(
  method: string,
  url: string,
  body?: Buffer,
  contentType?: string,
  extraHeaders?: Record<string, string>,
): Promise<DavResponse> {
  const socket = await connectVerified()
  const auth = Buffer.from(`${env("SYNOLOGY_WEBDAV_USER")}:${env("SYNOLOGY_WEBDAV_PASSWORD")}`).toString("base64")

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method,
        createConnection: () => socket,
        headers: {
          Authorization: `Basic ${auth}`,
          ...(body ? { "Content-Length": body.length, "Content-Type": contentType ?? "application/octet-stream" } : {}),
          ...(extraHeaders ?? {}),
        },
      },
      (res) => {
        // 응답 헤더가 왔으면 성공이다. 본문은 호출부가 스트림으로 읽어 가므로
        // 여기서 한도를 유지하면 큰 파일을 받다 끊긴다
        req.setTimeout(0)
        resolve({ status: res.statusCode ?? 0, body: res, headers: res.headers })
      },
    )
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`NAS 가 ${REQUEST_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다`))
    })
    req.once("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

/** 응답 본문을 버리고 소켓을 정리한다. 상태 코드만 필요할 때 쓴다. */
function drain(res: DavResponse) {
  res.body.resume()
}

/** 파일이 놓일 디렉터리를 공유폴더부터 한 단계씩 만든다.
 *  베이스 경로가 아직 없을 수도 있으므로 key가 아니라 절대 경로 전체를 훑는다.
 *  이미 있는 단계는 405를 돌려주는데, 그건 정상이므로 무시한다. */
async function ensureParents(absolutePath: string) {
  const segments = absolutePath.split("/").filter(Boolean).slice(0, -1)
  let prefix = ""
  for (const segment of segments) {
    prefix = `${prefix}/${segment}`
    drain(await dav("MKCOL", davUrl(prefix)))
  }
}

// ─── 절대 경로로 다루기 ─────────────────────────────────────────────
// 첨부파일(SYNOLOGY_WEBDAV_BASE_PATH) 밖에 두어야 하는 것 — 서명·직인처럼 권한이 좁은 폴더 — 이 쓴다.
// 첨부파일은 아래 putObject/getObject/deleteObject(키)를 쓴다.

export async function putAt(absolutePath: string, body: Buffer, contentType: string): Promise<void> {
  let res = await dav("PUT", davUrl(absolutePath), body, contentType)
  if (res.status === 409) {
    // 상위 디렉터리가 없다. 만들고 한 번만 다시 시도한다.
    drain(res)
    await ensureParents(absolutePath)
    res = await dav("PUT", davUrl(absolutePath), body, contentType)
  }
  drain(res)
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`NAS 업로드 실패 (HTTP ${res.status})`)
  }
}

export async function getAt(absolutePath: string): Promise<DavResponse> {
  const res = await dav("GET", davUrl(absolutePath))
  if (res.status !== 200) {
    drain(res)
    throw new Error(`NAS 다운로드 실패 (HTTP ${res.status})`)
  }
  return res
}

/** 지운다. 이미 없으면(404) 성공으로 본다 — 지우려던 결과와 같다. */
export async function deleteAt(absolutePath: string): Promise<void> {
  const res = await dav("DELETE", davUrl(absolutePath))
  drain(res)
  if (res.status === 404) return
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`NAS 삭제 실패 (HTTP ${res.status})`)
  }
}

/** 파일·폴더가 있는지. 덮어쓰지 않으려고 쓴다 */
export async function existsAt(absolutePath: string): Promise<boolean> {
  const res = await dav("PROPFIND", davUrl(absolutePath), undefined, undefined, { Depth: "0" })
  drain(res)
  if (res.status === 404) return false
  if (res.status === 207 || res.status === 200) return true
  throw new Error(`NAS 확인 실패 (HTTP ${res.status})`)
}

// ─── 첨부파일 (베이스 경로 + 키) ────────────────────────────────────

export function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  return putAt(absolutePathFor(key), body, contentType)
}

export function getObject(key: string): Promise<DavResponse> {
  return getAt(absolutePathFor(key))
}

/** 객체를 지운다. 이미 없으면(404) 성공으로 본다 — 지우려던 결과와 같다. */
export function deleteObject(key: string): Promise<void> {
  return deleteAt(absolutePathFor(key))
}

/** File.id로부터 NAS 저장 키를 만든다. 업로드·다운로드가 같은 규칙을 쓰도록 여기 한 곳에 둔다. */
export function objectKeyFor(id: string, originalName: string): string {
  const ext = originalName.includes(".") ? "." + originalName.split(".").pop() : ""
  return `${id}${ext}`
}

/** Vercel 서버리스 함수의 요청 본문 상한. 이보다 큰 파일은 프록시로 받을 수 없다. 값은 화면과 함께 쓴다. */
export { MAX_UPLOAD_BYTES } from "@/lib/constants"
