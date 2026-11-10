// 개발자 알림 받는 사람 — 기능 요청(#181) · AI 비용 알림이 함께 쓴다.
//
// 관리자 화면에서 지정한 사람(AppSetting feature_request_recipients = { userIds })이 있으면 그 사람들.
// 비어 있으면 예전 동작 — 운영 알림 메일 받는 주소(ALERT_EMAIL_TO)와 이메일이 같은 재직 계정.
// 옴니스 알림(벨 · 푸시) + 운영 알림 메일(lib/alert-mail). 둘 다 실패해도 부른 쪽은 멈추지 않는다.
import { prisma } from "@/lib/db"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { sendAlertMail } from "@/lib/alert-mail"
import { createNotification } from "@/lib/notifications"
import { readSetting, writeSetting } from "@/lib/app-settings"

export const RECIPIENTS_KEY = "feature_request_recipients"

export function parseRecipients(v: unknown): string[] {
  const ids = v && typeof v === "object" && Array.isArray((v as { userIds?: unknown }).userIds) ? (v as { userIds: unknown[] }).userIds : []
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))]
}

export async function configuredRecipientIds(): Promise<string[]> {
  return parseRecipients(await readSetting(RECIPIENTS_KEY))
}

export async function saveRecipientIds(userIds: string[], by: string): Promise<void> {
  await writeSetting(RECIPIENTS_KEY, { userIds: [...new Set(userIds)] }, by)
}

/** 지금 알림을 받을 재직 계정 id */
export async function developerIds(): Promise<string[]> {
  const chosen = await configuredRecipientIds()
  if (chosen.length) {
    const rows = await prisma.user.findMany({ where: { id: { in: chosen }, ...ACTIVE_MEMBER_WHERE }, select: { id: true } })
    return rows.map((r) => r.id)
  }
  const emails = (process.env.ALERT_EMAIL_TO ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (emails.length === 0) return []
  const users = await prisma.user.findMany({ where: { ...ACTIVE_MEMBER_WHERE, email: { not: null } }, select: { id: true, email: true } })
  return users.filter((u) => emails.includes((u.email ?? "").toLowerCase())).map((u) => u.id)
}

/** 옴니스 알림 + 메일. 보낸 수를 돌려준다 */
export async function notifyDevelopers(n: { type: string; title: string; content: string; entityId: string; mailSubject: string; mailBody: string }): Promise<{ app: number; mail: boolean }> {
  let app = 0
  for (const id of await developerIds()) {
    try {
      await createNotification(id, n.type, n.title, n.content, n.entityId)
      app++
    } catch (err) {
      console.error("[notify-recipients] 알림 실패", n.type, err)
    }
  }
  const mail = await sendAlertMail(n.mailSubject, n.mailBody)
  if (!mail.sent && mail.reason === "failed") console.error("[notify-recipients] 메일 실패", n.type, mail.detail)
  return { app, mail: mail.sent }
}
