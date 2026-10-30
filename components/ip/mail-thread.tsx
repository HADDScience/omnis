"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ip/ip-dialog"
import { StatusBadge } from "@/components/ip/status-badge"
import { useData } from "@/components/ip/data-provider"
import { formatDate } from "@/lib/ip/date"
import { cn } from "@/lib/utils"
import type { Communication, ProgressEntry } from "@/lib/ip/types"

/**
 * 이 건으로 주고받은 메일.
 *
 * 메일은 두 곳에 흩어져 있다 — 진행 기록(`source='mail'`, 옮겨 적은 요약 + 근거
 * 원문)과 옛 커뮤니케이션 기록(「메일로 입력」이 만든 제목·본문·첨부). 어느 쪽에
 * 있든 사람에게는 같은 「그때 온 메일」이라 한 줄기로 합쳐 보여준다.
 *
 * 요약만 보이면 「정말 그렇게 적혀 있었나」를 확인할 수 없어 결국 메일함을 열게
 * 된다. 그래서 원문은 늘 한 번 눌러 펼 수 있게 둔다. 다만 전부 펴 두면 글자 벽이라
 * (2026-10-29 작업지시자 「글자가 너무 많고 눈에 안 들어온다」) 가장 최근 한 통만
 * 펴고, 나머지는 메일 한 통 = 카드 한 장으로 요약만 보인다.
 */

export interface MailItem {
  key: string
  date: string
  /** 수신 = 상대가 보낸 것 · 송신 = 우리가 보낸 것. 방향을 모르면 null */
  direction: "수신" | "송신" | null
  counterpart: string
  subject: string | null
  /** 옮겨 적은 요약. 진행 기록의 메모다. */
  summary: string
  /** 메일 원문. 진행 기록의 근거 원문이거나 커뮤니케이션 본문이다. */
  body: string | null
  attachments: string[]
  threadId: string | null
  /** 이 메일과 함께 기록된 단계. 커뮤니케이션에는 없다. */
  stage: string | null
  /** 같은 날 기록끼리 순서를 가르는 값 */
  at: string
}

/** 커뮤니케이션의 「발신」은 우리가 보낸 것이다. 진행 기록의 말로 옮긴다. */
function fromCommunication(c: Communication): MailItem {
  const received = c.dir === "수신"
  return {
    key: `comm:${c.id}`,
    date: c.date,
    direction: received ? "수신" : "송신",
    counterpart: (received ? c.from : c.to) || "",
    subject: c.subject || null,
    summary: c.followUp || "",
    body: c.body || null,
    attachments: c.attachments,
    threadId: c.threadId,
    stage: null,
    at: c.date,
  }
}

function fromProgress(e: ProgressEntry): MailItem {
  return {
    key: `prog:${e.id}`,
    date: e.date,
    direction: e.direction,
    counterpart: e.counterpart,
    subject: null,
    summary: e.note,
    body: e.raw,
    attachments: [],
    threadId: null,
    stage: e.stage,
    at: e.createdAt || e.date,
  }
}

/**
 * 이 건의 메일을 최신 순으로.
 *
 * 진행 기록 쪽은 방향이 적혀 있으면 메일로 친다 — `direction` 은 정의상 메일에만
 * 있는 칸이고, 출처가 'manual' 로 남은 옛 기록도 서버가 같은 잣대로 고쳐 왔다.
 */
export function collectMail(
  kind: "trademark" | "patent",
  id: string,
  progress: ProgressEntry[],
  communications: Communication[]
): MailItem[] {
  const mails: MailItem[] = []

  for (const e of progress) {
    if (e.entityKind !== kind || e.entityId !== id) continue
    if (e.direction === null && e.source !== "mail") continue
    mails.push(fromProgress(e))
  }

  for (const c of communications) {
    if (!c.links.some((l) => l.kind === kind && l.id === id)) continue
    mails.push(fromCommunication(c))
  }

  return mails.sort(
    (a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)
  )
}

export function useMailFor(
  kind: "trademark" | "patent",
  id: string
): MailItem[] {
  const { progress, communications } = useData()
  return useMemo(
    () => collectMail(kind, id, progress, communications),
    [kind, id, progress, communications]
  )
}

const gmailUrl = (threadId: string) =>
  `https://mail.google.com/mail/u/0/#all/${threadId}`

export function MailThread({
  items,
  className,
}: {
  items: MailItem[]
  className?: string
}) {
  if (items.length === 0) {
    return (
      <p className={cn("py-6 text-center text-muted-foreground", className)}>
        이 건으로 주고받은 메일 기록이 아직 없습니다.
        <br />
        <span className="text-[12px]">
          메일을 옮겨 적을 때 방향(수신·송신)을 채우면 여기에 모입니다.
        </span>
      </p>
    )
  }

  return (
    <ol className={cn("flex flex-col gap-2.5", className)}>
      {items.map((m, i) => (
        // 맨 위(가장 최근) 한 통만 원문을 펴 둔다 — 전부 펴면 글자 벽이 된다(2026-10-29 작업지시자).
        <MailCard key={m.key} mail={m} defaultOpen={i === 0} />
      ))}
    </ol>
  )
}

/**
 * 메일 한 통 = 카드 한 장. 머리(방향 · 누가 누구에게 · 날짜) → 제목 → 요약 → 원문(접힘).
 * 원문은 머리 줄(보낸사람 · 받는사람 …)을 표로 떼고, 인용된 앞 메일은 한 번 더 접는다.
 */
