"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  FilterIcon,
  Timer02Icon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ip/page-header"
import { StatusBadge } from "@/components/ip/status-badge"
import { ExportViewButton } from "@/components/ip/export-button"
import { StageOrderDialog } from "@/components/ip/stage-order-dialog"
import { CorrectionForm, ProgressHistory } from "@/components/ip/record-detail"
import { MailDialog } from "@/components/ip/mail-thread"
import { CaseImages } from "@/components/ip/case-images"
import { CaseGallery, LayoutToggle } from "@/components/ip/case-gallery"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ip/ip-dialog"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { useToday } from "@/hooks/ip/use-today"
import { useQueryParam } from "@/hooks/ip/use-search-string"
import { detect, issuesById, type Issue } from "@/lib/ip/detect"
import { exportAll, exporterName } from "@/lib/ip/excel"
import {
  loadOpeningState,
  loadStageOrder,
  saveStageOrder,
  type OpeningState,
  type StageOrder,
} from "@/lib/ip/db"
import { formatDate } from "@/lib/ip/date"
import { sortByDefault } from "@/lib/ip/stage-order"
import { cn } from "@/lib/utils"
import {
  groupImages,
  readLayout,
  writeLayout,
  type CaseImage,
  type RegisterLayout,
} from "@/lib/ip-images"
import type { Patent, ProgressEntry, Trademark } from "@/lib/ip/types"

/**
 * IP — 보유한 상표·특허 목록.
 *
 * 여기서 값을 직접 고치지 않는다. 값은 「기록하기」에서 들어오고 이 화면은 그
 * 결과를 보여줄 뿐이다. 행을 누르면 정합성 경고·지정상품·진행 이력이 펼쳐진다.
 */

const dash = (v: string | null | undefined) => (v && v !== "" ? v : "—")

type Kind = "trademark" | "patent"
type Row = Trademark | Patent
type Dir = "asc" | "desc"

const DEFAULT_SORT = { key: "status", dir: "asc" as Dir }

/** 열 하나. `value` 는 화면에 그릴 것, `sort` 는 줄을 세울 때 쓸 것. */
interface Column {
  key: string
  label: string
  /** 정렬 기준값. null 은 항상 뒤로 보낸다 — 빈 칸이 위로 몰리면 목록이 안 읽힌다. */
  sort: (row: Row) => string | number | null
  className?: string
}

function trademarkColumns(): Column[] {
  return [
    { key: "name", label: "이름", sort: (r) => (r as Trademark).name },
    { key: "no", label: "등록/출원번호", sort: (r) => r.regNo ?? r.appNo },
    {
      key: "date",
      label: "날짜",
      sort: (r) => r.registeredOn ?? r.filedOn ?? r.date,
    },
    { key: "holder", label: "보유자", sort: (r) => (r as Trademark).holder },
    { key: "status", label: "단계", sort: (r) => r.status },
  ]
}

function patentColumns(): Column[] {
  return [
    { key: "title", label: "명칭", sort: (r) => (r as Patent).title },
    { key: "appNo", label: "출원번호", sort: (r) => r.appNo },
    { key: "filedOn", label: "출원일", sort: (r) => r.filedOn },
    { key: "regNo", label: "등록번호", sort: (r) => r.regNo },
    { key: "registeredOn", label: "등록일", sort: (r) => r.registeredOn },
    { key: "applicant", label: "출원인", sort: (r) => (r as Patent).applicant },
    { key: "status", label: "단계", sort: (r) => r.status },
  ]
}

/**
 * 출원 뒤 등록 전의 중간 단계. 건수 줄에서는 따로 세우지 않고 「출원」으로 센다 —
 * 아직 등록되지 않은 출원 건이라는 점은 같고, 칸이 잘게 나뉘면 한눈에 안 들어온다.
 */
const FILED_SUBSTAGES = new Set(["심사중", "보정서제출", "의견제출통지", "출원공고"])

function countAs(status: string): string {
  return FILED_SUBSTAGES.has(status) ? "출원" : status
}

