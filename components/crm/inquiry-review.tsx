"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  Invoice01Icon,
  PackageIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { RecipientSteps } from "./recipient-steps"
import { Step } from "./step"
import { useRecipient, type OrgLite } from "./use-recipient"
import { apiUrl } from "@/lib/base-path"
import {
  INQUIRY_OUTCOMES,
  defaultOutcome,
  topicLabel,
  type InquiryOutcome,
} from "@/lib/website-inquiry-labels"

const OUTCOME_ICON = {
  quote: Invoice01Icon,
  sample: PackageIcon,
  none: UserGroupIcon,
} as const

const OUTCOME_HINT = {
  quote: "품목이 빈 작성중 견적이 열립니다",
  sample: "제품이 빈 미발송 샘플요청이 열립니다",
  none: "문서 없이 기관·담당자만 CRM 에 넣습니다",
} as const

/**
 * 문의 검토 — 견적·샘플요청으로 넘기거나 · 반려 · 스팸.
 *
 * 무엇을 만들지는 **문의 유형이 먼저 고른다.** 샘플 신청으로 들어온 문의에 견적을 만들면
 * 담당자가 지우고 다시 만들어야 한다(실제로 그랬다). 추천일 뿐이라 우측 ⌄ 로 바꿀 수 있다.
 *
 * 누르기 전에는 칸이 하나도 없다. 대부분의 문의는 읽고 반려하거나 메일로 답하고 끝나는데,
 * 그 사람에게 기관·담당자 칸을 미리 펼쳐 보일 이유가 없다.
 *
 * 누른 뒤에는 **모르는 것만** 차례로 묻는다. 이름·소속·이메일·연락처·본문은 이미 위에 있으므로
 * 다시 받지 않는다 — 검색칸에는 문의에 적힌 말이 미리 들어가 있고, 없는 이름이면 그 자리에서
 * 만들면서 이메일·연락처까지 함께 저장된다.
 *
 * 칸을 고르고 만드는 방식은 견적·샘플요청 작성과 같은 것을 쓴다(RecipientSteps).
 * 같은 일을 하는 화면이 서로 다르게 생기면 사람이 화면마다 다시 배워야 한다.
 */
