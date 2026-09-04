/**
 * 운영 알림 메일.
 *
 * 의존성을 늘리지 않으려고 Resend 의 HTTP API 를 fetch 로 직접 부른다.
 * SMTP 를 쓰지 않는 이유는 Vercel 서버리스에서 연결이 자주 끊기고 재시도가
 * 어렵기 때문이다.
 *
 * 필요한 환경변수 — 하나라도 없으면 메일은 건너뛰고 서버 로그만 남는다.
 *   RESEND_API_KEY    Resend 대시보드의 API 키
 *   ALERT_EMAIL_TO    받는 사람 (쉼표로 여러 명)
 *   ALERT_EMAIL_FROM  보내는 주소. Resend 에 인증된 도메인이어야 한다
 */

type MailResult =
  | { sent: true }
  | { sent: false; reason: "unconfigured" | "failed"; detail?: string }

export function alertMailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.ALERT_EMAIL_TO &&
      process.env.ALERT_EMAIL_FROM
  )
}

export async function sendAlertMail(
  subject: string,
  text: string
): Promise<MailResult> {
  if (!alertMailConfigured()) {
    return { sent: false, reason: "unconfigured" }
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ALERT_EMAIL_FROM,
        to: process.env.ALERT_EMAIL_TO!.split(",").map((s) => s.trim()),
        subject,
        text,
      }),
    })
    if (!res.ok) {
      return { sent: false, reason: "failed", detail: await res.text() }
    }
    return { sent: true }
  } catch (err) {
    return {
      sent: false,
      reason: "failed",
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
