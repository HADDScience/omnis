import { CrmTabSkeleton } from "@/components/crm/crm-tab-skeleton"

/** 탭 전환 스켈레톤과 같은 것 — 탭 줄은 진짜라 누른 탭이 켜져 있다(components/crm/crm-tabs.tsx) */
export default function Loading() {
  return <CrmTabSkeleton tab="quotes" />
}
