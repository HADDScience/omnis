"use client"

import { useState, type ReactNode } from "react"
import { CertEditor } from "@/components/company/cert-editor"
import { seoulYmd } from "@/lib/grants-labels"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  CertStatus,
  CompanyCertification,
} from "@/generated/prisma/client"

/**
 * 회사 정보 화면의 「인증·가점」 구역. 위 묶음 전환으로 한 묶음씩, 인증마다 한 줄 요약 —
 * 줄을 누르면 판정 이유 · 자격조건 · 신청기간 · 비용 · 유효기간 · 근거와 고치기(cert-editor)가 펼쳐진다.
 */
/** 서울 날짜 — 이식한 연혁 · 고친 취득일 모두 서울 자정이다 */
const ymd = seoulYmd

type Cert = CompanyCertification & {
  record: { title: string; startsOn: Date | null } | null
}

const GROUPS: { key: string; status: CertStatus[]; label: string }[] = [
  { key: "held", status: ["HELD"], label: "보유" },
  { key: "candidate", status: ["CANDIDATE"], label: "취득 후보" },
  { key: "ineligible", status: ["NOT_ELIGIBLE"], label: "자격 안 됨" },
  { key: "renewal", status: ["RENEWAL_DUE", "EXPIRED"], label: "갱신 필요" },
]

