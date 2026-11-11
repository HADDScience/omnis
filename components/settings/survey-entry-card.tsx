import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, BubbleChatSparkIcon } from "@hugeicons/core-free-icons"
import { ENTRY_LABEL, type SurveyEntry } from "@/lib/ai-survey/entry"

const SUB: Record<SurveyEntry, string> = {
  join: "AI 를 얼마나 · 어디에 쓰는지 옴니스가 여쭤봐요. 2~3분.",
  resume: "답하던 곳에서 이어집니다.",
  view: "내 응답 요약을 보고, 다시 할 수도 있어요.",
}

/**
 * 마이 화면의 설문 카드 — 로그아웃 줄 아래. 아직 안 한 사람은 「설문 참여하기」, 제출한 사람은 「설문 확인하기」.
 * 설문이 열린 계정에만 그린다(부르는 쪽이 lib/ai-survey/access.ts 로 가른다).
 */
export function SurveyEntryCard({ entry }: { entry: SurveyEntry }) {
  return (
    <Link
      href="/settings/ai-survey"
      data-ai-survey-entry={entry}
      className="touch-target flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span aria-hidden className="ai-rainbow-border flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <HugeiconsIcon icon={BubbleChatSparkIcon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold">{ENTRY_LABEL[entry]}</span>
        <span className="text-xs break-keep text-muted-foreground">AI 활용 설문 · {SUB[entry]}</span>
      </span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  )
}