function MailCard({ mail: m, defaultOpen }: { mail: MailItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showQuoted, setShowQuoted] = useState(false)
  const parsed = useMemo(() => (m.body ? parseMailBody(m.body) : null), [m.body])
  const received = m.direction === "수신"

  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        // 받은 메일은 왼쪽 띠로 갈라 본다 — 방향이 글자보다 먼저 보이게
        received ? "border-l-[3px] border-l-sky-500" : m.direction === "송신" ? "border-l-[3px] border-l-primary" : ""
      )}
    >
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          {m.direction ? (
            <Badge
              className={cn(
                received
                  ? "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
                  : "bg-primary/10 text-primary"
              )}
            >
              {received ? "받음" : "보냄"}
            </Badge>
          ) : (
            <Badge variant="outline">기록</Badge>
          )}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
            {m.direction === "수신"
              ? `${m.counterpart || "상대"} → 우리`
              : m.direction === "송신"
                ? `우리 → ${m.counterpart || "상대"}`
                : m.counterpart}
          </span>
          <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
            {formatDate(m.date)}
          </span>
        </div>

        {m.subject ? (
          <p className="text-[13.5px] font-semibold text-foreground">{m.subject}</p>
        ) : null}

        {m.summary ? (
          <p className="text-[13px] leading-relaxed break-keep whitespace-pre-wrap text-foreground">
            {m.summary}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {m.stage ? <StatusBadge status={m.stage} /> : null}
          {m.attachments.map((a) => (
            <Badge key={a} variant="outline" className="max-w-full truncate">
              {a}
            </Badge>
          ))}
          <span className="ml-auto flex items-center gap-2">
            {m.threadId ? (
              <a
                href={gmailUrl(m.threadId)}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-primary hover:underline"
              >
                Gmail 에서 열기
              </a>
            ) : null}
            {m.body ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="touch-target text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                {open ? "원문 접기" : "원문 보기"}
              </button>
            ) : (
              <span className="text-[12px] text-muted-foreground">원문 없음</span>
            )}
          </span>
        </div>
      </div>

      {open && parsed ? (
        <div className="border-t bg-muted/40 px-3 py-2.5 text-[12.5px]">
          {parsed.headers.length > 0 ? (
            <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
              {parsed.headers.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="leading-relaxed break-keep whitespace-pre-wrap text-foreground/90">
            {parsed.main}
          </p>
          {parsed.quoted ? (
            <div className="mt-2">
              <button
                type="button"
                aria-expanded={showQuoted}
                onClick={() => setShowQuoted((v) => !v)}
                className="touch-target text-[12px] text-muted-foreground hover:text-foreground"
              >
                {showQuoted ? "인용 접기" : "… 인용된 앞 메일 보기"}
              </button>
              {showQuoted ? (
                <p className="mt-1 border-l-2 pl-2 text-[12px] leading-relaxed break-keep whitespace-pre-wrap text-muted-foreground">
                  {parsed.quoted}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

const HEADER_LINE = /^(보낸사람|받는사람|참조|숨은참조|날짜|제목|From|To|Cc|Date|Subject)\s*[:：]\s*(.*)$/i
const QUOTE_START = /^(-{3,}.*(인용|원본|Original|Forwarded|전달).*|On .+wrote:|.+님이 작성:|>.*)$/i

/**
 * 원문을 세 조각으로 — 맨 위 머리 줄들, 본문, 인용된 앞 메일.
 * 모양이 맞지 않으면 통째로 본문으로 둔다(잘못 자르는 것보다 다 보이는 게 낫다).
 */
export function parseMailBody(body: string): {
  headers: [string, string][]
  main: string
  quoted: string | null
} {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const headers: [string, string][] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].trim().match(HEADER_LINE)
    if (!m) break
    let value = m[2]
    // 머리 값이 다음 줄로 넘어간 경우(긴 참조 목록) — 다음 줄이 머리도 빈 줄도 아니면 잇는다
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() !== "" &&
      !HEADER_LINE.test(lines[i + 1].trim()) &&
      /^<[^>]+>,?$|^[^\s]+@[^\s]+/.test(lines[i + 1].trim())
    ) {
      value += " " + lines[i + 1].trim()
      i++
    }
    headers.push([m[1], value])
    i++
  }
  const rest = lines.slice(i)
  const q = rest.findIndex((l) => QUOTE_START.test(l.trim()))
  // 메일은 문장마다 빈 줄을 두는 일이 많아 그대로 두면 세로로 길게 늘어진다 — 빈 줄은 하나로 접는다
  const main = (q === -1 ? rest : rest.slice(0, q)).join("\n").replace(/\n[ \t]*\n+/g, "\n").trim()
  const quoted = q === -1 ? null : rest.slice(q).join("\n").replace(/\n[ \t]*\n+/g, "\n").trim()
  return { headers, main: main || (quoted ?? ""), quoted: main ? quoted : null }
}

/**
 * IP 목록에서 펼친 줄에 놓는 버튼. 메일은 길어서 표 한가운데 펼치면 아래 건들이
 * 화면 밖으로 밀려난다 — 읽는 자리를 따로 연다.
 */
export function MailDialog({
  kind,
  id,
  title,
}: {
  kind: "trademark" | "patent"
  id: string
  title: string
}) {
  const items = useMailFor(kind, id)

  return (
    <Dialog>
      <DialogTrigger
        onClick={(e) => e.stopPropagation()}
        disabled={items.length === 0}
        render={<Button size="xs" variant="outline" />}
      >
        {items.length === 0
          ? "주고받은 메일 없음"
          : `메일 내용 확인하기 · ${items.length}건`}
      </DialogTrigger>
      <DialogContent
        onClick={(e) => e.stopPropagation()}
        className="sm:max-w-[46rem]"
      >
        <DialogHeader className="pr-10">
          <DialogTitle>주고받은 메일 · {title}</DialogTitle>
          <DialogDescription>
            최신이 위입니다. 모두 {items.length}건. 「원문 보기」로 메일 원문을 폅니다.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <MailThread items={items} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
