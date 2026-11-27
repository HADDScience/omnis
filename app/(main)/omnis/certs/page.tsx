import type { Metadata } from "next"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { DashboardBrowsingIcon, MenuSquareIcon } from "@hugeicons/core-free-icons"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { bonusForCert, readChecklist, readEvidence } from "@/lib/certs"
import { CERT_STAGES, CERT_STAGE_LABEL, asCertStage, isCertStage, type CertStage } from "@/lib/grants-labels"
import { readBoardView, type BoardView } from "@/lib/grants-board"
import { readTipsBonus } from "@/lib/grants-tips"
import { CertList } from "@/components/certs/cert-list"
import { CertBoard } from "@/components/certs/cert-board"
import type { CertView } from "@/components/certs/cert-view"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "인증 · HADD DB" }
export const dynamic = "force-dynamic"

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const iso = (d: Date | null) => d?.toISOString() ?? null

/**
 * 인증 — 회사가 가진 · 따려는 인증을 단계로 본다(국가과제 「우리 결정」 과 같은 목록 · 보드 전환).
 * 단계: 후보 → 준비 → 신청 → 심사 중 → 보유 → 갱신 필요 → 만료, 어디서든 중단. 칸은 펼쳐서 그 자리에서 고친다.
 * 이 화면은 공통 층과 별개의 맞춤 화면이다(칸 키는 lib/certs.ts CERT_FIELDS — 나중에 유형으로 등록할 때 쓴다).
 */
export default async function CertsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const view = readBoardView(one(sp.view))
  const stageParam = one(sp.stage)
  const stage: CertStage | null = isCertStage(stageParam) ? stageParam : null
  const focus = one(sp.cert) ?? null

  const [rows, members, notices] = await Promise.all([
    prisma.companyCertification.findMany({
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { name: "asc" }],
      include: {
        owner: { select: { id: true, name: true } },
        record: { select: { title: true, startsOn: true } },
      },
    }),
    prisma.user.findMany({
      where: { ...ACTIVE_MEMBER_WHERE, id: { not: "system" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.grantNotice.findMany({
      where: { bonusStatus: "ok" },
      select: { id: true, title: true, deadlineAt: true, bonusStatus: true, bonusItems: true },
    }),
  ])

  const order = new Map(CERT_STAGES.map((s, i) => [s, i]))
  const all: CertView[] = rows
    .map((c) => {
      const r = (c.research ?? {}) as Record<string, unknown>
      const b = (c.bonus ?? {}) as { medibio?: string | null; mss?: string | null }
      return {
        id: c.id,
        name: c.name,
        officialName: c.officialName,
        issuer: c.issuer,
        stage: asCertStage(c.status),
        stageReason: c.stageReason,
        deadline: iso(c.deadline),
        owner: c.owner,
        acquiredOn: iso(c.acquiredOn),
        validUntil: iso(c.validUntil),
        certNo: c.certNo,
        priority: c.priority,
        note: c.note,
        checklist: readChecklist(c.checklist),
        evidence: readEvidence(c.evidence),
        research: {
          ourStatus: str(r.our_status),
          reason: str(r.our_status_reason),
          requirements: Array.isArray(r.requirements) ? r.requirements.map(String) : [],
          window: str(r.window_2026_12_2027) ?? str(r.application_window),
          timeToIssue: str(r.time_to_issue),
          cost: str(r.cost),
          validity: str(r.validity),
          sources: (Array.isArray(r.sources) ? (r.sources as { title?: string; url?: string }[]) : [])
            .filter((x) => typeof x.url === "string" && /^https?:\/\//.test(x.url))
            .map((x) => ({ title: x.title ?? null, url: x.url! })),
        },
        bonusRaw: [b.medibio && `메디바이오 ${b.medibio}`, b.mss && `중기부 ${b.mss}`].filter(Boolean).join(" · ") || null,
        tips: readTipsBonus(c.research),
        bonusRows: bonusForCert(c, notices).map((x) => ({ ...x })),
        record: c.record ? { title: c.record.title, startsOn: iso(c.record.startsOn) } : null,
      }
    })
    .sort((a, b) => order.get(a.stage)! - order.get(b.stage)!)

  const countOf = (s: CertStage) => all.filter((c) => c.stage === s).length
  const shown = stage ? all.filter((c) => c.stage === stage) : all
  const board = view === "board"

  return (
    <>
      <Header crumbs={["HADD DB", "인증"]} />
      <div className={cn("mx-auto w-full px-4 py-6 sm:px-6", board ? "max-w-[1560px]" : "max-w-[1040px]")}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">인증</h1>
          <span className="text-[12.5px] text-muted-foreground tabular-nums">{all.length}건</span>
          <ViewSwitch view={view} />
        </div>
        {board ? (
          <section aria-label="인증 보드">
            <CertBoard rows={all} />
          </section>
        ) : (
          <section aria-label="인증 목록">
            <div className="mb-2.5 flex [scrollbar-width:none] gap-1.5 overflow-x-auto pb-0.5">
              <Chip href="/omnis/certs" active={!stage}>
                전체 <span className="tabular-nums opacity-70">{all.length}</span>
              </Chip>
              {CERT_STAGES.map((s) => (
                <Chip key={s} href={`/omnis/certs?stage=${s}`} active={stage === s}>
                  {CERT_STAGE_LABEL[s]} <span className="tabular-nums opacity-70">{countOf(s)}</span>
                </Chip>
              ))}
            </div>
            <CertList rows={shown} members={members} focus={focus} />
          </section>
        )}
      </div>
    </>
  )
}

function ViewSwitch({ view }: { view: BoardView }) {
  return (
    <div role="group" aria-label="보기" className="ml-auto inline-flex h-9 items-center rounded-full bg-muted p-0.5">
      {(
        [
          { key: "list", label: "목록", icon: MenuSquareIcon, href: "/omnis/certs" },
          { key: "board", label: "보드", icon: DashboardBrowsingIcon, href: "/omnis/certs?view=board" },
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
            view === o.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={o.icon} size={14} strokeWidth={2} aria-hidden />
          <span className="sr-only sm:not-sr-only">{o.label}</span>
        </Link>
      ))}
    </div>
  )
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "touch-target inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-foreground/[0.08]"
      )}
    >
      {children}
    </Link>
  )
}