export function InquiryReview({
  inquiryId,
  topic,
  orgs,
  suggestedOrgName,
  contactName,
  contactEmail,
  contactPhone,
}: {
  inquiryId: string
  /** 무엇을 추천할지 고른다 */
  topic: string
  orgs: OrgLite[]
  /** 문의에 적힌 소속 — 기관 검색칸에 미리 들어간다 */
  suggestedOrgName: string
  contactName: string
  contactEmail: string
  contactPhone: string | null
}) {
  const router = useRouter()
  const r = useRecipient(orgs)
  const [outcome, setOutcome] = useState<InquiryOutcome | null>(null)
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  const recommended = defaultOutcome(topic)
  const others = (Object.keys(INQUIRY_OUTCOMES) as InquiryOutcome[]).filter(
    (o) => o !== (outcome ?? recommended)
  )

  // 어디까지 왔는지를 따로 세지 않고 채워진 값에서 끌어낸다 — 견적 작성과 같은 방식이다.
  const ready = Boolean(r.orgId) && (Boolean(r.contactId) || r.contactSkipped)
  const busy = pending || r.busy

  function send(body: Record<string, unknown>, done: string) {
    startTransition(async () => {
      try {
        const res = await fetch(apiUrl(`/api/crm/inquiries/${inquiryId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? "처리하지 못했습니다")
        toast.success(done)
        // 만들어진 문서로 바로 보낸다 — 다음 할 일이 그 안에 있다
        if (data.quoteId) router.push(`/crm/quotes/${data.quoteId}`)
        else if (data.sampleId) router.push(`/crm/samples`)
        else router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  return (
    <section className="mt-4 rounded-xl border bg-card p-4">
      {outcome === null ? (
        <>
          <h2 className="text-[14px] font-semibold">이 문의를 어떻게 할까요?</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            「{topicLabel(topic)}」 문의입니다. 아래 버튼이 기본값이고 ⌄ 로 바꿀 수 있어요.
            반려·스팸은 기관 목록을 건드리지 않습니다.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <OutcomeSplitButton
              current={recommended}
              others={others}
              onPick={setOutcome}
              disabled={busy}
            />
            <RejectButtons note={note} send={send} busy={busy} />
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-2">
            <h2 className="text-[14px] font-semibold">{INQUIRY_OUTCOMES[outcome].label}</h2>
            <span className="text-[11px] text-muted-foreground">{OUTCOME_HINT[outcome]}</span>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="ml-auto text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              그만두기
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <RecipientSteps
              r={r}
              orgQuery={suggestedOrgName}
              contactQuery={contactName}
              // 새 담당자를 만들 때 문의에 적힌 연락처가 함께 들어간다 — 다시 타이핑하지 않는다
              contactExtra={{ email: contactEmail, phone: contactPhone }}
            />

            <Step show={ready} autoFocus label="메모" hint="선택 — 왜 이렇게 처리했는지">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="남길 말이 있으면"
                rows={2}
              />
            </Step>

            <Step show={ready} label="다 됐나요?">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex">
                  <Button
                    disabled={busy}
                    className="touch-target gap-1.5 rounded-r-none"
                    onClick={() =>
                      send(
                        {
                          action: "accept",
                          outcome,
                          orgId: r.orgId,
                          contactId: r.contactId,
                          ...(note.trim() ? { note: note.trim() } : {}),
                        },
                        INQUIRY_OUTCOMES[outcome].done
                      )
                    }
                  >
                    {busy ? (
                      <Spinner />
                    ) : (
                      <HugeiconsIcon icon={OUTCOME_ICON[outcome]} size={15} aria-hidden />
                    )}
                    {INQUIRY_OUTCOMES[outcome].label}
                  </Button>
                  <OutcomeMenu
                    others={others}
                    onPick={setOutcome}
                    disabled={busy}
                    label={`${INQUIRY_OUTCOMES[outcome].label} 말고 다른 것`}
                  />
                </div>
                <RejectButtons note={note} send={send} busy={busy} />
              </div>
            </Step>
          </div>
        </>
      )}
    </section>
  )
}

/** 추천 하나를 큰 버튼으로, 나머지는 우측 ⌄ 안으로. */
function OutcomeSplitButton({
  current,
  others,
  onPick,
  disabled,
}: {
  current: InquiryOutcome
  others: InquiryOutcome[]
  onPick: (o: InquiryOutcome) => void
  disabled: boolean
}) {
  return (
    <div className="inline-flex">
      <Button
        disabled={disabled}
        onClick={() => onPick(current)}
        className="touch-target gap-1.5 rounded-r-none"
      >
        <HugeiconsIcon icon={OUTCOME_ICON[current]} size={15} aria-hidden />
        {INQUIRY_OUTCOMES[current].label}
      </Button>
      <OutcomeMenu
        others={others}
        onPick={onPick}
        disabled={disabled}
        label={`${INQUIRY_OUTCOMES[current].label} 말고 다른 것`}
      />
    </div>
  )
}

function OutcomeMenu({
  others,
  onPick,
  disabled,
  label,
}: {
  others: InquiryOutcome[]
  onPick: (o: InquiryOutcome) => void
  disabled: boolean
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            aria-label={label}
            disabled={disabled}
            className="touch-target rounded-l-none border-l border-primary-foreground/25 px-2"
          />
        }
      >
        <HugeiconsIcon icon={ArrowDown01Icon} size={15} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        {others.map((o) => (
          <DropdownMenuItem key={o} onClick={() => onPick(o)} className="gap-2">
            <HugeiconsIcon icon={OUTCOME_ICON[o]} size={15} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{INQUIRY_OUTCOMES[o].label}</div>
              <div className="text-[11px] text-muted-foreground">{OUTCOME_HINT[o]}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 반려·스팸은 어느 단계에서든 같은 동작이라 한 곳에 둔다. */
function RejectButtons({
  note,
  send,
  busy,
}: {
  note: string
  send: (body: Record<string, unknown>, done: string) => void
  busy: boolean
}) {
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        className="touch-target"
        onClick={() =>
          send(
            { action: "reject", status: "REJECTED", reviewNote: note.trim() || undefined },
            "반려했습니다."
          )
        }
      >
        반려
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        className="touch-target text-muted-foreground"
        onClick={() =>
          send(
            { action: "reject", status: "SPAM", reviewNote: note.trim() || undefined },
            "스팸으로 표시했습니다."
          )
        }
      >
        스팸
      </Button>
    </>
  )
}
