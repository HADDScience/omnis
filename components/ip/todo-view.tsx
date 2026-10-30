"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ip/page-header"
import { StatusBadge, StaleDays } from "@/components/ip/status-badge"
import { TaskDialog } from "@/components/ip/task-dialog"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { useToday } from "@/hooks/ip/use-today"
import { detect } from "@/lib/ip/detect"
import { setNextTurn } from "@/lib/ip/db"
import { daysBetween, formatDate } from "@/lib/ip/date"
import { cn } from "@/lib/utils"
import type { ProgressEntry } from "@/lib/ip/types"

/**
 * 내 차례 — "지금 뭐가 밀렸지"에 답하는 화면.
 *
 * 미결 액션을 따로 등록하지 않는다. 기록의 「다음 차례」가 곧 목록이 된다.
 * 회신을 기록하면 그 건은 저절로 사라진다.
 */
export function TodoView() {
  const today = useToday()
  const { trademarks, patents, progress, refresh } = useData()
  const { canWrite } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  // 상세를 연 기록. 객체가 아니라 id 로 들고 있어야 저장 뒤에도 최신 값을 본다.
  const [picked, setPicked] = useState<string | null>(null)

  const label = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of trademarks) map.set(`trademark:${t.id}`, t.name)
    for (const p of patents) map.set(`patent:${p.id}`, p.title)
    return map
  }, [trademarks, patents])

  // 건마다 가장 최근 기록만 본다. 옛 기록의 「회신 필요」는 이미 지나간 상태다.
  // 값 정정(source='edit')은 누구 차례인지에 대해 아무 말도 하지 않는다.
  // 그것까지 최신으로 치면 정정 한 번에 밀린 일이 목록에서 사라진다.
  const latest = useMemo(() => {
    const map = new Map<string, ProgressEntry>()
    for (const e of progress) {
      if (e.source === "edit") continue
      const k = `${e.entityKind}:${e.entityId}`
      const cur = map.get(k)
      if (!cur || e.date > cur.date) map.set(k, e)
    }
    return [...map.values()]
  }, [progress])

  const ours = latest
    .filter((e) => e.nextTurn === "us")
    .sort(
      (a, b) =>
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.date.localeCompare(b.date)
    )
  const theirs = latest
    .filter((e) => e.nextTurn === "firm")
    .sort((a, b) => a.date.localeCompare(b.date))

  const issues = useMemo(
    () => detect(trademarks, patents, today),
    [trademarks, patents, today]
  )
  const stale = issues.filter((i) => i.key.startsWith("stale:"))
  const mismatch = issues.filter((i) => !i.key.startsWith("stale:"))

  async function handOver(id: string) {
    setBusy(id)
    try {
      await setNextTurn(id, "none")
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-tutorial="todo" className="flex flex-col gap-4">
      <PageHeader
        title="밀린 IP 업무"
        description="회신·제출이 걸린 건, 오래 멈춘 건, 값이 안 맞는 건입니다."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="회신 필요"
          value={ours.length}
          tone={ours.length > 0 ? "danger" : undefined}
        />
        <Stat label="상대 회신 대기" value={theirs.length} />
        <Stat
          label="오래 멈춤"
          value={stale.length}
          tone={stale.length > 0 ? "warn" : undefined}
        />
        <Stat
          label="확인 필요"
          value={mismatch.length}
          tone={mismatch.length > 0 ? "warn" : undefined}
        />
      </div>

      <Card className={ours.length > 0 ? "ring-red-500/25" : undefined}>
        <CardHeader>
          <CardTitle>회신 필요 {ours.length}건</CardTitle>
          <CardDescription>
            항목을 누르면 주고받은 메일과 이 건의 값을 함께 볼 수 있습니다.
            회신을 기록하면 목록에서 저절로 빠집니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border/60">
          {ours.length === 0 ? (
            <p className="py-4 text-muted-foreground">밀린 일이 없습니다.</p>
          ) : (
            ours.map((e) => {
              const over = e.dueOn && e.dueOn < today
              return (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${label.get(`${e.entityKind}:${e.entityId}`) ?? e.entityId} 상세 보기`}
                  onClick={() => setPicked(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter" && ev.key !== " ") return
                    ev.preventDefault()
                    setPicked(e.id)
                  }}
                  className="-mx-2 flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 px-2 py-2.5 transition-colors first:pt-0 hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <StatusBadge status={e.stage} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {label.get(`${e.entityKind}:${e.entityId}`) ?? e.entityId}
                  </span>
                  {e.dueOn ? (
                    <Badge
                      className={cn(
                        over
                          ? "bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      기한 {formatDate(e.dueOn)}
                      {over ? " 지남" : ""}
                    </Badge>
                  ) : null}
                  <span className="shrink-0 text-[12px]">
                    <StaleDays days={daysBetween(e.date, today)} />
                  </span>
                  {e.note ? (
                    <p className="w-full text-[12px] text-muted-foreground">
                      {e.note}
                    </p>
                  ) : null}
                  {canWrite ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy === e.id}
                      onClick={(ev) => {
                        // 줄 전체가 상세를 여는 자리라 여기서 멈춘다.
                        ev.stopPropagation()
                        void handOver(e.id)
                      }}
                    >
                      처리함
                    </Button>
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {theirs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>상대 회신 대기 {theirs.length}건</CardTitle>
            <CardDescription>
              오래 걸리면 독촉할 때입니다. 항목을 누르면 주고받은 메일을 볼 수
              있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border/60">
            {theirs.map((e) => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                aria-label={`${label.get(`${e.entityKind}:${e.entityId}`) ?? e.entityId} 상세 보기`}
                onClick={() => setPicked(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter" && ev.key !== " ") return
                  ev.preventDefault()
                  setPicked(e.id)
                }}
                className="-mx-2 flex cursor-pointer flex-wrap items-center gap-x-2.5 px-2 py-2 transition-colors first:pt-0 hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                <StatusBadge status={e.stage} />
                <span className="min-w-0 flex-1 truncate">
                  {label.get(`${e.entityKind}:${e.entityId}`) ?? e.entityId}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {e.counterpart}
                </span>
                <span className="shrink-0 text-[12px]">
                  <StaleDays days={daysBetween(e.date, today)} />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className={mismatch.length > 0 ? "ring-amber-500/30" : undefined}>
        <CardHeader>
          <CardTitle>확인 필요 {mismatch.length}건</CardTitle>
          <CardDescription>
            입력된 정보 중에 정합성이 깨지는 부분입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border/60">
          {mismatch.length === 0 ? (
            <p className="py-4 text-muted-foreground">안 맞는 값이 없습니다.</p>
          ) : (
            mismatch.map((i) => (
              <div
                key={i.key}
                className="flex flex-wrap items-baseline gap-x-2 py-2 first:pt-0"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    i.level === "error" ? "bg-red-500" : "bg-amber-500"
                  )}
                  aria-hidden
                />
                <span className="font-medium">{i.title}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {i.detail}
                </span>
                <Link
                  // 어느 줄인지 함께 넘긴다. IP 화면이 그 줄을 잠깐 반짝여 준다.
                  href={`/ip/register?kind=${i.kind}&focus=${i.ids[0]}`}
                  className="shrink-0 text-primary hover:underline"
                >
                  IP에서 보기
                </Link>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {stale.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>오래 멈춘 건 {stale.length}건</CardTitle>
            <CardDescription>마지막 진행 후 90일이 넘었습니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border/60">
            {stale.map((i) => (
              <div
                key={i.key}
                className="flex flex-wrap items-baseline gap-x-2 py-2 first:pt-0"
              >
                <span className="font-medium">{i.title}</span>
                <span className="text-muted-foreground">{i.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <TaskDialog entryId={picked} onClose={() => setPicked(null)} />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "danger" | "warn"
}) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-[12px] text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-0.5 font-heading text-2xl font-semibold tabular-nums",
            tone === "danger" && value > 0 && "text-red-600 dark:text-red-400",
            tone === "warn" && value > 0 && "text-amber-600 dark:text-amber-400"
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
