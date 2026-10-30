"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Timer02Icon } from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ip/page-header"
import { StatusBadge, StaleDays } from "@/components/ip/status-badge"
import { StageOrderDialog } from "@/components/ip/stage-order-dialog"
import { TaskDialog } from "@/components/ip/task-dialog"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { useToday } from "@/hooks/ip/use-today"
import { detect, issuesById, type Issue } from "@/lib/ip/detect"
import { loadStageOrder, saveStageOrder, type StageOrder } from "@/lib/ip/db"
import { daysBetween, formatDate } from "@/lib/ip/date"
import { DEFAULT_STAGE_ORDER, sortByDefault } from "@/lib/ip/stage-order"
import { cn } from "@/lib/utils"
import type { NextTurn, ProgressEntry } from "@/lib/ip/types"

/**
 * 현황 — 기본 진입 화면.
 *
 * 상표·특허를 한 표에 섞고, 건마다 「지금 어디까지 왔고 누구 차례인지」를 한 줄로
 * 붙인다. 밀린 업무 화면을 따로 열지 않아도 손댈 건이 이 표 안에서 보인다.
 *
 * 줄 순서는 단계 묶음(등록 > 출원 > 검토 > 거절·포기)이 기본이고, 단계 차례는
 * 사람마다 바꿔 저장한다. IP 화면의 종류별 차례와는 따로 둔다 — 섞어 보는 표와
 * 종류별 표는 보고 싶은 차례가 다르다.
 */

type Kind = "trademark" | "patent"
type View = "all" | "us" | "firm" | "issue"

interface Row {
  kind: Kind
  id: string
  name: string
  sub: string
  no: string | null
  status: string
  /** 마지막 진행일 */
  date: string | null
  rowNote: string
}

const TURN_RANK: Record<NextTurn, number> = { us: 0, firm: 1, none: 2 }

/** 기록 한 줄 → 「현재 단계 요약」 한 줄 */
function summarize(row: Row, last: ProgressEntry | undefined): string {
  if (!last) return row.rowNote.trim() || "이어받은 뒤 진행 기록 없음"
  const who =
    last.direction === "수신"
      ? `${last.counterpart}에서 받음`
      : last.direction === "송신"
        ? `${last.counterpart}에 보냄`
        : ""
  const what = last.note.trim() || `${last.stage} 단계로 기록`
  return `${formatDate(last.date).slice(2)} ${who ? `${who} — ` : ""}${what}`
}

