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
  try {
    void fetch("/api/errors", {
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
