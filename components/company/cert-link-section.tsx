import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { CERT_STAGES, CERT_STAGE_LABEL, asCertStage } from "@/lib/grants-labels"

/**
 * 회사 정보 › 인증·가점 — 인증은 아카이브 › 인증 탭으로 옮겼다(2026-11-28). 여기는 단계별 건수와 그 탭으로 가는 링크만 둔다.
 * id="certs" 는 그대로 — 예전 링크(/omnis/company#certs)가 이 자리로 온다
 */
export function CertLinkSection({ counts }: { counts: { stage: string; count: number }[] }) {
  const by = new Map<string, number>()
  for (const c of counts) by.set(asCertStage(c.stage), (by.get(asCertStage(c.stage)) ?? 0) + c.count)
  const total = counts.reduce((a, c) => a + c.count, 0)
  const parts = CERT_STAGES.filter((s) => by.get(s)).map((s) => `${CERT_STAGE_LABEL[s]} ${by.get(s)}`)
  return (
    <section id="certs" aria-labelledby="certs-heading" className="mt-8">
      <h2 id="certs-heading" className="mb-2.5 text-[15px] font-semibold">
        인증·가점
      </h2>
      <Link
        href="/omnis/certs"
        data-company-certs-link
        className="touch-target flex items-center gap-2 rounded-2xl border bg-card px-3 py-3 transition-colors hover:bg-foreground/[0.04]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold">
            인증 탭에서 보기 <span className="font-normal text-muted-foreground tabular-nums">{total}건</span>
          </span>
          {parts.length > 0 && <span className="mt-0.5 block text-[12px] text-muted-foreground">{parts.join(" · ")}</span>}
        </span>
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  )
}
