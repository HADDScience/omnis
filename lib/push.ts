/**
 * 웹 푸시 발송.
 *
 * 알림은 `Notification` 행으로 쌓이지만, 지금까지 사람에게 닿는 길은 벨의 15초 폴링뿐이었다 —
 * **탭이 열려 있고 보이는 동안에만** 보인다. 여기가 탭이 닫혀 있어도 닿는 두 번째 길이다.
 *
 * 필요한 환경변수 — 하나라도 없으면 푸시는 건너뛴다. 알림 자체는 그대로 만들어진다.
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  브라우저가 구독할 때 쓰는 공개 키 (번들에 실린다)
 *   VAPID_PRIVATE_KEY             서명용 비밀 키
 *   VAPID_SUBJECT                 mailto: 또는 https: — 푸시 서비스가 문제 시 연락할 곳
 */
import { appendFile } from "node:fs/promises"
import webpush from "web-push"

import { prisma } from "@/lib/db"
import { PREF_FIELD, pushAllowed, type NotifyCategory } from "@/lib/notify-rules"

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  )
}

let configured = false

function configure() {
  if (configured) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
  configured = true
}

export interface PushPayload {
  title: string
  body?: string
  /** 알림을 눌렀을 때 열 앱 내부 경로. basePath 는 service worker 가 붙인다. */
  url?: string
  /** 같은 tag 는 기기에서 서로를 덮어쓴다 — 같은 업무 알림이 쌓이지 않게 한다. */
  tag?: string
  /** 같은 tag 로 덮어쓸 때도 다시 울린다(채팅 — 같은 방의 새 글) */
  renotify?: boolean
  /** 이 알림이 가리키는 방 주소. 그 주소를 포커스된 창이 보고 있으면 service worker 가 띄우지 않는다 */
  roomPath?: string
}

/** 이 사람들 중 이 종류의 푸시를 끈 사람 — 행이 없으면 켜짐이라 끈 행만 읽는다 */
export async function pushOffUserIds(userIds: string[], category: NotifyCategory): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await prisma.notificationPref.findMany({
    where: { userId: { in: userIds }, [PREF_FIELD[category]]: false },
    select: { userId: true, chatPush: true, taskPush: true, calendarPush: true },
  })
  return new Set(rows.filter((r) => !pushAllowed(r, category)).map((r) => r.userId))
}

export type PushResult = { sent: number; removed: number; skipped?: "unconfigured" | "dry_run" | "pref_off" }

/**
 * 한 사람의 모든 기기로 보낸다. category 를 주면 그 사람의 종류 설정을 먼저 본다 — 끈 종류면 보내지 않는다
 * (벨 행은 호출한 쪽이 이미 만들었다. 끄면 푸시만 멈춘다).
 *
 * 404·410 은 그 구독이 죽었다는 푸시 서비스의 통보다 (브라우저 재설치 · 알림 끔 · 만료).
 * 그때 지우지 않으면 죽은 구독이 계속 쌓여 발송이 매번 실패한다 — iOS 는 한동안 앱을
 * 열지 않으면 구독을 버리므로 특히 자주 일어난다.
 *
 * 실패는 던지지 않는다. 푸시가 안 갔다고 알림 생성이나 업무 처리가 막히면 안 된다.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  category: NotifyCategory | null = null
): Promise<PushResult> {
  if (category && (await pushOffUserIds([userId], category)).has(userId)) {
    await recordPush([userId], payload, category, "pref_off")
    return { sent: 0, removed: 0, skipped: "pref_off" }
  }
  return deliverPush([userId], payload, category)
}

/**
 * 여러 사람에게 같은 내용을 보낸다 — 받는 사람을 이미 거른 채로 부른다(종류 설정은 보지 않는다).
 * 사람 수와 상관없이 구독 질의는 한 번이고, 발송만 병렬이다. 전사방 글 하나에 수십 명이어도 같다.
 */
export async function deliverPush(
  userIds: string[],
  payload: PushPayload,
  category: NotifyCategory | null = null
): Promise<PushResult> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return { sent: 0, removed: 0 }
  if (process.env.PUSH_DRY_RUN === "1") {
    await recordPush(ids, payload, category, "dry_run")
    return { sent: 0, removed: 0, skipped: "dry_run" }
  }
  if (!pushConfigured()) {
    await recordPush(ids, payload, category, "unconfigured")
    return { sent: 0, removed: 0, skipped: "unconfigured" }
  }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: ids } } })
  await recordPush(ids, payload, category, "sent", subscriptions.length)
  if (subscriptions.length === 0) return { sent: 0, removed: 0 }

  configure()
  const body = JSON.stringify(payload)

  let sent = 0
  const dead: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          // 채팅은 한 시간이 지나면 늦은 소식이다 — 하루 묵혀 한꺼번에 울리지 않게. 업무 · 일정은 하루
          { TTL: category === "chat" ? 60 * 60 : 60 * 60 * 24, timeout: 10_000 }
        )
        sent += 1
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          dead.push(sub.id)
          return
        }
        console.error("[push] 발송 실패", { endpoint: sub.endpoint.slice(0, 40), status })
      }
    })
  )

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } })
  }

  return { sent, removed: dead.length }
}

/**
 * 발송 기록 — 「누구에게 무엇이 나갔는가」. 실제 수신은 브라우저 자동화로 보기 어려워 이것으로 검증한다.
 *   PUSH_LOG_FILE=<경로>  한 사람에 한 줄(JSON)씩 덧붙인다 — 검증 스크립트가 읽는다
 *   PUSH_DRY_RUN=1        푸시 서비스에 보내지 않고 기록만 한다. 로컬 DB 는 운영 스냅샷이라 실제 구독이 들어 있다
 */
async function recordPush(
  userIds: string[],
  payload: PushPayload,
  category: NotifyCategory | null,
  outcome: "sent" | "dry_run" | "unconfigured" | "pref_off",
  devices?: number
) {
  const file = process.env.PUSH_LOG_FILE
  if (!file && outcome !== "dry_run") return
  const at = new Date().toISOString()
  const lines = userIds.map((userId) =>
    JSON.stringify({ at, userId, category, outcome, title: payload.title, body: payload.body, tag: payload.tag, url: payload.url, roomPath: payload.roomPath, devices })
  )
  if (!file) {
    console.info(`[push:${outcome}] ${userIds.length}명 · ${category ?? "-"} · ${payload.title}`)
    return
  }
  await appendFile(file, lines.join("\n") + "\n").catch((err) => console.error("[push] 기록 실패", err))
}
