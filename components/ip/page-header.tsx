import type { ReactNode } from "react"

/** 화면 제목 — 옴니스 목록 화면(견적 · 시장기업)과 같은 글자: 18px 굵게 + 13px 설명. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[18px] font-bold tracking-[-0.02em]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  )
}
