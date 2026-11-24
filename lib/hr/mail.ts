// 지원서 접수 메일 발송 — 접수 확정(complete) 뒤 응답과 따로(runAfterResponse) 두 통을 보낸다.
//
// 보내는 사람은 정우창 회사 메일(네이버웍스 SMTP smtp.worksmobile.com:587 STARTTLS, 표시 이름 「하드사이언스 정우창」).
// env 는 로그인 코드 메일(lib/mailer.ts 의 WORKS_SMTP_USER · PASS · FROM)과 따로 둔다 — 그쪽 값을 바꾸면 로그인 코드의
// 보낸 사람까지 바뀐다:
//   HR_SMTP_USER      보내는 계정(= 보낸 주소)
//   HR_SMTP_PASSWORD  그 계정의 비밀번호
// 둘 중 하나라도 없으면 메일 단계만 건너뛴다(접수는 그대로).
//
// 한 번만: 접수 확정은 RECEIVING → RECEIVED 로 바뀐 요청 하나만 여기까지 온다(lib/hr/intake.ts). 그래도 재시도 · 동시 요청에
// 대비해 지원서마다 한 번만 잡는 표시(AppSetting hr_mail:<id>)를 먼저 잡는다. 실패는 로그와 지원서 기록(JobApplicationEvent)에 남긴다.
import { COMPANY_COPY_TO, HR_SENDER_NAME, applicantMail, companyCopyMail, type ApplicationForMail, type MailDraft } from "./mail-content"

export interface HrSmtpConfig {
  user: string
  pass: string
  host: string
  port: number
  /** 시험용 흉내 서버만 — 운영 배포에서는 켜지지 않는다 */
  insecure: boolean
}

export function hrSmtpConfig(env: Record<string, string | undefined>): HrSmtpConfig | null {
  if (!env.HR_SMTP_USER || !env.HR_SMTP_PASSWORD) return null
  const prod = env.VERCEL_ENV === "production"
  return {
    user: env.HR_SMTP_USER,
    pass: env.HR_SMTP_PASSWORD,
    host: (!prod && env.HR_SMTP_HOST) || "smtp.worksmobile.com",
    port: Number((!prod && env.HR_SMTP_PORT) || 587),
    insecure: !prod && env.HR_SMTP_INSECURE === "1",
  }
}

export const hrFromHeader = (user: string) => `"${HR_SENDER_NAME}" <${user}>`

export type SendFn = (cfg: HrSmtpConfig, mail: MailDraft) => Promise<void>

export const smtpSend: SendFn = async (cfg, mail) => {
  const nodemailer = await import("nodemailer")
  const tx = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: false,
    requireTLS: !cfg.insecure,
    ignoreTLS: cfg.insecure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  })
  await tx.sendMail({ from: hrFromHeader(cfg.user), to: mail.to, subject: mail.subject, text: mail.text })
}

export interface MailDeps {
  config: HrSmtpConfig | null
  /** 지원서마다 처음이면 true(AppSetting claimOnce) */
  claim: (applicationId: string) => Promise<boolean>
  send: SendFn
  /** 결과를 지원서 기록에 남긴다 — 받는 주소는 적지 않는다 */
  record: (applicationId: string, note: string) => Promise<void>
  omnisOrigin: string
}

export interface MailOutcome {
  skipped?: "unconfigured" | "already"
  applicant?: "sent" | "failed"
  company?: "sent" | "failed"
}

/** 실패 까닭 — SMTP 오류에 받는 주소가 섞여 오기도 해서 주소 모양은 가린다(로그 · 지원서 기록에 남는다) */
export const failReason = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/[^\s<>"']+@[^\s<>"']+/g, "<주소>").replace(/\s+/g, " ").slice(0, 160)
const reason = failReason

/** 두 통을 보낸다. 한 통이 실패해도 다른 통은 보낸다. 던지지 않는다 */
export async function sendApplicationMails(a: ApplicationForMail, deps: MailDeps): Promise<MailOutcome> {
  if (!deps.config) return { skipped: "unconfigured" }
  if (!(await deps.claim(a.id))) return { skipped: "already" }
  const out: MailOutcome = {}
  const jobs: [keyof Omit<MailOutcome, "skipped">, string, () => MailDraft][] = [
    ["applicant", "접수 확인 메일(지원자)", () => applicantMail(a)],
    ["company", `회사 사본(${COMPANY_COPY_TO})`, () => companyCopyMail(a, deps.omnisOrigin)],
  ]
  for (const [key, label, build] of jobs) {
    try {
      await deps.send(deps.config, build())
      out[key] = "sent"
      await deps.record(a.id, `${label} 보냄`).catch(() => {})
    } catch (e) {
      out[key] = "failed"
      console.error("[hr-mail] 발송 실패", a.code, key, reason(e))
      await deps.record(a.id, `${label} 실패: ${reason(e)}`).catch(() => {})
    }
  }
  return out
}
