/** 파일 응답 헤더. 실행: pnpm test:unit · 실제 HTTP 는 tests/feature/file-headers.spec.ts */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { fileResponseHeaders, safeInlineType } from "./file-serving"

test("안전 목록의 형식은 그 자리에서 연다", () => {
  for (const [mimeType, expected] of [
    ["image/png", "image/png"],
    ["image/jpeg", "image/jpeg"],
    ["image/jpg", "image/jpeg"],
    ["image/gif", "image/gif"],
    ["image/webp", "image/webp"],
    ["application/pdf", "application/pdf"],
    ["video/mp4", "video/mp4"],
    ["video/quicktime", "video/quicktime"],
    ["audio/mpeg", "audio/mpeg"],
    ["IMAGE/PNG; foo=bar", "image/png"],
  ]) {
    const h = fileResponseHeaders({ mimeType, name: "a.bin" })
    assert.equal(h["Content-Type"], expected, mimeType)
    assert.match(h["Content-Disposition"], /^inline; /, mimeType)
    assert.equal(h["X-Content-Type-Options"], "nosniff", mimeType)
  }
})

test("거부 — 안전 목록 밖은 저장된 형식을 돌려주지 않고 내려받게 한다", () => {
  for (const mimeType of [
    "text/html",
    "TEXT/HTML; charset=utf-8",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "application/javascript",
    "text/javascript",
    "text/plain",
    "text/markdown; charset=utf-8",
    "application/json",
    "application/x-hwp",
    "image/bmp",
    "multipart/x-mixed-replace",
    "constructor",
    "__proto__",
  ]) {
    const h = fileResponseHeaders({ mimeType, name: "a.png" })
    assert.equal(h["Content-Type"], "application/octet-stream", mimeType)
    assert.match(h["Content-Disposition"], /^attachment; /, mimeType)
    assert.equal(h["X-Content-Type-Options"], "nosniff", mimeType)
  }
})

test("형식을 모르면 이름으로 찾되, 표에 없는 확장자는 거부한다", () => {
  assert.equal(safeInlineType("", "그림.PNG"), "image/png")
  assert.equal(safeInlineType(null, "회의.pdf"), "application/pdf")
  assert.equal(safeInlineType("application/octet-stream", "영상.mp4"), "video/mp4")
  for (const name of ["a.html", "a.svg", "a.xml", "a.js", "a.txt", "a.constructor", "확장자없음", "png"]) {
    assert.equal(safeInlineType("", name), null, name)
    assert.match(fileResponseHeaders({ mimeType: "", name })["Content-Disposition"], /^attachment; /, name)
  }
})

test("안전한 형식이라고 적어도 응답 형식은 표의 값이다 — 이름이 html 이어도 html 로 나가지 않는다", () => {
  const h = fileResponseHeaders({ mimeType: "image/png", name: "a.html" })
  assert.equal(h["Content-Type"], "image/png")
  assert.equal(h["X-Content-Type-Options"], "nosniff")
})

test("attachment 를 주면 안전한 형식도 내려받게 하고 형식은 유지한다", () => {
  const h = fileResponseHeaders({ mimeType: "image/png", name: "서명.png", attachment: true })
  assert.equal(h["Content-Type"], "image/png")
  assert.match(h["Content-Disposition"], /^attachment; /)
})

test("파일명 — 한글은 그대로 복원되고, 머리글을 끊는 글자는 나가지 않는다", () => {
  const value = fileResponseHeaders({ mimeType: "image/png", name: "보고서 (최종)'안*.png" })["Content-Disposition"]
  assert.match(value, /^inline; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/)
  assert.equal(decodeURIComponent(value.split("''")[1]), "보고서 (최종)'안*.png")
  const broken = fileResponseHeaders({ mimeType: "", name: 'a"\r\nSet-Cookie: x=1;.png' })["Content-Disposition"]
  assert.doesNotMatch(broken, /[\r\n"]/)
})

test("파일을 흘려보내는 라우트는 전부 이 헤더를 쓴다 — 새 경로가 빠지면 여기서 깨진다", () => {
  const routes: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name)
      if (e.isDirectory()) walk(path)
      else if (e.name === "route.ts") routes.push(path)
    }
  }
  walk("app")
  const streaming = routes.filter((path) => readFileSync(path, "utf8").includes("Readable.toWeb("))
  assert.deepEqual(streaming.sort(), [
    "app/api/company/staff-assets/[assetId]/route.ts",
    "app/api/crm/invoices/[invoiceId]/file/route.ts",
    "app/api/files/[fileId]/raw/route.ts",
    "app/api/ip-mcp/[[...path]]/route.ts",
    "app/api/nas/route.ts",
    "app/api/website/media/[postId]/[name]/route.ts",
  ])
  for (const path of streaming) {
    const source = readFileSync(path, "utf8")
    assert.ok(source.includes("fileResponseHeaders("), `${path}: fileResponseHeaders 를 쓰지 않는다`)
    assert.ok(!/"Content-Disposition"\s*:/.test(source), `${path}: Content-Disposition 을 직접 적었다`)
  }
})

test("거부 — 사이트 사진 업로드는 SVG 를 받지 않는다", async () => {
  const { extensionFor } = await import("./website-media")
  assert.equal(extensionFor("image/webp"), "webp")
  assert.equal(extensionFor("image/svg+xml"), null)
})
