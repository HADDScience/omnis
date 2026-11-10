import { runsFor, type RunCostBasis } from "@/lib/ai-budget-rules"

/**
 * 원 금액 옆의 「약 n번」 — 보통 대화(최근 30일 중앙값) · 긴 작업(90%값). 폰에서도 한 줄(줄바꿈 없이, 넘치면 말줄임).
 * 표본이 적어 기본 단가를 쓰면 「추정」 을 붙인다. 서버 · 클라이언트 어디서나 그린다(상태 없음).
 */
export function RunsHint({ krw, basis, lead = "≈", more = false, className = "" }: { krw: number; basis: RunCostBasis; lead?: string; more?: boolean; className?: string }) {
  const r = runsFor(Math.max(krw, 0), basis)
  const n = (x: number) => x.toLocaleString("ko-KR")
  const title = `보통 대화 1건 ${basis.typical.toFixed(1)}원 · 긴 작업 1건 ${basis.long.toFixed(1)}원 기준(${basis.estimated ? `실측 ${basis.samples}건 — 20건 미만이라 기본값` : `최근 30일 ${n(basis.samples)}건`})`
  return (
    <span data-runs-hint data-estimated={basis.estimated || undefined} title={title} className={`block truncate whitespace-nowrap text-xs text-muted-foreground ${className}`}>
      {lead} 보통 대화 약 {n(r.typical)}번{more ? " 더" : ""} · 긴 작업 약 {n(r.long)}번{more ? " 더" : ""}
      {basis.estimated && <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">추정</span>}
    </span>
  )
}
