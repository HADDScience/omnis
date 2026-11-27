import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DashboardBrowsingIcon,
  MenuSquareIcon,
} from "@hugeicons/core-free-icons"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { decisionsForNotices, isImportedDecision } from "@/lib/grants"
import type { NoticeAttachment } from "@/lib/grants-import"
import { apiUrl } from "@/lib/base-path"
import type { AttachmentView } from "@/components/grants/grant-files"
import {
  DEADLINE_FILTERS,
  GRANT_STAGES,
  GRANT_STAGE_LABEL,
  REGION_GROUPS,
  VERDICTS,
  type DeadlineFilter,
  type RegionGroup,
  asStage,
} from "@/lib/grants-labels"
import {
  NOTICE_ORDER,
  noticeWhere,
  readNoticeFilter,
  readStage,
  type NoticeFilter,
} from "@/lib/grants-query"
import {
  DecisionList,
  type DecisionView,
} from "@/components/grants/decision-list"
import { NoticeList, type NoticeView } from "@/components/grants/notice-list"
import { DecisionBoard } from "@/components/grants/decision-board"
import {
  BoardSkeleton,
  DecisionListSkeleton,
} from "@/components/grants/decision-skeletons"
import { readBoardView, type BoardView } from "@/lib/grants-board"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "국가과제 · HADD DB" }
export const dynamic = "force-dynamic"

const PAGE = 50

/** 공고 첨부 → 화면 줄. 받기는 옴니스 경로를 거친다(기업마당 새 토큰) */
function attachmentViews(noticeId: string, raw: unknown): AttachmentView[] {
  return ((Array.isArray(raw) ? raw : []) as NoticeAttachment[]).map(
    (a, i) => ({
      name: a.name,
      type: a.type,
      size: a.size,
      href: apiUrl(`/api/grants/notices/${noticeId}/files/${i}`),
    })
  )
}
type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * 국가과제 — 「우리 결정」(노션 51건에서 시작한 GrantDecision)과 「과제 후보」(수집기 공고 GrantNotice).
 * 필터는 주소에 담아 서버에서 고른다 — 뒤로 가기 · 링크 공유가 그대로 된다.
 */
export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const sp = await searchParams
  const tab = one(sp.tab) === "notices" ? "notices" : "decisions"
  const view = readBoardView(one(sp.view))
  const board = tab === "decisions" && view === "board"
  const [decisionCount, noticeOpen] = await Promise.all([
    prisma.grantDecision.count(),
    prisma.grantNotice.count({ where: noticeWhere(readNoticeFilter({})) }),
  ])

  return (
    <>
      <Header crumbs={["HADD DB", "국가과제"]} />
      <div
        className={cn(
          "mx-auto w-full px-4 py-6 sm:px-6",
          board ? "max-w-[1480px]" : "max-w-[1040px]"
        )}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">국가과제</h1>
        </div>
        <nav aria-label="국가과제 보기" className="mb-4 flex items-center gap-1.5">
          <TabLink
            href="/omnis/grants"
            active={tab === "decisions"}
            label="우리 결정"
            count={decisionCount}
          />
          <TabLink
            href="/omnis/grants?tab=notices"
            active={tab === "notices"}
            label="과제 후보"
            count={noticeOpen}
          />
          {tab === "decisions" && <ViewSwitch view={view} />}
        </nav>
        {tab === "decisions" ? (
          <Suspense
            key={view}
            fallback={board ? <BoardSkeleton /> : <DecisionListSkeleton />}
          >
            {board ? <Board /> : <Decisions sp={sp} />}
          </Suspense>
        ) : (
          <Notices sp={sp} />
        )}
      </div>
    </>
  )
}

function TabLink({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "touch-target inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors",
        active
          ? "bg-foreground text-background"
          : "glass text-foreground hover:bg-foreground/[0.04]"
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          active ? "opacity-80" : "text-muted-foreground"
        )}
      >
        {count}
      </span>
    </Link>
  )
}

