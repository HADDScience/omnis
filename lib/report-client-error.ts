
import { apiUrl } from "@/lib/base-path"/**
 * 화면에서 터진 오류를 서버로 보낸다. 서버가 로그를 남기고 메일을 쏜다.
 *
 * 실패해도 조용히 넘어간다 — 오류를 보고하다 또 터지면 사용자에게 보이는 것은
 * 여전히 흰 화면이다.
 */
export function reportClientError(
  error: Error & { digest?: string },
  scope: "global" | "page"
): void {
  try {
    void fetch(apiUrl("/api/errors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message || "알 수 없는 오류",
        stack: error.stack?.slice(0, 8000),
        digest: error.digest,
        url: typeof window === "undefined" ? undefined : window.location.href,
        scope,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 여기서까지 터지면 할 수 있는 게 없다
  }
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
  try {
    void fetch(apiUrl("/api/errors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...incident,
        url: typeof window === "undefined" ? undefined : window.location.href,
        scope: "page",
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 알리다 터져도 사용자의 일을 더 막지 않는다
  }
}
