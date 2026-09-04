"use client"

import { useEffect } from "react"
import { reportClientError } from "@/lib/report-client-error"

/**
 * 루트 레이아웃까지 터졌을 때의 마지막 그물. 여기서는 레이아웃이 통째로
 * 대체되므로 html·body 를 직접 그리고, 전역 CSS 가 없다고 가정해 인라인
 * 스타일만 쓴다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError(error, "global")
  }, [error])

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif",
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
            옴니스를 여는 중 문제가 생겼어요
          </h1>
          <p style={{ fontSize: 13, color: "#71717a", marginTop: 8 }}>
            담당자에게 자동으로 알렸습니다. 잠시 후 다시 시도해 주세요.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                color: "#a1a1aa",
                fontFamily: "ui-monospace, monospace",
                marginTop: 8,
              }}
            >
              오류 번호 {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 600,
              color: "#fafafa",
              background: "#18181b",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  )
}
