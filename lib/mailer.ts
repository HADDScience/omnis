/**
 * 사람에게 가는 메일(로그인 코드). 보내는 길은 환경변수가 정한다 — 주소를 바꿀 때 env 값만 바꾼다.
 *
 * 1. WORKS_SMTP_USER · WORKS_SMTP_PASS · WORKS_SMTP_FROM 이 모두 있으면 네이버웍스 SMTP(smtp.worksmobile.com:587 STARTTLS)
 * 2. 없으면 Resend(RESEND_API_KEY · ALERT_EMAIL_FROM — lib/alert-mail.ts 와 같은 값)
 * 3. 둘 다 없으면 보내지 않는다
 * 시험(e2e)만: MAIL_OUTBOX_DIR 가 있으면 파일로 떨군다. 운영 배포(VERCEL_ENV=production)에서는 켜지지 않는다.
 * 보낸 사람 표시 이름은 「옴니스」.
 */
import fs from "node:fs/promises"
import path from "node:path"

export const MAIL_SENDER_NAME = "옴니스"

export type MailTransport = "outbox" | "works-smtp" | "resend" | "none"

export function chooseMailTransport(env: Record<string, string | undefined>): MailTransport {
  if (env.MAIL_OUTBOX_DIR && env.VERCEL_ENV !== "production") return "outbox"
  if (env.WORKS_SMTP_USER && env.WORKS_SMTP_PASS && env.WORKS_SMTP_FROM) return "works-smtp"
  if (env.RESEND_API_KEY && env.ALERT_EMAIL_FROM) return "resend"
  return "none"
}

/** `"옴니스" <주소>` — 주소에 이미 표시 이름이 있으면 주소만 꺼내 다시 붙인다 */
export function fromHeader(address: string): string {
  const bare = address.match(/<([^>]+)>/)?.[1] ?? address
  return `"${MAIL_SENDER_NAME}" <${bare.trim()}>`
}

export interface Mail {
  to: string
  subject: string
  text: string
}

export async function sendMail(mail: Mail, env: Record<string, string | undefined> = process.env): Promise<{ sent: boolean; transport: MailTransport; detail?: string }> {
  const transport = chooseMailTransport(env)
  try {
    if (transport === "outbox") {
      await fs.mkdir(env.MAIL_OUTBOX_DIR!, { recursive: true })
      const file = path.join(env.MAIL_OUTBOX_DIR!, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
      await fs.writeFile(file, JSON.stringify(mail))
      return { sent: true, transport }
    }
    if (transport === "works-smtp") {
      const nodemailer = await import("nodemailer")
      const tx = nodemailer.createTransport({
        host: "smtp.worksmobile.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: env.WORKS_SMTP_USER!, pass: env.WORKS_SMTP_PASS! },
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
      })
      await tx.sendMail({ from: fromHeader(env.WORKS_SMTP_FROM!), to: mail.to, subject: mail.subject, text: mail.text })
      return { sent: true, transport }
    }
    if (transport === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromHeader(env.ALERT_EMAIL_FROM!), to: [mail.to], subject: mail.subject, text: mail.text }),
      })
      if (!res.ok) return { sent: false, transport, detail: await res.text() }
      return { sent: true, transport }
    }
    return { sent: false, transport }
  } catch (err) {
    return { sent: false, transport, detail: err instanceof Error ? err.message : String(err) }
  }
}
