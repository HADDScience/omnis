import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { sendAlertMail, alertMailConfigured } from "@/lib/alert-mail"

export const runtime = "nodejs"

const reportSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  scope: z.enum(["global", "page"]).default("page"),
})

/**
 * 같은 오류로 메일이 쏟아지는 것을 막는다.
 *
 * 서버리스라 인스턴스마다 메모리가 따로다 — 완벽한 중복 제거가 아니라
 * "한 인스턴스가 30분 안에 같은 오류를 두 번 보내지는 않는다" 수준의 상한이다.
 * 그래도 렌더 루프가 만드는 수백 통은 이걸로 막힌다.
 */
const WINDOW_MS = 30 * 60 * 1000
const seen = new Map<string, number>()

function shouldSend(key: string): boolean {
  const now = Date.now()
  for (const [k, t] of seen) if (now - t > WINDOW_MS) seen.delete(k)
  if (seen.has(key)) return false
  seen.set(key, now)
  return true
}

export async function POST(req: Request) {
  const parsed = reportSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 })
  }
  const { message, stack, digest, url, scope } = parsed.data

  // 누가 겪었는지 알면 재현이 훨씬 쉽다. 로그인 전 오류도 받아야 하므로
  // 세션이 없다고 거절하지는 않는다.
  const session = await auth().catch(() => null)
  const who = session?.user
    ? `${session.user.name ?? "이름없음"} (${session.user.id})`
    : "비로그인"

  const body = [
    `언제:   ${new Date().toISOString()}`,
    `누가:   ${who}`,
    `어디:   ${url ?? "(알 수 없음)"}`,
    `범위:   ${scope === "global" ? "루트 레이아웃" : "페이지"}`,
    `digest: ${digest ?? "-"}`,
    "",
    `메시지: ${message}`,
    "",
    stack ? `스택:\n${stack}` : "스택 없음",
  ].join("\n")

  // 메일 설정이 없어도 로그는 남는다. Vercel 함수 로그에서 볼 수 있다.
  console.error("[client-error]", body)

  const key = digest ?? `${message}::${url ?? ""}`
  if (!shouldSend(key)) {
    return NextResponse.json({ ok: true, mailed: false, reason: "중복" })
  }

  const result = await sendAlertMail(`[Omnis] 화면 오류 — ${message.slice(0, 80)}`, body)
  if (!result.sent && result.reason === "failed") {
    console.error("[client-error] 알림 메일 실패:", result.detail)
  }
  return NextResponse.json({
    ok: true,
    mailed: result.sent,
    configured: alertMailConfigured(),
  })
}
