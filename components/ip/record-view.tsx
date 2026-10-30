"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ip/page-header"
import { McpInstall } from "@/components/ip/mcp-install"
import { ProgressForm } from "@/components/ip/progress-form"
import { StatusBadge } from "@/components/ip/status-badge"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { removeProgress } from "@/lib/ip/db"
import { formatDate } from "@/lib/ip/date"
import { NEXT_TURN_LABEL } from "@/lib/ip/types"
import type { ProgressEntry } from "@/lib/ip/types"

/**
 * 기록하기 — 오른쪽 아래 「기록하기」 창의 「최근 기록 보기」로 들어온다.
 * 새 기록은 어느 화면에서든 그 창으로 남기고, 여기서는 지난 기록을 고치거나 지운다.
 *
 * 양식 하나와 최근 기록만 있다. 지식재산권 목록 편집·커뮤니케이션·액션 입력창은 전부 여기로 합쳐졌다.
 * 메일 붙여넣기는 이 양식을 여러 장 미리 채워주는 실험적 도구라 버튼으로만 걸어 둔다.
 */
export function RecordView() {
  const { progress, trademarks, patents, refresh } = useData()
  const { canWrite } = useAuth()
  const [editing, setEditing] = useState<ProgressEntry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const label = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of trademarks) map.set(`trademark:${t.id}`, t.name)
    for (const p of patents) map.set(`patent:${p.id}`, p.title)
    return map
  }, [trademarks, patents])

  async function drop(id: string) {
    setBusy(id)
    try {
      await removeProgress(id)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="기록하기"
        description="언제 · 어느 건이 · 어디까지 갔고 · 이제 누구 차례인지. IP 현황은 이 기록에서 자동으로 갱신됩니다."
      />

      <Card data-tutorial="record-form">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
              {editing ? "기록 수정" : "새 기록"}
            </span>
            <span data-tutorial="mcp">
              <McpInstall />
            </span>
          </div>

          {canWrite ? (
            <ProgressForm
              key={editing?.id ?? "new"}
              initial={editing ?? undefined}
              onSaved={() => setEditing(null)}
              onCancel={editing ? () => setEditing(null) : undefined}
            />
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              읽기 전용 계정입니다.
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 font-heading text-[14px] font-semibold">
          최근 기록 {progress.length > 0 ? `· ${progress.length}건` : ""}
        </h2>

        {progress.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground rounded-xl border bg-card">
            아직 기록이 없습니다. 위에서 첫 기록을 남겨 보세요.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {progress.slice(0, 40).map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2.5"
              >
                <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                  {formatDate(e.date)}
                </span>
                <StatusBadge status={e.stage} />
                <span className="min-w-0 flex-1 truncate">
                  {label.get(`${e.entityKind}:${e.entityId}`) ?? e.entityId}
                </span>

                {e.direction ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {e.direction === "수신"
                      ? `${e.counterpart} → 우리`
                      : `우리 → ${e.counterpart}`}
                  </span>
                ) : null}

                {e.nextTurn !== "none" ? (
                  <Badge
                    className={
                      e.nextTurn === "us"
                        ? "bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {NEXT_TURN_LABEL[e.nextTurn]}
                  </Badge>
                ) : null}

                {e.source !== "manual" ? (
                  <Badge className="bg-muted text-[10px] text-muted-foreground">
                    {e.source === "mail" ? "메일" : "엑셀"}
                  </Badge>
                ) : null}

                {e.note ? (
                  <p className="w-full text-[12px] text-muted-foreground sm:w-auto sm:flex-1 sm:truncate">
                    {e.note}
                  </p>
                ) : null}

                {canWrite ? (
                  <span className="ml-auto flex shrink-0 gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditing(e)}
                    >
                      수정
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy === e.id}
                      className="text-red-600 dark:text-red-400"
                      onClick={() => void drop(e.id)}
                    >
                      삭제
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
