import { Badge } from "@/components/ui/badge"
import { ymd } from "@/lib/company-context"
import type {
  CertStatus,
  CompanyCertification,
} from "@/generated/prisma/client"

/** 회사 정보 화면의 「인증·가점」 구역(읽기). 편집 · AI 도구는 다음 단계 — PR #264 */
const GROUPS: { status: CertStatus[]; label: string }[] = [
  { status: ["HELD"], label: "보유" },
  { status: ["RENEWAL_DUE", "EXPIRED"], label: "갱신 필요" },
  { status: ["CANDIDATE"], label: "취득 후보" },
  { status: ["NOT_ELIGIBLE"], label: "자격 안 됨" },
]

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

export function CertSection({
  certs,
}: {
  certs: (CompanyCertification & {
    record: { title: string; startsOn: Date | null } | null
  })[]
}) {
  return (
    <section id="certs" aria-labelledby="certs-heading" className="mt-8">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 id="certs-heading" className="text-[15px] font-semibold">
          인증·가점
        </h2>
        <span className="text-[12px] text-muted-foreground">
          가점은 공고마다 다르다 · 조사 문장은 조사일 기준
        </span>
      </div>
      {certs.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
          인증 자료가 없습니다. <code>scripts/import-grants.ts --apply</code> 로
          옮기면 여기에 보입니다.
        </p>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const list = certs.filter((c) => g.status.includes(c.status))
            if (list.length === 0) return null
            return (
              <div key={g.label}>
                <h3 className="mb-1.5 text-[13px] font-semibold">
                  {g.label}{" "}
                  <span className="font-normal text-muted-foreground">
                    {list.length}
                  </span>
                </h3>
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {list.map((c) => (
                    <CertCard key={c.id} c={c} />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CertCard({
  c,
}: {
  c: CompanyCertification & {
    record: { title: string; startsOn: Date | null } | null
  }
}) {
  const r = (c.research ?? {}) as Research
  const b = (c.bonus ?? {}) as Bonus
  const rows: [string, string | null | undefined][] = [
    [
      "가점",
      [b.medibio && `메디바이오 ${b.medibio}`, b.mss && `중기부 ${b.mss}`]
        .filter(Boolean)
        .join(" · ") || null,
    ],
    [
      "우리 충족",
      [r.our_status, r.our_status_reason].filter(Boolean).join(" — ") || null,
    ],
    ["신청기간", r.window_2026_12_2027 || r.application_window],
    ["걸리는 기간", r.time_to_issue],
    ["비용", r.cost],
    ["유효기간", c.validUntil ? `${ymd(c.validUntil)} 까지` : r.validity],
    [
      "취득",
      c.acquiredOn
        ? ymd(c.acquiredOn)
        : c.record
          ? `${c.record.title} ${ymd(c.record.startsOn) ?? ""}`
          : null,
    ],
    ["메모", c.note],
  ]
  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[13.5px] font-semibold">{c.name}</span>
        {c.priority && <Badge variant="outline">우선 {c.priority}</Badge>}
        {c.issuer && (
          <span className="text-[11.5px] text-muted-foreground">
            {c.issuer}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[76px_1fr] gap-x-2 gap-y-1 text-[12px]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
      </dl>
      {(r.sources?.length || c.researchedAt) && (
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          {r.sources?.slice(0, 3).map((s, i) =>
            s.url ? (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                근거 {i + 1}
              </a>
            ) : null
          )}
          {c.researchedAt && <span>조사 {ymd(c.researchedAt)}</span>}
        </p>
      )}
    </li>
  )
}
