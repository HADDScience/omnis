"use client"

/**
 * 옴니스 답의 출처 글(CHAT_MESSAGE) — 각주 [n] 의 바로가기와 답 아래 파일 카드.
 *
 * 출처 글의 자리 · 첨부는 서버가 권한을 보고 준다(/api/omnis/source-messages → lib/source-messages.ts):
 * 못 보는 글은 오지 않고, 첨부는 방 참여자 · 전용 첨부 규칙을 지난 것만 온다. 파일 열기 · 내려받기도 /api/files/:id/raw 가 같은 규칙으로 한 번 더 본다.
 * 카톡에서 옮길 때 실물을 받지 못한 자리표시 글(「File: 이름」)은 「원본 파일이 옴니스에 없음」 카드로 — 있다고 보이지 않는다.
 * 카드는 떠 있는 nav 와 같은 유리(.glass)다.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon, Download04Icon, File02Icon, FileNotFoundIcon, LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { apiUrl } from "@/lib/base-path"
import { citedNumbers } from "@/lib/photo-album"
import { MISSING_ATTACHMENT_ADVICE, missingAttachmentLabel } from "@/lib/kakao-placeholder"
import type { MentionedFile, SourceFact, SourceFile } from "@/lib/source-facts"
import { cn } from "@/lib/utils"

interface SourceLike {
  source: string
  sourceId: string
}

/** 출처 글 id → 자리 · 첨부. 아직 모르면(받는 중 · 못 보는 글) 없다 */
export type SourceFacts = ReadonlyMap<string, SourceFact>

const SourceFactsContext = createContext<SourceFacts>(new Map())
export const SourceFactsProvider = SourceFactsContext.Provider
export function useSourceFact(sourceId: string | undefined): SourceFact | undefined {
  return useContext(SourceFactsContext).get(sourceId ?? "")
}

/** 이 답의 채팅 출처를 한 번에 받는다. 같은 출처 목록이면 다시 받지 않는다 */
export function useSourceFacts(sources: readonly SourceLike[]): SourceFacts {
  const ids = useMemo(() => [...new Set(sources.filter((s) => s.source === "CHAT_MESSAGE").map((s) => s.sourceId))].join(","), [sources])
  const [facts, setFacts] = useState<{ key: string; map: SourceFacts }>({ key: "", map: new Map() })
  useEffect(() => {
    if (!ids) return
    let gone = false
    void fetch(apiUrl(`/api/omnis/source-messages?ids=${encodeURIComponent(ids)}`))
      .then((r) => (r.ok ? (r.json() as Promise<{ facts: SourceFact[] }>) : null))
      .then((body) => {
        if (!gone && body) setFacts({ key: ids, map: new Map(body.facts.map((f) => [f.id, f])) })
      })
      .catch(() => {})
    return () => {
      gone = true
    }
  }, [ids])
  return facts.key === ids ? facts.map : EMPTY
}
const EMPTY: SourceFacts = new Map()

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d)
}

/**
 * 답 아래 파일 카드 — 답이 각주로 가리킨 채팅 글의 첨부(열기 · 내려받기)와, 첨부 없는 자리표시 글,
 * 그리고 첨부 없는 글이 이름을 댄 파일과 이름이 똑같은 다른 곳의 첨부(「이름이 같은 파일」 — 서버가 볼 수 있는 것만 준다).
 * 답이 가리키지 않은 출처는 그리지 않는다(사진 묶음과 같다).
 */
