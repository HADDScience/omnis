// 접수 메일의 실제 의존성(DB · SMTP) — lib/hr/mail.ts 의 sendApplicationMails 에 넣는다. 접수 확정(lib/hr/intake.ts)이 응답 뒤에 부른다.
import { prisma } from "@/lib/db"
import { claimOnce } from "@/lib/app-settings"
import { hrSmtpConfig, sendApplicationMails, smtpSend, type MailOutcome } from "./mail"

export const hrMailClaimKey = (applicationId: string) => `hr_mail:${applicationId}`

export async function dispatchApplicationMails(applicationId: string, env: Record<string, string | undefined> = process.env): Promise<MailOutcome> {
  const config = hrSmtpConfig(env)
  if (!config) {
    console.log("[hr-mail] HR_SMTP_USER · HR_SMTP_PASSWORD 가 없어 메일을 건너뛴다", applicationId)
    return { skipped: "unconfigured" }
  }
  const a = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { files: { select: { slot: true, fileName: true } } },
  })
  if (!a || !a.code || !a.receivedAt || a.purgedAt) return { skipped: "already" }
  const out = await sendApplicationMails(
    { ...a, code: a.code, receivedAt: a.receivedAt },
    {
      config,
      claim: (id) => claimOnce(hrMailClaimKey(id), { at: new Date().toISOString() }),
      send: smtpSend,
      record: async (id, note) => {
        await prisma.jobApplicationEvent.create({ data: { applicationId: id, note } })
      },
      omnisOrigin: env.PUBLIC_URL?.replace(/\/+$/, "") || "https://omnis.haddscience.com",
    },
  )
  console.log("[hr-mail]", a.code, JSON.stringify(out))
  return out
}
