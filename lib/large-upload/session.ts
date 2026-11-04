// 업로드 세션 표 — 올리는 동안 DB 에 쓰지 않으려고, 무엇을 올리는지를 서명해 화면에 맡긴다. 시험: session.test.ts
import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const payloadSchema = z.object({
  f: z.string().min(1), // 파일 id
  u: z.string().min(1), // 올리는 사람
  n: z.string().min(1), // 파일 이름
  s: z.number().int().positive(), // 크기
  m: z.string(), // 형식
  p: z.boolean(), // 참여자만 보는 파일
  e: z.number().int(), // 만료(초)
})

export type UploadSession = {
  fileId: string
  userId: string
  name: string
  size: number
  mimeType: string
  isPrivate: boolean
  expiresAt: number
}

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!value) throw new Error("AUTH_SECRET 이 없어 업로드 세션을 서명할 수 없습니다")
  return value
}

const sign = (payload: string) => createHmac("sha256", secret()).update(`large-upload.${payload}`).digest("base64url")

export function signUploadSession(session: UploadSession): string {
  const payload = Buffer.from(
    JSON.stringify({
      f: session.fileId, u: session.userId, n: session.name, s: session.size, m: session.mimeType, p: session.isPrivate,
      e: Math.floor(session.expiresAt / 1000),
    }),
  ).toString("base64url")
  return `${payload}.${sign(payload)}`
}

/** 서명이 맞고 만료되지 않았으면 세션, 아니면 null */
export function verifyUploadSession(token: unknown, now = Date.now()): UploadSession | null {
  if (typeof token !== "string") return null
  const [payload, mac, extra] = token.split(".")
  if (!payload || !mac || extra !== undefined) return null
  const given = Buffer.from(mac)
  const expected = Buffer.from(sign(payload))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }
  const parsed = payloadSchema.safeParse(raw)
  if (!parsed.success || parsed.data.e * 1000 <= now) return null
  const p = parsed.data
  return { fileId: p.f, userId: p.u, name: p.n, size: p.s, mimeType: p.m, isPrivate: p.p, expiresAt: p.e * 1000 }
}