export function RegisterView() {
  const today = useToday()
  const { member, canWrite } = useAuth()
  const { trademarks, patents, progress, statusOptions, images, refresh } = useData()

  // 대시보드에서 넘어올 때의 초기 탭만 쿼리로 받는다. 이후 전환은 화면 안에서만.
  const initialTab = useQueryParam("kind", "trademark")
  // 「IP 에서 보기」로 넘어온 건. 그 줄을 잠깐 반짝여 어디인지 알려준다.
  const focusId = useQueryParam("focus", "")

  const [tab, setTab] = useState(initialTab)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  // 처음부터 단계 차례로 세운다. 열 머리를 눌러 다른 기준으로 바꿀 수 있다.
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(
    DEFAULT_SORT
  )
  const [showFilter, setShowFilter] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [orderOpen, setOrderOpen] = useState(false)
  const [stageOrder, setStageOrder] = useState<StageOrder>({})
  // 이어받은 시점의 값. 진행 이력의 출발선으로 보여준다.
  const [opening, setOpening] = useState<Map<string, OpeningState>>(new Map())
  // 반짝임은 한 번만. 정렬·검색을 바꿀 때마다 다시 번쩍이면 성가시다.
  const [flashed, setFlashed] = useState(false)
  // 목록 / 갤러리. 이 기기에 기억한다 — 첫 그림은 서버와 같게 목록으로 그리고, 붙은 뒤 기억한 것으로 바꾼다
  const [layout, setLayout] = useState<RegisterLayout>("list")
  // 갤러리에서 누른 건 — 목록의 펼침과 같은 상세를 창으로 연다
  const [detailKey, setDetailKey] = useState<string | null>(null)

  useEffect(() => {
    const saved = readLayout(typeof window === "undefined" ? null : window.localStorage)
    if (saved !== "list") setLayout(saved)
  }, [])

  function changeLayout(next: RegisterLayout) {
    setLayout(next)
    setOpen(null)
    writeLayout(typeof window === "undefined" ? null : window.localStorage, next)
  }

  const isPatent = tab === "patent"
  const kind: Kind = isPatent ? "patent" : "trademark"

  useEffect(() => {
    let cancelled = false
    loadStageOrder(member.userId)
      .then((o) => {
        if (!cancelled) setStageOrder(o)
      })
      .catch(() => {
        // 취향이 없어도 화면은 돌아야 한다. 파이프라인 순서로 떨어진다.
      })
    return () => {
      cancelled = true
    }
  }, [member.userId])

  useEffect(() => {
    let cancelled = false
    loadOpeningState()
      .then((m) => {
        if (!cancelled) setOpening(m)
      })
      .catch(() => {
        // 출발선을 못 읽어도 이력은 보여야 한다.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!focusId || flashed) return
    const timer = window.setTimeout(() => setFlashed(true), 2600)
    return () => window.clearTimeout(timer)
  }, [focusId, flashed])

  const issues = useMemo(
    () => detect(trademarks, patents, today, progress),
    [trademarks, patents, today, progress]
  )
  const byId = useMemo(() => issuesById(issues), [issues])
  const imagesByCase = useMemo(() => groupImages(images), [images])

  const historyOf = useMemo(() => {
    const map = new Map<string, typeof progress>()
    for (const e of progress) {
      const k = `${e.entityKind}:${e.entityId}`
      map.set(k, [...(map.get(k) ?? []), e])
    }
    return map
  }, [progress])

  /** 이 종류의 상태를 차례대로. 대장·필터·값 정정은 사건이 아니라 상태를 다룬다 */
  const pipeline = useMemo(
    () =>
      statusOptions
        .filter((s) => s.kind === kind)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => s.value),
    [statusOptions, kind]
  )

  /**
   * 정렬 기본 차례(등록 > 출원 > 검토 > 거절·포기·중단). 입력 양식·필터는 일의
   * 흐름대로인 pipeline 을 그대로 쓰고, 줄 세우기만 이 차례를 쓴다.
   */
  const defaultOrder = useMemo(
    () => sortByDefault(pipeline, (v) => pipeline.indexOf(v)),
    [pipeline]
  )

  /** 단계 → 순위. 개인 순서가 먼저고, 거기 없는 단계는 기본 차례로 뒤에 붙는다. */
  const stageRank = useMemo(() => {
    const mine = (stageOrder[kind] ?? []).filter((v) =>
      defaultOrder.includes(v)
    )
    const rest = defaultOrder.filter((v) => !mine.includes(v))
    const map = new Map<string, number>()
    ;[...mine, ...rest].forEach((v, i) => map.set(v, i))
    return map
  }, [stageOrder, kind, defaultOrder])

  /**
   * 단계별 건수 — 고른 종류(상표 또는 특허)만 센다. 검색·필터와 무관하게 그 종류
   * 전체가 기준이라 「등록 몇 건, 출원 몇 건」을 한눈에 본다. 차례는 기본 차례.
   * `members` 는 그 칸에 묶인 실제 단계 값들 — 누르면 이 값들로 거른다.
   */
  const stageCounts = useMemo(() => {
    const base: Row[] = isPatent ? patents : trademarks
    const groups = new Map<string, { count: number; members: Set<string> }>()
    for (const row of base) {
      const key = countAs(row.status)
      const g = groups.get(key) ?? { count: 0, members: new Set<string>() }
      g.count += 1
      g.members.add(row.status)
      groups.set(key, g)
    }
    return sortByDefault([...groups.keys()]).map((stage) => {
      const g = groups.get(stage)!
      return { stage, count: g.count, members: [...g.members] }
    })
  }, [isPatent, patents, trademarks])

  const columns = useMemo(
    () => (isPatent ? patentColumns() : trademarkColumns()),
    [isPatent]
  )

  const needle = q.trim().toLowerCase()

  const visible = useMemo(() => {
    const base: Row[] = isPatent ? patents : trademarks

    const filtered = base.filter((row) => {
      if (picked.length > 0 && !picked.includes(row.status)) return false
      if (!needle) return true
      const hay = isPatent
        ? `${(row as Patent).title} ${row.appNo ?? ""} ${row.regNo ?? ""}`
        : `${(row as Trademark).name} ${(row as Trademark).nameKo} ${row.appNo ?? ""} ${row.regNo ?? ""}`
      return hay.toLowerCase().includes(needle)
    })

    if (!sort) return filtered

    const column = columns.find((c) => c.key === sort.key)
    if (!column) return filtered

    const sign = sort.dir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      // 단계는 글자순이 아니라 사람이 정한 차례로 센다.
      if (column.key === "status") {
        const ra = stageRank.get(a.status) ?? Number.MAX_SAFE_INTEGER
        const rb = stageRank.get(b.status) ?? Number.MAX_SAFE_INTEGER
        return (ra - rb) * sign || a.id.localeCompare(b.id)
      }
      const va = column.sort(a)
      const vb = column.sort(b)
      // 빈 값은 방향과 무관하게 뒤로 보낸다.
      if (va === null || va === "") return vb === null || vb === "" ? 0 : 1
      if (vb === null || vb === "") return -1
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * sign
      }
      return String(va).localeCompare(String(vb), "ko") * sign
    })
  }, [isPatent, patents, trademarks, picked, needle, sort, columns, stageRank])

  function toggleSort(key: string) {
    setSort((prev) =>
      prev?.key !== key
        ? { key, dir: "asc" }
        : prev.dir === "asc"
          ? { key, dir: "desc" }
          : null
    )
  }

  return (
    <div data-tutorial="register" className="flex flex-col gap-4">
      <PageHeader
        title={`IP ${trademarks.length + patents.length}건`}
        description="기존 엑셀과 같은 항목입니다. 값은 「기록하기」에서 들어옵니다."
        action={
          <ExportViewButton
            label="엑셀로 내려받기"
            count={trademarks.length + patents.length}
            onExport={() =>
              exportAll({ trademarks, patents }, today, exporterName(member))
            }
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["trademark", `상표 ${trademarks.length}`],
              ["patent", `특허 ${patents.length}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setTab(k)
                setSort(DEFAULT_SORT)
                setPicked([])
              }}
              className={cn(
                "touch-target rounded-full border px-3 py-1 text-[12px] transition-colors",
                tab === k
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
          aria-label="필터"
          aria-expanded={showFilter}
          onClick={() => setShowFilter((v) => !v)}
          className={cn(
            "flex h-8 items-center gap-1 px-2 text-[13px] rounded-md border transition-colors",
            showFilter || picked.length > 0
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-4" />
          {picked.length > 0 ? (
            <span className="tabular-nums">{picked.length}</span>
          ) : null}
        </button>

        <LayoutToggle value={layout} onChange={changeLayout} />

        {issues.length > 0 ? (
          <Badge className="ml-auto bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
            확인 필요 {issues.length}건
          </Badge>
        ) : null}
      </div>

      {stageCounts.length > 0 ? (
        <ul
          aria-label={`${isPatent ? "특허" : "상표"} 단계별 건수`}
          className="flex flex-wrap gap-1.5"
        >
          {stageCounts.map(({ stage, count, members }) => {
            const on = members.every((m) => picked.includes(m))
            const folded = members.filter((m) => m !== stage)
            return (
              <li key={stage}>
                <button
                  type="button"
                  aria-pressed={on}
                  title={
                    (on ? `${stage} 필터 끄기` : `${stage}만 보기`) +
                    (folded.length > 0 ? ` (${folded.join("·")} 포함)` : "")
                  }
                  onClick={() =>
                    setPicked((prev) =>
                      on
                        ? prev.filter((s) => !members.includes(s))
                        : [...prev, ...members.filter((m) => !prev.includes(m))]
                    )
                  }
                  className={cn(
                    "touch-target flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors",
                    on ? "border-primary bg-primary/10" : "bg-card hover:bg-muted/60"
                  )}
                >
                  <StatusBadge status={stage} />
                  <span className="text-[13px] font-semibold tabular-nums">
                    {count}
                    <span className="ml-0.5 text-[12px] font-normal text-muted-foreground">건</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {showFilter ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2.5">
          <span className="mr-1 text-[12px] text-muted-foreground">단계</span>
          {pipeline.map((stage) => {
            const on = picked.includes(stage)
            return (
              <button
                key={stage}
                type="button"
                onClick={() =>
                  setPicked((prev) =>
                    on ? prev.filter((s) => s !== stage) : [...prev, stage]
                  )
                }
                className={cn(
                  "transition-opacity",
                  on ? "opacity-100" : "opacity-45 hover:opacity-80"
                )}
              >
                <StatusBadge status={stage} />
              </button>
            )
          })}
          {picked.length > 0 ? (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="ml-auto px-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              지우기
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOrderOpen(true)}
            className={cn(
              "px-1.5 text-[12px] text-muted-foreground hover:text-foreground",
              picked.length === 0 && "ml-auto"
            )}
          >
            단계 순서 설정
          </button>
        </div>
      ) : null}

      {layout === "gallery" ? (
        <CaseGallery
          kind={kind}
          rows={visible}
          images={imagesByCase}
          focusId={flashed ? undefined : focusId}
          onOpen={(row) => setDetailKey(`${kind}:${row.id}`)}
        />
      ) : (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-muted/50 text-[12px] text-muted-foreground">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} className="px-3 py-2 text-left font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "flex items-center gap-0.5 transition-colors hover:text-foreground",
                        active && "text-foreground"
                      )}
                    >
                      {c.label}
                      {active ? (
                        <HugeiconsIcon
                          icon={
                            sort.dir === "asc" ? ArrowUp01Icon : ArrowDown01Icon
                          }
                          strokeWidth={2}
                          className="size-3"
                        />
                      ) : null}
                    </button>
                  </th>
                )
              })}
              <th className="px-3 py-2 text-right font-medium"> </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border/60">
            {visible.map((row) => {
              const key = `${kind}:${row.id}`
              const mine = byId.get(row.id) ?? []
              const expanded = open === key
              const flashing = !flashed && focusId === row.id

              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => setOpen(expanded ? null : key)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40",
                      expanded && "bg-muted/40",
                      flashing && "hadd-flash"
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium">
                        {isPatent
                          ? (row as Patent).title
                          : (row as Trademark).name}
                      </span>
                      {!isPatent && (row as Trademark).nameKo ? (
                        <span className="ml-1.5 text-muted-foreground">
                          {(row as Trademark).nameKo}
                        </span>
                      ) : null}
                    </td>

                    {isPatent ? (
                      <>
                        <td className="px-3 py-2 font-mono text-[12px]">
                          {dash(row.appNo)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {row.filedOn ? formatDate(row.filedOn) : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12px]">
                          {dash(row.regNo)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {row.registeredOn
                            ? formatDate(row.registeredOn)
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {dash((row as Patent).applicant)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-mono text-[12px]">
                          {dash(row.regNo ?? row.appNo)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {row.registeredOn || row.filedOn || row.date
                            ? formatDate(
                                (row.registeredOn ??
                                  row.filedOn ??
                                  row.date) as string
                              )
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {dash((row as Trademark).holder)}
                        </td>
                      </>
                    )}

                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <IssueChips issues={mine} />
                    </td>
                  </tr>

                  {expanded ? (
                    <tr className="bg-muted/20">
                      <td colSpan={columns.length + 1} className="px-3 py-3">
                        <CaseDetail
                          kind={kind}
                          row={row}
                          issues={mine}
                          history={historyOf.get(key) ?? []}
                          opening={opening.get(key)}
                          images={imagesByCase.get(key) ?? []}
                          pipeline={pipeline}
                          today={today}
                          canWrite={canWrite}
                          onSaved={refresh}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}

            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  조건에 맞는 건이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      )}

      <GalleryDetailDialog
        detailKey={detailKey}
        onClose={() => setDetailKey(null)}
        trademarks={trademarks}
        patents={patents}
        render={(k, row) => (
          <CaseDetail
            kind={k}
            row={row}
            issues={byId.get(row.id) ?? []}
            history={historyOf.get(`${k}:${row.id}`) ?? []}
            opening={opening.get(`${k}:${row.id}`)}
            images={imagesByCase.get(`${k}:${row.id}`) ?? []}
            pipeline={statusOptions
              .filter((s) => s.kind === k)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((s) => s.value)}
            today={today}
            canWrite={canWrite}
            onSaved={refresh}
          />
        )}
      />

      <StageOrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        stages={defaultOrder}
        value={stageOrder[kind] ?? []}
        onSave={async (next) => {
          const merged = { ...stageOrder, [kind]: next }
          await saveStageOrder(member.userId, merged)
          setStageOrder(merged)
          // 순서를 고쳤으면 그 결과가 바로 보이는 것이 자연스럽다.
          setSort({ key: "status", dir: "asc" })
        }}
      />
    </div>
  )
}

/**
 * 건별 표시. 정합성 경고와 「오래 멈춤」은 성격이 달라 따로 센다 —
 * 하나는 값이 틀렸다는 뜻이고, 다른 하나는 값은 맞는데 시간이 지났다는 뜻이다.
 */
function IssueChips({ issues }: { issues: Issue[] }) {
  const stale = issues.find((i) => i.days !== undefined)
  const others = issues.filter((i) => i.days === undefined)
  if (others.length === 0 && !stale) return null

  return (
    <span className="inline-flex items-center gap-2">
      {others.length > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          <span className="tabular-nums">{others.length}</span>
        </span>
      ) : null}
      {stale ? (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <HugeiconsIcon
            icon={Timer02Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          <span className="tabular-nums">{stale.days}일</span>
        </span>
      ) : null}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  )
}

/**
 * 건 하나의 상세 — 목록의 펼침과 갤러리 카드를 눌렀을 때 뜨는 창이 같은 것을 그린다.
 * 정합성 경고 · 지정상품 · 이미지 · 메일 · 값 정정 · 진행 이력.
 */
function CaseDetail({
  kind,
  row,
  issues,
  history,
  opening,
  images,
  pipeline,
  today,
  canWrite,
  onSaved,
}: {
  kind: Kind
  row: Row
  issues: Issue[]
  history: ProgressEntry[]
  opening: OpeningState | undefined
  images: CaseImage[]
  pipeline: string[]
  today: string
  canWrite: boolean
  onSaved: () => Promise<void>
}) {
  const isPatent = kind === "patent"
  const title = isPatent ? (row as Patent).title : (row as Trademark).name
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {issues.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {issues.map((i) => (
            <div
              key={i.key}
              className={cn(
                "flex flex-wrap items-baseline gap-x-2 border-l-2 pl-2",
                i.level === "error" ? "border-red-500" : "border-amber-500"
              )}
            >
              <span className="font-medium">{i.title}</span>
              <span className="text-muted-foreground">{i.detail}</span>
            </div>
          ))}
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {!isPatent ? (
          <>
            <Detail label="지정상품" value={(row as Trademark).goods} />
            <Detail label="류" value={(row as Trademark).classes.join(", ") || null} />
            <Detail
              label="등록가능성"
              value={(row as Trademark).probability === null ? null : `${(row as Trademark).probability}%`}
            />
          </>
        ) : null}
        <Detail label="마지막 진행" value={row.date ? formatDate(row.date) : null} />
        <Detail label="비고" value={row.note || null} />
      </dl>

      <CaseImages kind={kind} entityId={row.id} title={title} images={images} canWrite={canWrite} today={today} onChanged={onSaved} />

      {/*
        메일 원문은 여기서 펼치지 않는다 — 표 한가운데서
        길어지면 아래 건들이 화면 밖으로 밀려난다.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <MailDialog kind={kind} id={row.id} title={title} />
      </div>

      {canWrite ? (
        <CorrectionForm
          entityKind={kind}
          entityId={row.id}
          stage={row.status}
          today={today}
          current={{
            name: title,
            holder: isPatent ? (row as Patent).applicant : (row as Trademark).holder,
            appNo: row.appNo,
            regNo: row.regNo,
            filedOn: row.filedOn,
            registeredOn: row.registeredOn,
          }}
          stageOptions={pipeline}
          onSaved={onSaved}
        />
      ) : null}

      <ProgressHistory entries={history} opening={opening} title={title} />
    </div>
  )
}

/**
 * 갤러리 카드를 눌렀을 때의 상세 창. 건은 키(`kind:id`)로 들고 있다가 그때의 값으로 그린다 —
 * 이미지를 올리거나 값을 고쳐 스냅샷이 바뀌면 창도 새 값을 보인다.
 */
function GalleryDetailDialog({
  detailKey,
  onClose,
  trademarks,
  patents,
  render,
}: {
  detailKey: string | null
  onClose: () => void
  trademarks: Trademark[]
  patents: Patent[]
  render: (kind: Kind, row: Row) => React.ReactNode
}) {
  const cut = detailKey ? detailKey.indexOf(":") : -1
  const k = cut > 0 ? (detailKey!.slice(0, cut) as Kind) : null
  const id = cut > 0 ? detailKey!.slice(cut + 1) : null
  const row: Row | undefined =
    k === "patent" ? patents.find((p) => p.id === id) : k === "trademark" ? trademarks.find((t) => t.id === id) : undefined
  const title = row ? (k === "patent" ? (row as Patent).title : (row as Trademark).name) : ""
  return (
    <Dialog open={!!row} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{title}</span>
            {row ? <StatusBadge status={row.status} /> : null}
          </DialogTitle>
          <DialogDescription className="font-mono text-[12px] break-all">
            {row ? [row.id, row.regNo ? `등록 ${row.regNo}` : row.appNo ? `출원 ${row.appNo}` : null].filter(Boolean).join(" · ") : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-[13px]">{row && k ? render(k, row) : null}</div>
      </DialogContent>
    </Dialog>
  )
}
