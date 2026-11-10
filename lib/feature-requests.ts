// 기능 요청 — 옴니스(앱 AI)가 「지금 기능이 없어 못 한다」 고 본 것을 사용자가 확인하면 개발자에게 전달한다.
//
// 저장: FeatureRequest(묶음) + FeatureRequestEntry(요청 한 번). 같은 요청은 열린(완료 아닌) 묶음 하나에 붙인다.
// 알림: 개발자 = 운영 알림 메일 받는 주소(ALERT_EMAIL_TO)와 같은 이메일의 재직 계정. 저장소에 사람 이름을 두지 않는다.
//   ① 옴니스 알림(벨 · 푸시) ② 운영 알림 메일(lib/alert-mail — Resend). 둘 다 실패해도 요청은 저장된다.
// 계획: mydocs/plans/2026-11-10-app-ai-mcp-parity.md

import { prisma } from "@/lib/db"
import { sendAlertMail } from "@/lib/alert-mail"
import { createNotification } from "@/lib/notifications"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"

import { isFeatureStatus, type FeatureStatus } from "@/lib/feature-requests-shared"
export { FEATURE_STATUSES, FEATURE_STATUS_LABEL, isFeatureStatus, type FeatureStatus } from "@/lib/feature-requests-shared"

/** 알림 종류 — lib/schemas/notification.ts notificationHref 가 관리 화면으로 잇는다 */
export const FEATURE_NOTIFY_TYPE = "feature_request"
export const FEATURE_ADMIN_PATH = "/settings/feature-requests"

const TITLE_MAX = 80
const TEXT_MAX = 2000

/**
 * 묶기 키 — 대소문자 · 공백 · 문장부호 · 끝의 「기능」「해줘」 같은 꼬리를 걷어 낸 제목.
 * 「사진 일괄 다운로드 기능」 과 「사진 일괄다운로드」 는 같은 요청이다.
 */
export function featureKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/(기능|추가|지원|해줘|해주세요|필요|요청)+$/u, "")
}

export interface FeatureInput {
  title: string
  detail: string
  attempted: string
}

/** 도구 입력을 다듬는다 — 문제가 있으면 problem */
export function parseFeatureInput(args: Record<string, unknown>): FeatureInput & { problem?: string } {
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const title = s(args.title, TITLE_MAX)
  const detail = s(args.detail, TEXT_MAX)
  const attempted = s(args.attempted, TEXT_MAX)
  const problem = !title ? "요청 제목(title)이 비어 있습니다" : !detail ? "무엇이 필요한지(detail)가 비어 있습니다" : featureKey(title) === "" ? "제목에 글자가 없습니다" : undefined
  return { title, detail, attempted, ...(problem ? { problem } : {}) }
}

/** 같은 키의 열린 묶음 — 카드(미리보기)와 저장이 같은 판정을 쓴다 */
export async function findOpenFeature(title: string) {
  return prisma.featureRequest.findFirst({
    where: { key: featureKey(title), status: { not: "DONE" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, count: true, status: true },
  })
}

/** 개발자 계정 — ALERT_EMAIL_TO 의 주소와 이메일이 같은 재직자 */
async function developerIds(): Promise<string[]> {
  const emails = (process.env.ALERT_EMAIL_TO ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (emails.length === 0) return []
  const users = await prisma.user.findMany({ where: { ...ACTIVE_MEMBER_WHERE, email: { not: null } }, select: { id: true, email: true } })
  return users.filter((u) => emails.includes((u.email ?? "").toLowerCase())).map((u) => u.id)
}

export interface SubmitCtx {
  userId: string
  userName: string
  roomId?: string | null
  runId?: string | null
  /** 메일 본문의 대화 링크 앞부분 — 없으면 경로만 */
  base?: string
}

/** 저장하고 개발자에게 알린다. 같은 요청이면 묶는다 */
export async function submitFeatureRequest(input: FeatureInput, ctx: SubmitCtx): Promise<{ id: string; merged: boolean; count: number; notified: { app: number; mail: boolean } }> {
  const open = await findOpenFeature(input.title)
  const entry = { requesterId: ctx.userId, roomId: ctx.roomId ?? null, runId: ctx.runId ?? null, detail: input.detail, attempted: input.attempted || null }
  const saved = open
    ? await prisma.featureRequest.update({
        where: { id: open.id },
        data: { count: { increment: 1 }, entries: { create: entry } },
        select: { id: true, count: true, title: true },
      })
    : await prisma.featureRequest.create({
        data: { key: featureKey(input.title), title: input.title, entries: { create: entry } },
        select: { id: true, count: true, title: true },
      })

  const merged = Boolean(open)
  const head = merged ? `기능 요청 (같은 요청 ${saved.count}번째): ${saved.title}` : `새 기능 요청: ${saved.title}`
  const roomPath = ctx.roomId ? `/chat/${ctx.roomId}` : null

  let app = 0
  for (const id of await developerIds()) {
    try {
      // entityId 를 묶음 id 로 — 같은 묶음 알림은 기기에서 서로 덮는다
      await createNotification(id, FEATURE_NOTIFY_TYPE, head, `${ctx.userName}: ${input.detail.slice(0, 120)}`, saved.id)
      app++
    } catch (err) {
      console.error("[feature-request] 알림 실패", err)
    }
  }
  const mail = await sendAlertMail(
    `[Omnis] ${head}`,
    [
      head,
      "",
      `요청한 사람: ${ctx.userName}`,
      `필요한 것: ${input.detail}`,
      `옴니스가 해 본 것: ${input.attempted || "(없음)"}`,
      roomPath ? `대화: ${ctx.base ?? ""}${roomPath} (요청한 사람만 열 수 있습니다)` : "",
      `관리: ${ctx.base ?? ""}${FEATURE_ADMIN_PATH}`,
    ].filter((l) => l !== "").join("\n"),
  )
  if (!mail.sent && mail.reason === "failed") console.error("[feature-request] 메일 실패", mail.detail)
  return { id: saved.id, merged, count: saved.count, notified: { app, mail: mail.sent } }
}

export interface FeatureRow {
  id: string
  title: string
  status: FeatureStatus
  count: number
  createdAt: Date
  updatedAt: Date
  entries: { id: string; detail: string; attempted: string | null; roomId: string | null; createdAt: Date; requester: { name: string } }[]
}

/** 관리 화면 목록 — 새로 · 검토 먼저, 최근 순 */
export async function listFeatureRequests(): Promise<FeatureRow[]> {
  const rows = await prisma.featureRequest.findMany({
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    include: { entries: { orderBy: { createdAt: "desc" }, take: 20, include: { requester: { select: { name: true } } } } },
  })
  const rank: Record<string, number> = { NEW: 0, REVIEW: 1, DONE: 2 }
  return rows
    .map((r) => ({ ...r, status: (isFeatureStatus(r.status) ? r.status : "NEW") as FeatureStatus }))
    .sort((a, b) => rank[a.status] - rank[b.status])
}