/** 우리 결정 목록 · 보드 전환 — 주소의 view 에 담는다(뒤로 가기 · 링크 공유) */
function ViewSwitch({ view }: { view: BoardView }) {
  return (
    <div
      role="group"
      aria-label="보기"
      className="glass ml-auto inline-flex h-9 items-center rounded-full p-0.5"
    >
      {(
        [
          { key: "list", label: "목록", icon: MenuSquareIcon, href: "/omnis/grants" },
          {
            key: "board",
            label: "보드",
            icon: DashboardBrowsingIcon,
            href: "/omnis/grants?view=board",
          },
        ] as const
      ).map((o) => (
        <Link
          key={o.key}
          href={o.href}
          scroll={false}
          aria-current={view === o.key ? "true" : undefined}
          aria-label={o.label}
          className={cn(
            "touch-hit inline-flex h-8 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
            view === o.key
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={o.icon} size={14} strokeWidth={2} aria-hidden />
          <span className="sr-only sm:not-sr-only">{o.label}</span>
        </Link>
      ))}
    </div>
  )
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "touch-target inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "glass text-foreground hover:bg-foreground/[0.04]"
      )}
    >
      {children}
    </Link>
  )
}

// ─── 우리 결정 ───

async function Decisions({ sp }: { sp: SP }) {
  const stage = readStage(one(sp.stage))
  const [rows, counts, members, tasks, projects] = await Promise.all([
    prisma.grantDecision.findMany({
      where: stage ? { stage } : {},
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { title: "asc" }],
      include: {
        owners: { include: { user: { select: { id: true, name: true } } } },
        task: { select: { id: true, slug: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.grantDecision.groupBy({ by: ["stage"], _count: true }),
    prisma.user.findMany({
      where: { ...ACTIVE_MEMBER_WHERE, id: { not: "system" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.task.findMany({
      where: { status: { not: "DONE" } },
      select: { id: true, slug: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])
  const countOf = (s: string) => counts.find((c) => c.stage === s)?._count ?? 0
  const total = counts.reduce((a, c) => a + c._count, 0)

  // 이 결정 · 같은 사업(같은 공고 · 다른 회차)으로 이어진 공고의 첨부
  const linkKeysOf = (r: (typeof rows)[number]) => [
    r.externalKey,
    ...(
      (Array.isArray(r.noticeLinks) ? r.noticeLinks : []) as {
        relation?: string
        export_key?: string
      }[]
    )
      .filter((l) => l.relation !== "related" && l.export_key)
      .map((l) => l.export_key!),
  ]
  const linked = await prisma.grantNotice.findMany({
    where: { externalKey: { in: [...new Set(rows.flatMap(linkKeysOf))] } },
    select: { id: true, externalKey: true, attachments: true },
  })
  const filesByKey = new Map(
    linked.map((n) => [n.externalKey, attachmentViews(n.id, n.attachments)])
  )
  const filesOf = (r: (typeof rows)[number]) => {
    const seen = new Set<string>()
    return linkKeysOf(r)
      .flatMap((k) => filesByKey.get(k) ?? [])
      .filter((a) => !seen.has(a.name) && seen.add(a.name))
  }

  const view: DecisionView[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    stage: asStage(r.stage),
    stageReason: r.stageReason,
    statusRaw: r.statusRaw,
    submittedTitle: r.submittedTitle,
    note: r.note,
    deadline: r.deadline?.toISOString() ?? null,
    amount: r.amount,
    owners: r.owners.map((o) => ({
      id: o.user.id,
      name: o.user.name,
      role: o.role,
    })),
    task: r.task,
    project: r.project,
    noticeLinks: (
      (Array.isArray(r.noticeLinks) ? r.noticeLinks : []) as {
        relation?: string
        title?: string
        date?: string | null
        export_key?: string
      }[]
    ).map((l) => ({
      relation: l.relation ?? null,
      title: l.title ?? "",
      date: l.date ?? null,
      key: l.export_key ?? null,
    })),
    nasFolder: r.nasFolder,
    selectedOn: r.selectedOn?.toISOString() ?? null,
    awardedAmount: r.awardedAmount?.toString() ?? null,
    agreementOn: r.agreementOn?.toISOString() ?? null,
    startsOn: r.startsOn?.toISOString() ?? null,
    endsOn: r.endsOn?.toISOString() ?? null,
    completedOn: r.completedOn?.toISOString() ?? null,
    imported: isImportedDecision(r),
    attachments: filesOf(r),
  }))

  return (
    <section aria-label="우리 결정">
      <div className="mb-2.5 flex [scrollbar-width:none] gap-1.5 overflow-x-auto pb-0.5">
        <Chip href="/omnis/grants" active={!stage}>
          전체 <span className="tabular-nums opacity-70">{total}</span>
        </Chip>
        {GRANT_STAGES.map((s) => (
          <Chip key={s} href={`/omnis/grants?stage=${s}`} active={stage === s}>
            {GRANT_STAGE_LABEL[s]}{" "}
            <span className="tabular-nums opacity-70">{countOf(s)}</span>
          </Chip>
        ))}
      </div>
      <DecisionList
        rows={view}
        members={members}
        tasks={tasks}
        projects={projects}
      />
    </section>
  )
}

/** 우리 결정 보드 — 단계 일곱 열, 전체 결정(단계 필터 없음) */
async function Board() {
  const rows = await prisma.grantDecision.findMany({
    orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      stage: true,
      deadline: true,
      amount: true,
      awardedAmount: true,
      endsOn: true,
      completedOn: true,
      owners: { select: { role: true, user: { select: { id: true, name: true } } } },
    },
  })
  return (
    <section aria-label="우리 결정 보드">
      <DecisionBoard
        rows={rows.map((r) => ({
          id: r.id,
          title: r.title,
          stage: asStage(r.stage),
          deadline: r.deadline?.toISOString() ?? null,
          amount: r.amount,
          awardedAmount: r.awardedAmount?.toString() ?? null,
          endsOn: r.endsOn?.toISOString() ?? null,
          completedOn: r.completedOn?.toISOString() ?? null,
          owners: r.owners.map((o) => ({
            id: o.user.id,
            name: o.user.name,
            role: o.role,
          })),
        }))}
      />
    </section>
  )
}

// ─── 과제 후보 ───

function noticeHref(
  f: NoticeFilter,
  change: Partial<NoticeFilter> & { page?: number }
) {
  const n = { ...f, ...change }
  const q = new URLSearchParams({ tab: "notices" })
  const v = n.verdicts.join(",")
  if (v !== "해당,애매") q.set("verdict", v)
  if (n.deadline !== "open") q.set("deadline", n.deadline)
  if (n.region) q.set("region", n.region)
  if (n.query) q.set("q", n.query)
  if (n.profile === "corp") q.set("profile", "corp")
  if (change.page && change.page > 1) q.set("page", String(change.page))
  return `/omnis/grants?${q}`
}

async function Notices({ sp }: { sp: SP }) {
  const f = readNoticeFilter({
    verdict: one(sp.verdict),
    deadline: one(sp.deadline),
    region: one(sp.region),
    query: one(sp.q),
    profile: one(sp.profile),
  })
  const page = Math.max(1, Number(one(sp.page)) || 1)
  const where = noticeWhere(f)
  const [total, rows] = await Promise.all([
    prisma.grantNotice.count({ where }),
    prisma.grantNotice.findMany({
      where,
      orderBy: NOTICE_ORDER,
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
  ])
  const decided = await decisionsForNotices(rows.map((r) => r.externalKey))
  const view: NoticeView[] = rows.map((r) => ({
    id: r.id,
    key: r.externalKey,
    title: r.title,
    org: [r.ministry, r.agency].filter(Boolean).join(" · ") || null,
    url: r.url,
    deadline: r.deadlineAt?.toISOString() ?? null,
    deadlineRaw: r.deadlineRaw,
    region: r.regionDetail.join("·") || null,
    fields: r.fields,
    isRnd: r.isRnd,
    verdict: (f.profile === "corp" ? r.verdictCorp : r.verdictSole) ?? "불명",
    reasons: (
      ((f.profile === "corp" ? r.reasonsCorp : r.reasonsSole) ?? []) as {
        claim?: string
        quote?: string
      }[]
    ).map((x) => ({ claim: x.claim ?? "", quote: x.quote ?? "" })),
    judgedBy: r.judgedBy,
    decided: decided.has(r.externalKey),
    attachments: attachmentViews(r.id, r.attachments),
    nasFolder: decided.get(r.externalKey)?.nasFolder ?? null,
  }))
  const toggleVerdict = (v: (typeof VERDICTS)[number]) => {
    const has = f.verdicts.includes(v)
    const next = has ? f.verdicts.filter((x) => x !== v) : [...f.verdicts, v]
    return next.length ? next : f.verdicts
  }

  return (
    <section aria-label="과제 후보">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {VERDICTS.map((v) => (
          <Chip
            key={v}
            href={noticeHref(f, { verdicts: toggleVerdict(v) })}
            active={f.verdicts.includes(v)}
          >
            {v}
          </Chip>
        ))}
        <span
          className="mx-1 hidden w-px self-stretch bg-border sm:block"
          aria-hidden
        />
        {(Object.keys(DEADLINE_FILTERS) as DeadlineFilter[]).map((d) => (
          <Chip
            key={d}
            href={noticeHref(f, { deadline: d })}
            active={f.deadline === d}
          >
            {DEADLINE_FILTERS[d]}
          </Chip>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip href={noticeHref(f, { region: null })} active={!f.region}>
          모든 지역
        </Chip>
        {(Object.keys(REGION_GROUPS) as RegionGroup[]).map((r) => (
          <Chip
            key={r}
            href={noticeHref(f, { region: r })}
            active={f.region === r}
          >
            {REGION_GROUPS[r].label}
          </Chip>
        ))}
        <span
          className="mx-1 hidden w-px self-stretch bg-border sm:block"
          aria-hidden
        />
        <Chip
          href={noticeHref(f, { profile: "sole" })}
          active={f.profile === "sole"}
        >
          지금 사업자
        </Chip>
        <Chip
          href={noticeHref(f, { profile: "corp" })}
          active={f.profile === "corp"}
        >
          법인 전환 뒤
        </Chip>
        <form action="/omnis/grants" className="ml-auto flex w-full sm:w-auto">
          <input type="hidden" name="tab" value="notices" />
          {f.verdicts.join(",") !== "해당,애매" && (
            <input type="hidden" name="verdict" value={f.verdicts.join(",")} />
          )}
          {f.deadline !== "open" && (
            <input type="hidden" name="deadline" value={f.deadline} />
          )}
          {f.region && <input type="hidden" name="region" value={f.region} />}
          {f.profile === "corp" && (
            <input type="hidden" name="profile" value="corp" />
          )}
          <input
            type="search"
            name="q"
            defaultValue={f.query}
            placeholder="공고명 · 부처 · 기관"
            aria-label="공고 찾기"
            className="glass h-8 w-full rounded-full border-0 px-3.5 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-56 sm:text-[12.5px]"
          />
        </form>
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground tabular-nums">
        {total}건
      </p>
      <NoticeList rows={view} />
      {total > PAGE && (
        <nav
          aria-label="쪽"
          className="mt-4 flex items-center justify-center gap-2 text-[12.5px]"
        >
          {page > 1 && (
            <Chip href={noticeHref(f, { page: page - 1 })} active={false}>
              이전
            </Chip>
          )}
          <span className="text-muted-foreground tabular-nums">
            {page} / {Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total && (
            <Chip href={noticeHref(f, { page: page + 1 })} active={false}>
              다음
            </Chip>
          )}
        </nav>
      )}
    </section>
  )
}
