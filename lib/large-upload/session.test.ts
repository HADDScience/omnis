import assert from "node:assert/strict"
import { test } from "node:test"
import { signUploadSession, verifyUploadSession, type UploadSession } from "./session"

process.env.AUTH_SECRET = "시험용-비밀"

const session: UploadSession = { fileId: "f", userId: "u", name: "한글 자료.pdf", size: 5_000_000, mimeType: "application/pdf", isPrivate: true, expiresAt: Date.now() + 60_000 }

test("서명한 세션을 그대로 돌려준다", () => {
  const out = verifyUploadSession(signUploadSession(session))
  assert.equal(out?.name, session.name)
  assert.equal(out?.size, session.size)
  assert.equal(out?.isPrivate, true)
})

test("거부: 내용을 바꾼 세션", () => {
  const [payload, mac] = signUploadSession(session).split(".")
  const raw = JSON.parse(Buffer.from(payload, "base64url").toString())
  const forged = Buffer.from(JSON.stringify({ ...raw, u: "다른 사람" })).toString("base64url")
  assert.equal(verifyUploadSession(`${forged}.${mac}`), null)
})

test("거부: 만료 · 빈 값 · 모양이 다른 값", () => {
  const token = signUploadSession(session)
  assert.equal(verifyUploadSession(token, session.expiresAt + 1), null)
  for (const bad of [null, undefined, 1, "", "a", "a.b.c", `${token}.x`]) assert.equal(verifyUploadSession(bad), null)
})

test("거부: 다른 비밀로 서명한 세션", () => {
  const token = signUploadSession(session)
  process.env.AUTH_SECRET = "다른-비밀"
  assert.equal(verifyUploadSession(token), null)
  process.env.AUTH_SECRET = "시험용-비밀"
})
