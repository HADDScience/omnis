/**
 * 로그인 코드 — 순수 규칙(시험: login-code.test.ts). 기록을 읽고 쓰는 쪽은 lib/login-code-server.ts.
 *
 * 6자리 일회용 · 10분 유효 · 원문은 남기지 않고 HMAC 만 남긴다.
 * 계정당 15분에 3번까지 보낸다. 한 코드에 5번 틀리면 그 코드는 끝난다(로그인 실패 잠금도 같이 센다).
 * 화면 응답은 계정이 있든 없든 같다 — CODE_SENT_MESSAGE.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto"

export const CODE_TTL_MS = 10 * 60 * 1000
export const CODE_LIMITS = {
  account: { max: 3, windowMs: 15 * 60 * 1000 },
  ip: { max: 10, windowMs: 15 * 60 * 1000 },
  wrongPerCode: 5,
} as const

export const CODE_SENT_MESSAGE = "등록된 계정이면 웍스 메일로 코드를 보냈습니다"
export const CODE_ENTITY = "auth.code"

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

export function hashCode(userId: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex")
}

export function codeMatches(userId: string, code: string, hash: string, secret: string): boolean {
  const a = Buffer.from(hashCode(userId, code.trim(), secret))
  const b = Buffer.from(hash)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const isCodeShape = (v: string) => /^\d{6}$/.test(v.trim())

/** 웍스 메일만 받는다 — 회사 주소가 아닌 메일로는 코드를 보내지 않는다 */
export const WORKS_DOMAIN = "haddscience.com"
export function isWorksMail(email: string | null | undefined): email is string {
  return !!email && email.trim().toLowerCase().endsWith(`@${WORKS_DOMAIN}`)
}

export interface CodeLog {
  action: string
  title: string
  createdAt: Date
}

/**
 * 지금 쓸 수 있는 코드 — 가장 최근 발급 하나만 본다(새로 받으면 앞의 것은 끝난다).
 * 쓴 적이 없고 10분이 안 지났고 그 뒤로 틀린 횟수가 한도 아래여야 한다.
 */
export function activeCode(logs: readonly CodeLog[], now: number): { hash: string; wrong: number } | null {
  const sorted = [...logs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const issued = sorted.find((l) => l.action === "issued")
  if (!issued) return null
  if (now - issued.createdAt.getTime() > CODE_TTL_MS) return null
  const after = sorted.filter((l) => l.createdAt.getTime() >= issued.createdAt.getTime() && l !== issued)
  if (after.some((l) => l.action === "used")) return null
  const wrong = after.filter((l) => l.action === "wrong").length
  if (wrong >= CODE_LIMITS.wrongPerCode) return null
  return { hash: issued.title, wrong }
}

export function codeMail(code: string): { subject: string; text: string } {
  return {
    subject: `[옴니스] 로그인 코드 ${code}`,
    text: [
      "옴니스 로그인 코드입니다.",
      "",
      `    ${code}`,
      "",
      "10분 동안 한 번만 쓸 수 있습니다. 로그인하면 바로 새 비밀번호를 만듭니다.",
      "요청한 적이 없다면 이 메일은 무시하세요.",
      "",
      "— 옴니스",
    ].join("\n"),
  }
}