export function OverviewView() {
  const today = useToday()
  const router = useRouter()
  const { member } = useAuth()
  const { trademarks, patents, progress, stages } = useData()

  const [kind, setKind] = useState<"all" | Kind>("all")
  const [view, setView] = useState<View>("all")
  const [q, setQ] = useState("")
  const [stageOrder, setStageOrder] = useState<StageOrder>({})
  const [orderOpen, setOrderOpen] = useState(false)
  // 상세를 연 기록. 객체가 아니라 id 로 들고 있어야 저장 뒤에도 최신 값을 본다.
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadStageOrder(member.userId)
      .then((o) => {
        if (!cancelled) setStageOrder(o)
      })
      .catch(() => {
        // 취향이 없어도 화면은 돌아야 한다. 기본 묶음 순서로 떨어진다.
      })
    return () => {
      cancelled = true
    }
  }, [member.userId])

  const rows = useMemo<Row[]>(
    () => [
      ...trademarks.map((t) => ({
        kind: "trademark" as const,
        id: t.id,
        name: t.name,
        sub: t.nameKo,
        no: t.regNo ?? t.appNo,
        status: t.status,
        date: t.date,
        rowNote: t.note,
      })),
      ...patents.map((p) => ({
        kind: "patent" as const,
        id: p.id,
        name: p.title,
        sub: "",
        no: p.regNo ?? p.appNo,
        status: p.status,
        date: p.date,
        rowNote: p.note,
      })),
    ],
    [trademarks, patents]
  )

  // 건마다 가장 최근 기록. 차례는 값 정정(source='edit')을 건너뛴 기록에서 읽는다 —
  // 정정은 누구 차례인지에 대해 아무 말도 하지 않는다. 정정밖에 없는 건은
  // 상세를 열 자리로만 정정 기록을 쓴다.
  const latest = useMemo(() => {
    const turn = new Map<string, ProgressEntry>()
    const any = new Map<string, ProgressEntry>()
    const newer = (a: ProgressEntry, b: ProgressEntry | undefined) =>
      !b ||
      a.date > b.date ||
      (a.date === b.date && a.createdAt > b.createdAt)
    for (const e of progress) {
      const k = `${e.entityKind}:${e.entityId}`
      if (newer(e, any.get(k))) any.set(k, e)
      if (e.source !== "edit" && newer(e, turn.get(k))) turn.set(k, e)
    }
    return { turn, any }
  }, [progress])

  const issues = useMemo(
    () => detect(trademarks, patents, today),
    [trademarks, patents, today]
  )
  const byId = useMemo(() => issuesById(issues), [issues])

  /** 기본 차례. 단계표에 없는 옛 값도 표에 나오면 자리를 줘야 한다. */
  const defaultOrder = useMemo(() => {
    const weight = new Map<string, number>()
    for (const s of stages) {
      weight.set(s.value, Math.max(weight.get(s.value) ?? 0, s.sortOrder))
    }
    return sortByDefault(
      [
        ...DEFAULT_STAGE_ORDER,
        ...weight.keys(),
        ...rows.map((r) => r.status),
      ],
      (v) => weight.get(v) ?? 0
    )
  }, [stages, rows])

  const stageRank = useMemo(() => {
    const mine = (stageOrder.overview ?? []).filter((v) =>
      defaultOrder.includes(v)
    )
    const rest = defaultOrder.filter((v) => !mine.includes(v))
    const map = new Map<string, number>()
    ;[...mine, ...rest].forEach((v, i) => map.set(v, i))
    return map
  }, [stageOrder, defaultOrder])

  const turnOf = (r: Row): NextTurn =>
    latest.turn.get(`${r.kind}:${r.id}`)?.nextTurn ?? "none"

  const counts = useMemo(() => {
    let us = 0
    let firm = 0
    let issue = 0
    for (const r of rows) {
      const t = latest.turn.get(`${r.kind}:${r.id}`)?.nextTurn
      if (t === "us") us++
      if (t === "firm") firm++
      if ((byId.get(r.id) ?? []).length > 0) issue++
    }
    return { us, firm, issue }
  }, [rows, latest, byId])

  const needle = q.trim().toLowerCase()

  const visible = rows
    .filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false
      if (view === "us" && turnOf(r) !== "us") return false
      if (view === "firm" && turnOf(r) !== "firm") return false
      if (view === "issue" && (byId.get(r.id) ?? []).length === 0) return false
      if (!needle) return true
      return `${r.name} ${r.sub} ${r.no ?? ""}`.toLowerCase().includes(needle)
    })
    .sort((a, b) => {
      const ra = stageRank.get(a.status) ?? Number.MAX_SAFE_INTEGER
      const rb = stageRank.get(b.status) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      // 같은 단계 안에서는 손댈 것이 먼저, 그다음 기한이 급한 것, 최근 것.
      const ta = TURN_RANK[turnOf(a)]
      const tb = TURN_RANK[turnOf(b)]
      if (ta !== tb) return ta - tb
      const da = latest.turn.get(`${a.kind}:${a.id}`)?.dueOn ?? "9999"
      const db = latest.turn.get(`${b.kind}:${b.id}`)?.dueOn ?? "9999"
      return (
        da.localeCompare(db) ||
        (b.date ?? "").localeCompare(a.date ?? "") ||
        a.id.localeCompare(b.id)
      )
    })

  function openRow(r: Row) {
    const k = `${r.kind}:${r.id}`
    const entry = latest.turn.get(k) ?? latest.any.get(k)
    if (entry) setPicked(entry.id)
    else router.push(`/ip/register?kind=${r.kind}&focus=${r.id}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`지식재산권 현황 ${rows.length}건`}
        description="건마다 지금 어디까지 왔는지와 누구 차례인지입니다. 줄을 누르면 주고받은 메일과 값을 함께 봅니다."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="전체"
          value={rows.length}
          active={view === "all"}
          onClick={() => setView("all")}
        />
        <Stat
          label="회신 필요"
          value={counts.us}
          tone="danger"
          active={view === "us"}
          onClick={() => setView(view === "us" ? "all" : "us")}
        />
        <Stat
          label="상대 회신 대기"
          value={counts.firm}
          active={view === "firm"}
          onClick={() => setView(view === "firm" ? "all" : "firm")}
        />
        <Stat
          label="확인 필요·오래 멈춤"
          value={counts.issue}
          tone="warn"
          active={view === "issue"}
          onClick={() => setView(view === "issue" ? "all" : "issue")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `전체 ${rows.length}`],
              ["trademark", `상표 ${trademarks.length}`],
              ["patent", `특허 ${patents.length}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "touch-target rounded-full border px-3 py-1 text-[12px] transition-colors",
                kind === k
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/70"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·번호로 찾기"
          className="h-8 max-w-56 text-[13px]"
        />

        <button
          type="button"
          onClick={() => setOrderOpen(true)}
          className="ml-auto flex h-8 items-center px-2 text-[13px] text-muted-foreground rounded-md border transition-colors hover:text-foreground"
        >
          단계 순서 설정
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="bg-muted/50 text-[12px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">단계</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">
                현재 단계 요약
              </th>
              <th className="px-3 py-2 text-left font-medium">밀린 업무</th>
              <th className="px-3 py-2 text-right font-medium">마지막 진행</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visible.map((r) => {
              const k = `${r.kind}:${r.id}`
              const last = latest.turn.get(k)
              const summary = summarize(r, last)
              return (
                <tr
                  key={k}
                  tabIndex={0}
                  aria-label={`${r.name} 상세 보기`}
                  onClick={() => openRow(r)}
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter" && ev.key !== " ") return
                    ev.preventDefault()
                    openRow(r)
                  }}
                  className="cursor-pointer align-top transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                >
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="max-w-[16rem] px-3 py-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {r.kind === "trademark" ? "상표" : "특허"}
                      </span>
                      <span className="truncate font-medium">{r.name}</span>
                    </div>
                    {r.sub || r.no ? (
                      <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {r.sub}
                        {r.sub && r.no ? " · " : ""}
                        {r.no ? <span className="font-mono">{r.no}</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <p
                      title={summary}
                      className="line-clamp-2 text-[12.5px]/relaxed text-foreground/85"
                    >
                      {summary}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <Backlog
                      last={last}
                      issues={byId.get(r.id) ?? []}
                      today={today}
                    />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="text-muted-foreground tabular-nums">
                      {formatDate(r.date)}
                    </div>
                    <div className="text-[12px]">
                      <StaleDays days={daysBetween(r.date, today)} />
                    </div>
                  </td>
                </tr>
              )
            })}

            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  조건에 맞는 건이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <StageOrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        stages={defaultOrder}
        value={stageOrder.overview ?? []}
        description={`현황 표의 줄 차례입니다. 위에 있을수록 먼저 옵니다. 이 순서는 본인에게만 적용됩니다. 기본: ${defaultOrder.join(" → ")}`}
        onSave={async (next) => {
          const merged = { ...stageOrder, overview: next }
          await saveStageOrder(member.userId, merged)
          setStageOrder(merged)
        }}
      />

      <TaskDialog entryId={picked} onClose={() => setPicked(null)} />
    </div>
  )
}

