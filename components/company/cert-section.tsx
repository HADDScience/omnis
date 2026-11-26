"use client"

import { useState, type ReactNode } from "react"
import { CertFields } from "@/components/company/cert-editor"
import { seoulYmd } from "@/lib/grants-labels"
import {
  isTipsItem,
  readTipsBonus,
  tipsShort,
  type TipsBonus,
  type TipsRules,
} from "@/lib/grants-tips"
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
 * 줄을 누르면 판정 이유 · 자격조건 · 신청기간 · 비용 · 근거와, 그 자리에서 고치는 상태 · 취득일 · 유효기간 · 메모(cert-editor)가 펼쳐진다.
 */
/** 서울 날짜 — 이식한 연혁 · 고친 취득일 모두 서울 자정이다 */
const ymd = seoulYmd

type Cert = CompanyCertification & {
  record: { title: string; startsOn: Date | null } | null
}

const GROUPS: {
  key: string
  label: string
  pick: (c: Cert) => boolean
}[] = [
  { key: "held", label: "보유", pick: (c) => c.status === "HELD" },
  {
    key: "candidate",
    label: "취득 후보",
    pick: (c) => c.status === "CANDIDATE",
  },
  {
    key: "ineligible",
    label: "자격 안 됨",
    pick: (c) => c.status === "NOT_ELIGIBLE",
  },
  {
    key: "renewal",
    label: "갱신 필요",
    pick: (c) => c.status === "RENEWAL_DUE" || c.status === "EXPIRED",
  },
  // 상태와 따로 — TIPS 가점표(일반 · 딥테크)에 있는 항목
  {
    key: "tips",
    label: "TIPS",
    pick: (c) => isTipsItem(readTipsBonus(c.research)),
  },
]

/** TIPS 가점 숫자 — 처음 나오는 「N점」(일반 · 딥테크 중 큰 쪽). 없으면 0 */
function tipsScore(t: TipsBonus | null): number {
  if (!t) return 0
  const first = (p: string | null) =>
    Number(p?.match(/([\d.]+)\s*점/)?.[1] ?? 0)
  return Math.max(
    t.general.applies ? first(t.general.points) : 0,
    t.deeptech.applies ? first(t.deeptech.points) : 0
  )
}

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

export function CertSection({
  certs,
  tipsRules,
}: {
  certs: Cert[]
  tipsRules: TipsRules | null
}) {
  const groups = GROUPS.map((g) => {
    const list = sortCerts(certs.filter(g.pick))
    return {
      ...g,
      list:
        g.key === "tips"
          ? [...list].sort(
              (a, b) =>
                tipsScore(readTipsBonus(b.research)) -
                tipsScore(readTipsBonus(a.research))
            )
          : list,
    }
  }).filter((g) => g.key !== "tips" || g.list.length > 0)
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
            {current.key === "tips" && tipsRules && (
              <TipsRulesLine rules={tipsRules} />
            )}
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
  const tips = readTipsBonus(c.research)
  const tipsLine = tipsShort(tips)
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
    ["가점", bonusRaw && <BonusValue text={bonusRaw} />],
    ["TIPS 가점", isTipsItem(tips) && <TipsValue t={tips!} />],
    ["발급", c.issuer],
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
            {tipsLine && (
              <span className="text-foreground">TIPS {tipsLine}</span>
            )}
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
          <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 rounded-xl bg-background/50 p-3 text-[12px] sm:grid-cols-[84px_1fr]">
            {detail
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="pt-1 text-muted-foreground">{k}</dt>
                  <dd className="py-1 break-words whitespace-pre-line">{v}</dd>
                </div>
              ))}
            <CertFields
              cert={c}
              acquiredHint={
                c.record
                  ? `${c.record.title} ${ymd(c.record.startsOn) ?? ""}`.trim()
                  : null
              }
              validityHint={r.validity}
            />
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

/** TIPS 가점 — 트랙별 점수와 지금(개인) · 법인 전환 뒤 판정 */
function TipsValue({ t }: { t: TipsBonus }) {
  const rows: [string, string | null][] = [
    ["일반", t.general.applies ? t.general.points : null],
    ["딥테크", t.deeptech.points],
    ["지금", t.sole],
    ["법인 뒤", t.corp && t.corp !== t.sole ? t.corp : null],
  ]
  return (
    <span className="block space-y-0.5">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <span key={k} className="flex gap-1.5">
            <span className="w-12 shrink-0 text-muted-foreground">{k}</span>
            <span className="min-w-0">{v}</span>
          </span>
        ))}
    </span>
  )
}

/** TIPS 묶음 위 한 줄 — 트랙별 가점 합산 상한 · 접수 · 근거 공고 */
function TipsRulesLine({ rules }: { rules: TipsRules }) {
  const cap = (s: string | null) => s?.replace(/^가점 합산\s*/, "") ?? null
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-[var(--glass-edge)] px-3 py-2 text-[12px] text-muted-foreground">
      {rules.generalCap && (
        <span>
          일반 <span className="text-foreground">{cap(rules.generalCap)}</span>
        </span>
      )}
      {rules.deeptechCap && (
        <span className="inline-flex items-center gap-1">
          딥테크{" "}
          <span className="text-foreground">{cap(rules.deeptechCap)}</span>
          {rules.deeptechNote && (
            <Tooltip>
              <TooltipTrigger
                type="button"
                aria-label="딥테크트랙 요건"
                className="inline-flex shrink-0 cursor-help hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              </TooltipTrigger>
              <TooltipContent>{rules.deeptechNote}</TooltipContent>
            </Tooltip>
          )}
        </span>
      )}
      {rules.window && <span>{rules.window.split(".")[0]}</span>}
      {rules.basisUrl && (
        <a
          href={rules.basisUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={rules.basisTitle ?? undefined}
          className="hover:underline"
        >
          근거 공고
        </a>
      )}
    </p>
  )
}
