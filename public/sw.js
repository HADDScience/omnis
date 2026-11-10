/*
 * Omnis service worker — 푸시를 받아 기기 알림으로 띄우는 일만 한다.
 *
 * 오프라인 캐시는 넣지 않는다. 캐시는 배포한 코드와 화면이 어긋나는 사고를 부르고,
 * 여기서 필요한 것은 "탭이 닫혀 있어도 알림이 온다" 하나뿐이다.
 *
 * 이 파일은 빌드를 거치지 않고 public/ 에서 그대로 나간다 — 문법은 옛 브라우저가 아니라
 * service worker 를 지원하는 브라우저 기준이면 된다.
 */

// 새로 배포된 worker 가 탭을 닫을 때까지 기다리지 않게 한다.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "Omnis", body: event.data.text() }
  }

  // registration.scope 가 곧 앱의 뿌리다 — basePath(/omnis)로 떠 있어도 여기서 맞는 주소가 나온다.
  const scope = self.registration.scope
  const url = payload.url ? new URL(payload.url.replace(/^\//, ""), scope).href : scope

  // 받은 것은 띄우지 않을 때(그 방을 보는 중)도 받은 것이다 — 수신율에 넣는다. 알림을 기다리게 하지 않고 나란히 보낸다
  const received = reportPushTiming("push_recv_s", payload)

  event.waitUntil(Promise.all([received, show()]))

  async function show() {
    // 그 방을 지금 보고 있으면 띄우지 않는다 — 화면에 이미 글이 올라온다(채팅 글 · 옴니스 답 · 멘션).
    // 「보고 있다」 = 포커스된 창의 주소가 그 방 주소다. 다른 탭 · 백그라운드 창은 보고 있지 않은 것이다.
    if (payload.roomPath && (await isViewing(new URL(payload.roomPath.replace(/^\//, ""), scope).pathname))) return

    await self.registration.showNotification(payload.title || "Omnis", {
      body: payload.body || "",
      icon: new URL("icon-192.png", scope).href,
      // 같은 tag 는 서로를 덮어쓴다. 같은 업무 · 같은 방 알림이 잠금화면에 쌓이지 않게 한다.
      tag: payload.tag,
      // 채팅은 같은 방의 새 글이 앞 알림을 덮을 때도 다시 울린다. tag 가 없으면 브라우저가 거부한다
      renotify: Boolean(payload.tag && payload.renotify),
      data: { url, sentAt: payload.sentAt, sha: payload.sha },
    })
  }
})

/**
 * 시범 운영 측정 — 서버가 보낸 시각(payload.sentAt)에서 몇 초 뒤에 받았는지 · 눌렀는지만 보낸다.
 * 서버가 측정을 켠 배포에서만 sentAt 이 실린다. 기기 시계가 서버와 어긋나면 값도 어긋난다 — 음수는 0 으로 둔다.
 * 실패는 버린다. 알림을 띄우는 일이 이것 때문에 늦거나 막히면 안 된다.
 */
function reportPushTiming(name, meta) {
  if (!meta || typeof meta.sentAt !== "number") return Promise.resolve()
  const value = Math.min(Math.max(0, Math.round((Date.now() - meta.sentAt) / 1000)), 1_800_000)
  const sha = typeof meta.sha === "string" && /^([0-9a-f]{7,40}|dev)$/.test(meta.sha) ? meta.sha : "dev"
  return fetch(new URL("api/ui-metrics/events", self.registration.scope).href, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha, events: [{ name, value, path: "/push" }] }),
  }).then(
    () => undefined,
    () => undefined
  )
}

const trimSlash = (path) => (path.length > 1 ? path.replace(/\/+$/, "") : path)

async function isViewing(pathname) {
  const target = trimSlash(pathname)
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  return windows.some(
    (client) => client.focused && client.visibilityState === "visible" && trimSlash(new URL(client.url).pathname) === target
  )
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const target = data.url || self.registration.scope
  const opened = reportPushTiming("push_open_s", data)

  // 이미 열린 Omnis 창이 있으면 새 창을 띄우지 않고 그 창을 옮긴다 —
  // 알림을 누를 때마다 탭이 늘어나면 쓰던 화면을 잃는다.
  event.waitUntil(
    Promise.all([
      opened,
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.startsWith(self.registration.scope) && "focus" in client) {
            return client.focus().then((focused) => focused.navigate(target))
          }
        }
        return self.clients.openWindow(target)
      }),
    ])
  )
})
