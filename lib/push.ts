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
import webpush from "web-push"

import { prisma } from "@/lib/db"

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
}

/**
 * 한 사람의 모든 기기로 보낸다.
 *
 * 404·410 은 그 구독이 죽었다는 푸시 서비스의 통보다 (브라우저 재설치 · 알림 끔 · 만료).
 * 그때 지우지 않으면 죽은 구독이 계속 쌓여 발송이 매번 실패한다 — iOS 는 한동안 앱을
 * 열지 않으면 구독을 버리므로 특히 자주 일어난다.
 *
 * 실패는 던지지 않는다. 푸시가 안 갔다고 알림 생성이나 업무 처리가 막히면 안 된다.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; removed: number; skipped?: "unconfigured" }> {
  if (!pushConfigured()) return { sent: 0, removed: 0, skipped: "unconfigured" }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
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
          { TTL: 60 * 60 * 24 }
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
