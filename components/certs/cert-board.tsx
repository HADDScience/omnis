"use client"

import Link from "next/link"
import { send } from "@/components/grants/send"
import { StageBoard } from "@/components/ui/stage-board"
import { CERT_COLUMNS, type CertView } from "@/components/certs/cert-view"
import { deadlineText } from "@/components/certs/cert-dates"
import { checklistProgress } from "@/lib/certs"
import { CERT_STAGE_LABEL, type CertStage } from "@/lib/grants-labels"

type BoardCert = CertView & { title: string }

/**
 * 인증 보드 — 단계 여덟 열(후보 · 준비 · 신청 · 심사 중 · 보유 · 갱신 필요 · 만료 · 중단).
 * 목록의 제자리 편집과 같은 PATCH(/api/company/certifications/[id])에 expect(옮기기 전 단계)를 붙인다.
 * 열 · 끌기 · 메뉴는 국가과제 보드와 같은 components/ui/stage-board.tsx
 */
export function CertBoard({ rows }: { rows: CertView[] }) {
  return (
    <StageBoard<CertStage, BoardCert>
      name="certs"
      columns={CERT_COLUMNS}
      rows={rows.map((r) => ({ ...r, title: r.name }))}
      columnClassName="bg-muted/60"
      gridClassName="xl:grid-cols-8"
      face={(c) => <CardFace c={c} />}
      save={async (c, to) => {
        await send(`/api/company/certifications/${c.id}`, "PATCH", { status: to, expect: { status: c.stage } })
      }}
      done={(c, from, to) => `${c.name} · ${CERT_STAGE_LABEL[from]} → ${CERT_STAGE_LABEL[to]}`}
    />
  )
}

function CardFace({ c }: { c: BoardCert }) {
  const due = c.stage === "HELD" || c.stage === "RENEWAL_DUE" || c.stage === "EXPIRED" ? null : deadlineText(c.deadline)
  const check = checklistProgress(c.checklist)
  return (
    <div className="rounded-xl bg-background px-3 py-2.5 pr-8 transition-colors hover:bg-background/80">
      <Link
        href={`/omnis/certs?cert=${c.id}`}
        data-no-drag
        className="line-clamp-3 text-[13.5px] leading-snug font-semibold break-keep [overflow-wrap:anywhere] hover:underline"
      >
        {c.name}
      </Link>
      <p className="mt-1 truncate text-[12px] text-muted-foreground">
        {[c.issuer, c.owner?.name ?? "담당 없음"].filter(Boolean).join(" · ")}
      </p>
      {(due || check.total > 0 || c.bonusRows.length > 0) && (
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted-foreground tabular-nums">
          {due && <span data-certs-due>{due}</span>}
          {check.total > 0 && (
            <span data-certs-check>
              준비물 {check.done}/{check.total}
            </span>
          )}
          {c.bonusRows.length > 0 && <span data-certs-bonus>가점 공고 {c.bonusRows.length}</span>}
        </p>
      )}
    </div>
  )
}
