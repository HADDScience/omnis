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

  event.waitUntil(
    self.registration.showNotification(payload.title || "Omnis", {
      body: payload.body || "",
      icon: new URL("icon-192.png", scope).href,
      // 같은 tag 는 서로를 덮어쓴다. 같은 업무 알림이 잠금화면에 쌓이지 않게 한다.
      tag: payload.tag,
      data: { url },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope

  // 이미 열린 Omnis 창이 있으면 새 창을 띄우지 않고 그 창을 옮긴다 —
  // 알림을 누를 때마다 탭이 늘어나면 쓰던 화면을 잃는다.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && "focus" in client) {
          return client.focus().then((focused) => focused.navigate(target))
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
