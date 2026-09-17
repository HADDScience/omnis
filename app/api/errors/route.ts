import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { sendAlertMail, alertMailConfigured } from "@/lib/alert-mail"
import { fileIssue, githubIssueConfigured, issueFingerprint, redactForPublic } from "@/lib/github-issue"

export const runtime = "nodejs"

const reportSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  scope: z.enum(["global", "page"]).default("page"),
  // 화면은 살아 있지만 일이 막힌 경우(2026-09-17) — lib/report-client-error.ts 의 reportIncident
  kind: z.enum(["crash", "upload_too_large", "upload_failed", "send_failed"]).default("crash"),
  status: z.number().int().optional(),
  size: z.number().nonnegative().optional(),
  // 메일에만 적는다. 이슈 저장소가 공개다
  fileName: z.string().max(1000).optional(),
})

const KIND_LABEL: Record<z.infer<typeof reportSchema>["kind"], string> = {
  crash: "화면 오류",
  upload_too_large: "첨부 상한 초과",
  upload_failed: "첨부 실패",
  send_failed: "메시지 전송 실패",
}

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

/** 주소에서 공개해도 되는 부분만 — 쿼리 없이 경로, ID 는 :id */
function publicPath(url: string | undefined): string {
  if (!url) return "(알 수 없음)"
  try {
    return redactForPublic(decodeURIComponent(new URL(url).pathname))
  } catch {
    return "(알 수 없음)"
  }
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`

export async function POST(req: Request) {
  const parsed = reportSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 })
  }
  const { message, stack, digest, url, scope, kind, status, size, fileName } = parsed.data
  const label = KIND_LABEL[kind]

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
    `종류:   ${label}`,
    ...(kind === "crash" ? [`범위:   ${scope === "global" ? "루트 레이아웃" : "페이지"}`, `digest: ${digest ?? "-"}`] : []),
    ...(status !== undefined ? [`상태:   HTTP ${status}`] : []),
    ...(fileName ? [`파일:   ${fileName}${size !== undefined ? ` (${mb(size)})` : ""}`] : []),
    "",
    `메시지: ${message}`,
    ...(kind === "crash" ? ["", stack ? `스택:\n${stack}` : "스택 없음"] : []),
  ].join("\n")

  // 메일 설정이 없어도 로그는 남는다. Vercel 함수 로그에서 볼 수 있다.
  console.error(kind === "crash" ? "[client-error]" : "[client-incident]", body)

  // 같은 오류를 묶는 기준. 사람·파일마다 달라지는 것(파일명·크기·ID)은 넣지 않는다
  const publicMessage = redactForPublic(message)
  const fingerprint = issueFingerprint(kind, kind === "crash" ? (digest ?? publicMessage) : publicMessage, String(status ?? ""))

  const key = kind === "crash" ? (digest ?? `${message}::${url ?? ""}`) : `${fingerprint}::${session?.user?.id ?? ""}`
  if (!shouldSend(key)) {
    return NextResponse.json({ ok: true, mailed: false, reason: "중복" })
  }

  const at = new Date().toISOString()
  const facts = [
    `| 종류 | ${label} (\`${kind}\`) |`,
    `| 화면 | \`${publicPath(url)}\` |`,
    ...(status !== undefined ? [`| 상태 | HTTP ${status} |`] : []),
    ...(size !== undefined ? [`| 크기 | ${mb(size)} |`] : []),
    ...(kind === "crash" && digest ? [`| digest | \`${digest}\` |`] : []),
  ]

  const [mail, issue] = await Promise.all([
    sendAlertMail(`[Omnis] ${label} — ${message.slice(0, 80)}`, body),
    fileIssue({
      fingerprint,
      title: `[자동] ${label} — ${publicMessage.slice(0, 80)}`,
      body: [
        "운영에서 자동으로 모은 이슈입니다. 같은 문제가 다시 나면 댓글이 붙습니다.",
        "누가 · 어떤 파일이었는지는 알림 메일에만 있습니다(공개 저장소).",
        "",
        "| | |",
        "|---|---|",
        `| 처음 | ${at} |`,
        ...facts,
        "",
        "```",
        publicMessage,
        "```",
        ...(kind === "crash" && stack ? ["", "<details><summary>스택</summary>", "", "```", redactForPublic(stack.slice(0, 4000)), "```", "</details>"] : []),
      ].join("\n"),
      comment: ["다시 발생", "", "| | |", "|---|---|", `| 언제 | ${at} |`, ...facts].join("\n"),
    }),
  ])

  if (!mail.sent && mail.reason === "failed") {
    console.error("[client-error] 알림 메일 실패:", mail.detail)
  }
  if (!issue.filed && issue.reason === "failed") {
    console.error("[client-error] GitHub 이슈 실패:", issue.detail)
  }
  return NextResponse.json({
    ok: true,
    mailed: mail.sent,
    configured: alertMailConfigured(),
    issue: issue.filed ? issue.url : null,
    issueConfigured: githubIssueConfigured(),
  })
}
