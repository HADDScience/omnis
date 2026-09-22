"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Mail01Icon } from "@hugeicons/core-free-icons"

import { Input } from "@/components/ui/input"
import { INQUIRY_STATUS_LABEL, topicLabel } from "@/lib/website-inquiry-labels"
import { cn } from "@/lib/utils"

export interface InquiryRow {
  id: string
  createdAt: string
  name: string
  organization: string | null
  email: string
  topic: string
  message: string
  lang: string
  status: "NEW" | "ACCEPTED" | "REJECTED" | "SPAM"
  quoteId: string | null
}

const STATUS_STYLE: Record<InquiryRow["status"], string> = {
  NEW: "border-primary/30 bg-primary/10 font-medium text-primary",
  ACCEPTED: "border-transparent bg-muted text-muted-foreground",
  REJECTED: "border-transparent bg-muted text-muted-foreground",
  SPAM: "border-transparent bg-muted text-muted-foreground",
}

/**
 * 홈페이지 문의 목록.
 *
 * 승인·반려는 여기서 하지 않는다 — 기관을 고르고 담당자를 정하는 판단이라 원문을 읽어야 한다.
 * 목록은 무엇이 남았는지만 보여 주고 상세로 보낸다.
 */
export function InquiryList({ inquiries }: { inquiries: InquiryRow[] }) {
  const [q, setQ] = useState("")

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return inquiries
    return inquiries.filter((i) =>
      `${i.name} ${i.organization ?? ""} ${i.email} ${i.message}`.toLowerCase().includes(t)
    )
  }, [inquiries, q])

  const pending = inquiries.filter((i) => i.status === "NEW").length

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[18px] font-bold tracking-[-0.02em]">문의</h1>
        <span className="text-[13px] text-muted-foreground">
          {inquiries.length}건{pending > 0 && ` · 검토 대기 ${pending}건`}
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 소속 · 이메일 · 내용으로 찾기"
          aria-label="문의 검색"
          className="ml-auto h-8 w-full max-w-[280px]"
        />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-16 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={Mail01Icon} size={20} aria-hidden />
          </div>
          <p className="text-[14px] font-semibold">
            {q ? "찾는 문의가 없습니다" : "아직 들어온 문의가 없습니다"}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {q ? "다른 말로 찾아보세요." : "홈페이지 문의하기 폼으로 들어옵니다."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((i) => (
            <Link
              key={i.id}
              href={`/crm/inquiries/${i.id}`}
              className="touch-target block rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]",
                    STATUS_STYLE[i.status]
                  )}
                >
                  {INQUIRY_STATUS_LABEL[i.status]}
                </span>
                <span className="text-[14px] font-semibold">{i.name}</span>
                {i.organization && (
                  <span className="text-[12px] text-muted-foreground">{i.organization}</span>
                )}
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {topicLabel(i.topic)}
                </span>
                {i.lang !== "ko" && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground uppercase">
                    {i.lang}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
                  {i.createdAt.slice(0, 10)}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">{i.message}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
