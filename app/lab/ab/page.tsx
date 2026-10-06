import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { labStatus } from "@/bench/lab-ab/trial"
import { labAdmin } from "./guard"
import { AbLab } from "./ab-lab"

export const metadata: Metadata = { title: "블라인드 A/B 평가 · Lab", robots: { index: false } }
export const dynamic = "force-dynamic"

/**
 * 블라인드 A/B 평가 — 로컬 `next dev` · ADMIN 전용. 그 밖에는 404.
 * 계획: mydocs/plans/2026-10-06-weknora-lab.md 「블라인드 A/B 화면」. 서버 로직은 bench/lab-ab/trial.ts.
 * 업무 화면 레이아웃((main)) 밖에 둔다 — 채팅 독 · 사이드바가 비교를 가리지 않게.
 */
export default async function LabAbPage() {
  if (!(await labAdmin())) notFound()
  return <AbLab initialStatus={labStatus()} />
}