/** 이 건에 걸린 일. 차례·기한은 기록에서, 확인 필요·오래 멈춤은 자동 감지에서 온다. */
function Backlog({
  last,
  issues,
  today,
}: {
  last: ProgressEntry | undefined
  issues: Issue[]
  today: string
}) {
  const stale = issues.find((i) => i.days !== undefined)
  const others = issues.filter((i) => i.days === undefined)
  const turn = last?.nextTurn ?? "none"
  const over = last?.dueOn ? last.dueOn < today : false

  if (turn === "none" && others.length === 0 && !stale) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {turn === "us" ? (
        <Badge className="bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300">
          회신 필요
        </Badge>
      ) : turn === "firm" ? (
        <Badge className="bg-muted text-muted-foreground">
          {last?.counterpart ? `${last.counterpart} 회신 대기` : "상대 회신 대기"}
        </Badge>
      ) : null}
      {turn !== "none" && last?.dueOn ? (
        <Badge
          className={cn(
            over
              ? "bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300"
              : "bg-muted text-muted-foreground"
          )}
        >
          기한 {formatDate(last.dueOn).slice(5)}
          {over ? " 지남" : ""}
        </Badge>
      ) : null}
      {others.length > 0 ? (
        <span
          title={others.map((i) => i.title).join("\n")}
          className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          확인 {others.length}
        </span>
      ) : null}
      {stale ? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <HugeiconsIcon
            icon={Timer02Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          멈춤 {stale.days}일
        </span>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: "danger" | "warn"
  active: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card
        size="sm"
        className={cn(
          "transition-shadow",
          active ? "ring-2 ring-primary/60" : "hover:ring-foreground/25"
        )}
      >
        <CardContent>
          <div className="text-[12px] text-muted-foreground">{label}</div>
          <div
            className={cn(
              "mt-0.5 font-heading text-2xl font-semibold tabular-nums",
              tone === "danger" &&
                value > 0 &&
                "text-red-600 dark:text-red-400",
              tone === "warn" &&
                value > 0 &&
                "text-amber-600 dark:text-amber-400"
            )}
          >
            {value}
          </div>
        </CardContent>
      </Card>
    </button>
  )
}
