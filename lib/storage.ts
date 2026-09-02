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
        resolve(socket)
      },
    )
    socket.once("error", reject)
  })
}

/** 절대 경로(공유폴더부터 시작)를 WebDAV URL로 바꾼다. 한글·공백이 들어가므로 세그먼트마다 인코딩한다. */
function davUrl(absolutePath: string): string {
  const encoded = absolutePath.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  return new URL(`/${encoded}`, env("SYNOLOGY_WEBDAV_URL")).toString()
}

function absolutePathFor(key: string): string {
  return `${env("SYNOLOGY_WEBDAV_BASE_PATH").replace(/\/+$/, "")}/${key}`
}

const objectUrl = (key: string) => davUrl(absolutePathFor(key))

interface DavResponse {
  status: number
  body: Readable
  headers: Record<string, string | string[] | undefined>
}

async function dav(method: string, url: string, body?: Buffer, contentType?: string): Promise<DavResponse> {
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
        },
      },
      (res) => resolve({ status: res.statusCode ?? 0, body: res, headers: res.headers }),
    )
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
async function ensureParents(key: string) {
  const segments = absolutePathFor(key).split("/").filter(Boolean).slice(0, -1)
  let prefix = ""
  for (const segment of segments) {
    prefix = `${prefix}/${segment}`
    drain(await dav("MKCOL", davUrl(prefix)))
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let res = await dav("PUT", objectUrl(key), body, contentType)
  if (res.status === 409) {
    // 상위 디렉터리가 없다. 만들고 한 번만 다시 시도한다.
    drain(res)
    await ensureParents(key)
    res = await dav("PUT", objectUrl(key), body, contentType)
  }
  drain(res)
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`NAS 업로드 실패 (HTTP ${res.status})`)
  }
}

export async function getObject(key: string): Promise<DavResponse> {
  const res = await dav("GET", objectUrl(key))
  if (res.status !== 200) {
    drain(res)
    throw new Error(`NAS 다운로드 실패 (HTTP ${res.status})`)
  }
  return res
}

/** File.id로부터 NAS 저장 키를 만든다. 업로드·다운로드가 같은 규칙을 쓰도록 여기 한 곳에 둔다. */
export function objectKeyFor(id: string, originalName: string): string {
  const ext = originalName.includes(".") ? "." + originalName.split(".").pop() : ""
  return `${id}${ext}`
}

/** Vercel 서버리스 함수의 요청 본문 상한. 이보다 큰 파일은 프록시로 받을 수 없다. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