const STATUS_CHIP: Record<CertStatus, { label: string; cls: string }> = {
  HELD: {
    label: "보유",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  RENEWAL_DUE: {
    label: "갱신 필요",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  EXPIRED: {
    label: "만료",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  CANDIDATE: {
    label: "후보",
    cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  NOT_ELIGIBLE: { label: "자격 안 됨", cls: "bg-muted text-muted-foreground" },
}

type Research = {
  requirements?: string[]
  our_status?: string
  our_status_reason?: string
  application_window?: string
  window_2026_12_2027?: string
  time_to_issue?: string
  cost?: string
  validity?: string
  sources?: { title?: string; url?: string }[]
}
type Bonus = { medibio?: string | null; mss?: string | null }

const PRIORITY_RANK: Record<string, number> = { 상: 0, 중: 1, 하: 2 }

/** 가점 원문에서 가장 큰 점수(+3~5점 → 5). 없으면 0 */
export function bonusScore(b: Bonus): number {
  const nums = [b.medibio, b.mss]
    .flatMap((s) => (s ?? "").match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
  return nums.length ? Math.max(...nums) : 0
}

/** 한 줄에 들어갈 가점 — 「+3~5점 (단일 최대)」 → 「중기부 +3~5점」 */
function bonusShort(b: Bonus): string | null {
  const cut = (s?: string | null) =>
    s
      ?.match(/[+＋]?\s*[\d.]+(?:\s*~\s*[\d.]+)?\s*점/)?.[0]
      .replace(/\s/g, "") ?? null
  const parts = [
    cut(b.medibio) && `메디 ${cut(b.medibio)}`,
    cut(b.mss) && `중기부 ${cut(b.mss)}`,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

/** 한 줄에 들어갈 걸리는 기간 — 원문이 문장이면 처음 나오는 기간(1~4주 · 30일 · 3개월)만 */
function timeShort(t?: string): string | null {
  if (!t) return null
  const m = t.match(/\d+(?:\s*~\s*\d+)?\s*(?:영업일|일|주|개월|달)/)
  if (m) return m[0].replace(/\s/g, "")
  return t.length > 14 ? `${t.slice(0, 14)}…` : t
}

function sortCerts(list: Cert[]): Cert[] {
  return [...list].sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority ?? ""] ?? 9) -
        (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
      bonusScore((b.bonus ?? {}) as Bonus) -
        bonusScore((a.bonus ?? {}) as Bonus) ||
      a.name.localeCompare(b.name, "ko")
  )
}

export function CertSection({ certs }: { certs: Cert[] }) {
  const groups = GROUPS.map((g) => ({
    ...g,
    list: sortCerts(certs.filter((c) => g.status.includes(c.status))),
  }))
  const [active, setActive] = useState(
    groups.find((g) => g.list.length)?.key ?? "held"
  )
  const [open, setOpen] = useState<string | null>(null)
  const current = groups.find((g) => g.key === active) ?? groups[0]

  return (
    <section id="certs" aria-labelledby="certs-heading" className="mt-8">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 id="certs-heading" className="text-[15px] font-semibold">
          인증·가점
        </h2>
      </div>
      {certs.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
          등록된 인증이 없습니다.
        </p>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="인증 묶음"
            className="mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5"
          >
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={g.key === active}
                onClick={() => {
                  setActive(g.key)
                  setOpen(null)
                }}
                className={`touch-target inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
                  g.key === active
                    ? "bg-foreground text-background"
                    : "glass text-foreground"
                }`}
              >
                {g.label}
                <span
                  className={`tabular-nums ${g.key === active ? "opacity-80" : "text-muted-foreground"}`}
                >
                  {g.list.length}
                </span>
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            aria-label={current.label}
            className="glass overflow-hidden rounded-2xl"
          >
            {current.list.length === 0 ? (
              <p className="p-4 text-[13px] text-muted-foreground">
                인증이 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--glass-edge)]">
                {current.list.map((c) => (
                  <CertRow
                    key={c.id}
                    c={c}
                    open={open === c.id}
                    onToggle={() => setOpen(open === c.id ? null : c.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function CertRow({
  c,
  open,
  onToggle,
}: {
  c: Cert
  open: boolean
  onToggle: () => void
}) {
  const r = (c.research ?? {}) as Research
  const b = (c.bonus ?? {}) as Bonus
  const chip = STATUS_CHIP[c.status]
  const bonus = bonusShort(b)
  const bonusRaw =
    [b.medibio && `메디바이오 ${b.medibio}`, b.mss && `중기부 ${b.mss}`]
      .filter(Boolean)
      .join(" · ") || null
  const detail: [string, ReactNode][] = [
    ["판정 이유", r.our_status_reason],
    [
      "자격조건",
      r.requirements?.length
        ? r.requirements.map((x) => `· ${x}`).join("\n")
        : null,
    ],
    ["신청기간", r.window_2026_12_2027 || r.application_window],
    ["걸리는 기간", r.time_to_issue],
    ["비용", r.cost],
    ["유효기간", c.validUntil ? `${ymd(c.validUntil)} 까지` : r.validity],
    ["가점", bonusRaw && <BonusValue text={bonusRaw} />],
    [
      "취득",
      c.acquiredOn
        ? ymd(c.acquiredOn)
        : c.record
          ? `${c.record.title} ${ymd(c.record.startsOn) ?? ""}`
          : null,
    ],
    ["발급", c.issuer],
    ["메모", c.note],
  ]

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${c.name} ${open ? "접기" : "펼치기"}`}
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold">
              {c.name}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium ${chip.cls}`}
            >
              {chip.label}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted-foreground">
            {bonus && <span className="text-foreground">{bonus}</span>}
            {r.our_status && <span>자격 {r.our_status}</span>}
            <span>
              {timeShort(r.time_to_issue)
                ? `걸림 ${timeShort(r.time_to_issue)}`
                : "걸리는 기간 미확인"}
            </span>
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-xl bg-background/50 p-3 text-[12px] sm:grid-cols-[84px_1fr]">
            {detail
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words whitespace-pre-line">{v}</dd>
                </div>
              ))}
          </dl>
          {(r.sources?.length || c.researchedAt) && (
            <p className="mt-1.5 flex flex-wrap gap-x-2.5 text-[11.5px] text-muted-foreground">
              {r.sources?.map((s, i) =>
                s.url ? (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    title={s.title}
                  >
                    근거 {i + 1}
                  </a>
                ) : null
              )}
              {c.researchedAt && <span>조사 {ymd(c.researchedAt)}</span>}
            </p>
          )}
          <CertEditor cert={c} />
        </div>
      )}
    </li>
  )
}

/** 가점 값 — 공고마다 다르다는 점은 옆 정보 아이콘 툴팁으로만 */
function BonusValue({ text }: { text: string }) {
  return (
    <span className="inline-flex items-start gap-1">
      <span>{text}</span>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label="가점 안내"
          className="mt-px inline-flex shrink-0 cursor-help text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className="size-3.5"
          />
        </TooltipTrigger>
        <TooltipContent>가점은 공고마다 다릅니다</TooltipContent>
      </Tooltip>
    </span>
  )
}