export function SourceFiles({ answer, sources, facts }: { answer: string; sources: readonly SourceLike[]; facts: SourceFacts }) {
  const cited = useMemo(() => citedNumbers(answer, sources.length), [answer, sources.length])
  const items = useMemo(() => {
    const seen = new Set<string>()
    // 같은 파일을 두 글이 이름 대면 카드는 한 장 — 자기 첨부로 이미 그린 파일도 다시 그리지 않는다
    const shown = new Set<string>()
    const out: { num: number; fact: SourceFact; mentioned: MentionedFile[] }[] = []
    sources.forEach((s, i) => {
      if (s.source !== "CHAT_MESSAGE" || !cited.has(i + 1) || seen.has(s.sourceId)) return
      const fact = facts.get(s.sourceId)
      if (!fact) return
      for (const f of fact.files) shown.add(f.id)
      const mentioned = (fact.mentioned ?? []).filter((f) => !shown.has(f.id))
      for (const f of mentioned) shown.add(f.id)
      if (fact.files.length === 0 && !fact.missing && mentioned.length === 0) return
      seen.add(s.sourceId)
      out.push({ num: i + 1, fact, mentioned })
    })
    return out
  }, [sources, cited, facts])
  if (items.length === 0) return null

  return (
    <ul data-source-files className="mt-3 flex max-w-[460px] flex-col gap-2" aria-label="출처 파일">
      {items.flatMap(({ num, fact, mentioned }) => [
        ...fact.files.map((f) => (
          <FileCard key={f.id} file={f} meta={<>{sizeLabel(f.size)} · {fact.place} · {fact.author} {dayLabel(fact.createdAt)}</>} num={num} jump={{ href: fact.href, place: fact.place }} />
        )),
        fact.files.length === 0 && fact.missing ? (
          <li key={fact.id} data-source-missing={fact.id} className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <HugeiconsIcon icon={FileNotFoundIcon} size={18} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="line-clamp-2 text-[13px] font-medium break-all text-muted-foreground line-through decoration-muted-foreground/40" title={missingAttachmentLabel(fact.missing)}>
                {missingAttachmentLabel(fact.missing)}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                <span className="font-mono">{num}</span> · {MISSING_ATTACHMENT_ADVICE} · {fact.author} {dayLabel(fact.createdAt)}
              </span>
            </span>
            <SourceJump href={fact.href} place={fact.place} />
          </li>
        ) : null,
        // 글의 첨부가 아니라 이름이 같은 다른 곳의 첨부 — 그렇다고 적고, 바로가기는 그 파일이 올라온 글로
        ...mentioned.map((f) => (
          <FileCard
            key={f.id}
            file={f}
            mentioned
            meta={<>{sizeLabel(f.size)} · 이름이 같은 파일</>}
            num={num}
            jump={f.href ? { href: f.href, place: "이 파일을 올린 글" } : null}
          />
        )),
      ])}
    </ul>
  )
}

/** 파일 한 장 — 열기 · 내려받기 · 원문으로. 권한은 /api/files/:id/raw 가 한 번 더 본다 */
function FileCard({
  file: f,
  meta,
  num,
  jump,
  mentioned = false,
}: {
  file: SourceFile
  meta: ReactNode
  num: number
  jump: { href: string; place: string } | null
  mentioned?: boolean
}) {
  return (
    <li data-source-file={f.id} data-source-mentioned={mentioned || undefined} className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <HugeiconsIcon icon={File02Icon} size={18} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        {/* 이름은 두 줄까지 — 폰에서 단추 셋 옆에 한 줄로 두면 날짜 · 판 번호(…_WC_04)가 잘려 어느 파일인지 모른다 */}
        <span className="line-clamp-2 text-[13px] font-medium break-all" title={f.name}>
          {f.name}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          <span className="font-mono">{num}</span> · {meta}
        </span>
      </span>
      <a
        href={apiUrl(`/api/files/${f.id}/raw`)}
        target="_blank"
        rel="noopener"
        aria-label={`${f.name} 열기`}
        title="열기"
        className="touch-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden />
      </a>
      <a
        href={apiUrl(`/api/files/${f.id}/raw`)}
        download={f.name}
        aria-label={`${f.name} 내려받기`}
        title="내려받기"
        className="touch-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <HugeiconsIcon icon={Download04Icon} size={16} aria-hidden />
      </a>
      {jump && <SourceJump href={jump.href} place={jump.place} />}
    </li>
  )
}

/** 원문 글로 — 방 · 업무방, 도착하면 그 글을 가운데 두고 강조 */
function SourceJump({ href, place }: { href: string; place: string }) {
  return (
    <Link
      href={href}
      aria-label={`원문 글로 — ${place}`}
      title={`원문 글로 — ${place}`}
      className={cn(
        "touch-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} aria-hidden />
    </Link>
  )
}
