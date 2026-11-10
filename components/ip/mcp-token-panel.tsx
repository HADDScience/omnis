"use client"

import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { CopyRow } from "@/components/ip/copy-row"
import { formatDate } from "@/lib/ip/date"
import { currentMcpToken, reissueMcpToken, type McpToken } from "@/lib/ip/db"

/**
 * MCP 토큰 — 한 사람에 하나.
 *
 * 여러 개를 두지 않는 이유: 토큰은 권한을 담지 않아 어느 것이든 그 사람의 역할
 * 그대로다. 하나가 새면 전부 샌 것과 같아서 나눠 둘 실익이 없다. 그래서 발급·폐기
 * 대신 **재발급** 하나만 둔다 — 새로 받으면 쓰던 것이 즉시 죽는다.
 *
 * 원문은 DB 에 남기지 않는다(해시만 저장). 그래서 「매번 같은 토큰을 다시 본다」는
 * 것은 이 설계에서 불가능하고, 대신 **다시 받는 일을 싸게** 만든다 — 버튼 한 번에
 * 발급되고 그 즉시 클립보드에 들어가며, 창이 열려 있는 동안은 값을 그대로 다시
 * 복사할 수 있다. 잃어버렸을 때 해야 할 일이 「한 번 더 누르기」면 충분하다.
 */
export function McpTokenPanel({
  onToken,
}: {
  /** 방금 발급한 원문. 설치 커맨드에 끼워 넣을 수 있게 위로 올린다. */
  onToken: (token: string | null) => void
}) {
  const [token, setToken] = useState<McpToken | null | undefined>(undefined)
  /** 방금 발급한 원문. 창을 닫으면 사라진다 — 어디에도 저장하지 않는다. */
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let cancelled = false
    currentMcpToken()
      .then((t) => {
        if (!cancelled) setToken(t)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [round])

  async function reissue() {
    setBusy(true)
    setError(null)
    try {
      const raw = await reissueMcpToken()
      onToken(raw)
      setSecret(raw)
      setRound((n) => n + 1)
      // 발급과 동시에 클립보드에 넣는다. 어차피 다음 동작이 「복사」 하나뿐인데
      // 한 번 더 누르게 할 이유가 없다. 막힌 환경이면 아래 칸에서 손으로 가져간다.
      try {
        await navigator.clipboard.writeText(raw)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2500)
      } catch {
        // 클립보드가 막힌 환경(비 HTTPS 등).
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-border/60 px-4 pb-3">
      {secret ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-1.5 bg-amber-500/10 p-2.5 text-[12px]/relaxed text-amber-700 dark:text-amber-300">
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={2}
              className="mt-0.5 size-3.5 shrink-0"
            />
            <span>
              {copied ? "새 토큰을 복사했습니다. " : "새 토큰입니다. "}
              아래 커맨드에도 이미 들어가 있습니다.{" "}
              <b>이 창을 닫으면 다시 볼 수 없습니다</b> — 잃어버리면 다시 누르면
              되지만, 그때는 붙여 두었던 도구를 모두 다시 설정해야 합니다. 쓰던
              토큰은 방금 죽었습니다.
            </span>
          </div>
          {/* 커맨드에 섞인 값 말고 토큰만 필요한 곳(ChatGPT·수동 설정)이 있다. */}
          <CopyRow text={secret} label="토큰 복사" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12px] text-muted-foreground">
            {token === undefined
              ? "확인 중…"
              : token === null
                ? "토큰이 없습니다. 발급해야 AI 도구가 우리 기록을 읽고 쓸 수 있습니다."
                : `발급됨 · ${token.prefix}… · ${
                    token.lastUsedAt
                      ? `마지막 사용 ${formatDate(token.lastUsedAt.slice(0, 10))}`
                      : "아직 쓰이지 않음"
                  }`}
          </span>
          <Button
            size="xs"
            variant={token ? "outline" : "default"}
            disabled={busy || token === undefined}
            className="ml-auto"
            onClick={() => void reissue()}
          >
            {busy ? "발급 중…" : token ? "재발급" : "토큰 발급"}
          </Button>
        </div>
      )}

      {error ? (
        <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
