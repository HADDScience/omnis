/**
 * 브라우저 쪽 PWA·푸시 배관. 클라이언트에서만 부른다.
 *
 * 여기 있는 사실들이 화면 문구를 정한다:
 *   - iOS 는 **홈 화면에 추가한 뒤에야** 푸시를 준다 (16.4+). 탭에서는 `Notification` 이 없다
 *   - iOS 에는 `beforeinstallprompt` 가 없다 — 설치를 코드로 띄울 수 없고 사람이 공유 시트를 연다
 *   - 그래서 설치와 권한은 한 버튼으로 묶을 수 없고 두 단계로 나뉜다
 */
import { apiUrl } from "@/lib/base-path"

/** `beforeinstallprompt` 이벤트. 표준 타입이 아직 없어 필요한 만큼만 적는다. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

declare global {
  interface Window {
    __omnisInstallPrompt?: InstallPromptEvent
  }
}

/**
 * 잡아 둔 설치 이벤트를 나눠 쓰는 자리.
 *
 * `beforeinstallprompt` 는 **페이지가 뜰 때 한 번** 오고, 그때 preventDefault 로 잡아 두지
 * 않으면 사라진다. 설정 화면이 그 뒤에 열리므로 컴포넌트에서 듣기 시작하면 이미 늦다.
 * 그래서 layout 의 인라인 스크립트가 window 에 담아 두고(`__omnisInstallPrompt`), 여기서 꺼낸다.
 */
const listeners = new Set<() => void>()

export function getInstallPrompt(): InstallPromptEvent | null {
  if (typeof window === "undefined") return null
  return window.__omnisInstallPrompt ?? null
}

export function setInstallPrompt(event: InstallPromptEvent | null) {
  if (typeof window === "undefined") return
  if (event) window.__omnisInstallPrompt = event
  else delete window.__omnisInstallPrompt
  listeners.forEach((fn) => fn())
}

export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 홈 화면에서 연 상태인가. iOS 는 표준 display-mode 대신 navigator.standalone 을 쓴다. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iOS·iPadOS 인가. iPadOS 는 데스크톱 Safari 로 위장하므로 터치 지원으로 가른다. */
export function isIos(): boolean {
  if (typeof window === "undefined") return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null
  try {
    // scope 를 basePath 로 맞춘다 — /omnis 아래로 뜰 때 루트 scope 는 브라우저가 거부한다.
    return await navigator.serviceWorker.register(apiUrl("/sw.js"), { scope: apiUrl("/") })
  } catch (err) {
    console.error("[pwa] service worker 등록 실패", err)
    return null
  }
}

/**
 * VAPID 공개 키(base64url)를 applicationServerKey 가 받는 바이트 배열로.
 *
 * 반환 타입을 ArrayBuffer 로 두는 것은 lib.dom 의 BufferSource 가 SharedArrayBuffer 를
 * 허용하지 않기 때문이다 — Uint8Array 를 그대로 주면 타입이 맞지 않는다.
 */
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration(apiUrl("/"))
  return (await registration?.pushManager.getSubscription()) ?? null
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "failed" }

/**
 * 권한을 묻고, 구독해서, 서버에 등록한다.
 *
 * 권한 요청은 **사용자가 버튼을 누른 흐름 안에서만** 통한다. 페이지 로드 중에 부르면
 * 브라우저가 조용히 거부한다. 그래서 여기를 자동 실행하지 않는다.
 */
export async function subscribeToPush(publicKey: string): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") return { ok: false, reason: "denied" }

  try {
    const registration = (await navigator.serviceWorker.getRegistration(apiUrl("/")))
      ?? (await registerServiceWorker())
    if (!registration) return { ok: false, reason: "failed" }
    await navigator.serviceWorker.ready

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      }))

    const res = await fetch(apiUrl("/api/push/subscriptions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    })
    return res.ok ? { ok: true } : { ok: false, reason: "failed" }
  } catch (err) {
    console.error("[pwa] 푸시 구독 실패", err)
    return { ok: false, reason: "failed" }
  }
}

/** 이 기기의 구독만 해제한다. 다른 기기는 그대로 알림을 받는다. */
export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await currentSubscription()
  if (!subscription) return true
  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => {})
  const res = await fetch(apiUrl(`/api/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`), {
    method: "DELETE",
  })
  return res.ok
}
