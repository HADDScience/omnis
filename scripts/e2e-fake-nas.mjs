/**
 * e2e 전용 가짜 NAS. 저장소(lib/storage)가 쓰는 만큼의 WebDAV 를 메모리로 흉내 낸다.
 * 실제 NAS 처럼 자체서명 인증서라, 지문을 함께 내준다. 실행: node scripts/e2e-fake-nas.mjs <env 파일>
 * env 파일을 서버와 playwright 양쪽 환경에 넣으면 tests/feature/file-headers.spec.ts 가 돈다.
 */
import { execFileSync } from "node:child_process"
import { X509Certificate } from "node:crypto"
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"

const envFile = process.argv[2]
if (!envFile) throw new Error("사용법: node scripts/e2e-fake-nas.mjs <env 파일>")
const port = Number(process.env.E2E_FAKE_NAS_PORT ?? 5806)

const dir = mkdtempSync(join(tmpdir(), "omnis-fake-nas-"))
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost",
  "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" })
const key = readFileSync(join(dir, "key.pem"))
const cert = readFileSync(join(dir, "cert.pem"))
rmSync(dir, { recursive: true })

const files = new Map()
const escapeXml = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const server = createServer({ key, cert }, (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "https://localhost").pathname)
  const chunks = []
  req.on("data", (c) => chunks.push(c))
  req.on("end", () => {
    const stored = files.get(path)
    if (req.method === "PUT") {
      files.set(path, Buffer.concat(chunks))
      res.writeHead(201).end()
    } else if (req.method === "MKCOL") {
      res.writeHead(201).end()
    } else if (req.method === "DELETE") {
      files.delete(path)
      res.writeHead(204).end()
    } else if (!stored) {
      res.writeHead(404).end()
    } else if (req.method === "PROPFIND") {
      const href = escapeXml(path.split("/").map(encodeURIComponent).join("/"))
      res.writeHead(207, { "Content-Type": "application/xml" }).end(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href>` +
        `<d:propstat><d:prop><d:getcontentlength>${stored.length}</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`,
      )
    } else if (req.method === "GET") {
      res.writeHead(200, { "Content-Length": stored.length }).end(stored)
    } else {
      res.writeHead(405).end()
    }
  })
})

server.listen(port, "localhost", () => {
  const url = `https://localhost:${port}`
  const env = [
    `E2E_FAKE_NAS_URL=${url}`,
    `SYNOLOGY_WEBDAV_URL=${url}`,
    "SYNOLOGY_WEBDAV_USER=e2e",
    "SYNOLOGY_WEBDAV_PASSWORD=e2e",
    "SYNOLOGY_WEBDAV_BASE_PATH=/e2e-files",
    `SYNOLOGY_TLS_FINGERPRINT=${new X509Certificate(cert).fingerprint256}`,
  ].join("\n")
  // 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한 번에 옮긴다
  writeFileSync(`${envFile}.tmp`, `${env}\n`)
  renameSync(`${envFile}.tmp`, envFile)
  console.log(`가짜 NAS: ${url}`)
})
