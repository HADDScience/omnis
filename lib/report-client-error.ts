
import { apiUrl } from "@/lib/base-path"
import { noteAttachFailed } from "@/lib/ui-metrics/client"
import { drainQueue, enqueueReport } from "@/lib/nav-rescue"

const store = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * /api/errors 로 보낸다. 오프라인이거나 보내다 실패하면 줄에 담아 두었다가 online 때 보낸다
 * (flushQueuedReports) — 와이파이가 끊긴 동안 생긴 실패가 가장 알고 싶은 것인데, 그때는 보낼 수 없다.
 */
function post(payload: Record<string, unknown>): void {
  const queued = { ...payload, message: String(payload.message ?? ""), at: Date.now() }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueueReport(store(), queued)
    return
  }
  try {
    void fetch(apiUrl("/api/errors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => enqueueReport(store(), queued))
  } catch {
    // 여기서까지 터지면 할 수 있는 게 없다
  }
}

/** 줄에 쌓인 보고를 보낸다 — 앱이 뜰 때와 online 이벤트 때 부른다. 언제 생긴 일인지(occurredAt)를 붙인다 */
export function flushQueuedReports(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return
  for (const { at, ...rest } of drainQueue(store()))
    post({ ...rest, occurredAt: new Date(at).toISOString() })
}

/**
 * 탭 이동이 막힌 것 — Next 의 RSC 요청 실패(문서 이동으로 바뀜). 화면은 살아 있어 error boundary 가 잡지 않는다.
 * 서버는 로그에만 남긴다(오프라인이 될 때마다 생겨 메일 · 이슈로는 보내지 않는다).
 */
export function reportNavFailure(message: string): void {
  post({
    kind: "nav_failed",
    message,
    url: typeof window === "undefined" ? undefined : window.location.href,
    scope: "page",
  })
}

/**
 * 화면에서 터진 오류를 서버로 보낸다. 서버가 로그를 남기고 메일을 쏜다.
 *
 * 실패해도 조용히 넘어간다 — 오류를 보고하다 또 터지면 사용자에게 보이는 것은
 * 여전히 흰 화면이다.
 */
export function reportClientError(
  error: Error & { digest?: string },
  scope: "global" | "page"
): void {
  post({
    message: error.message || "알 수 없는 오류",
    stack: error.stack?.slice(0, 8000),
    digest: error.digest,
    url: typeof window === "undefined" ? undefined : window.location.href,
    scope,
  })
}

/** 화면은 살아 있지만 사람의 일이 막힌 경우. 흰 화면과 달리 error boundary 가 잡지 않는다. */
export type IncidentKind = "upload_too_large" | "upload_failed" | "send_failed"

/**
 * 첨부·전송이 막힌 것을 서버로 보낸다(2026-09-17). 서버가 메일을 쏘고 GitHub 이슈에 모은다.
 *
 * 4MB 넘는 첨부는 Vercel 이 함수에 닿기 전에 끊어 서버 로그에 아무것도 남지 않았다 —
 * 사용자가 알려 주기 전까지 몰랐다. 화면만 아는 실패는 화면이 알린다.
 *
 * fileName 은 메일에만 들어간다. 이슈 저장소가 공개라 파일명·사람 이름은 이슈에 적지 않는다.
 */
export function reportIncident(incident: {
  kind: IncidentKind
  message: string
  status?: number
  size?: number
  fileName?: string
}): void {
  // 사용 기록에는 상태 코드만 — 파일 이름 · 메시지는 넘기지 않는다
  if (incident.kind !== "send_failed") noteAttachFailed(incident.status)
  post({
    ...incident,
    url: typeof window === "undefined" ? undefined : window.location.href,
    scope: "page",
  })
}
