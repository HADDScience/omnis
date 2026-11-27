"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Cancel01Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { send } from "@/components/grants/send"
import { InlineField, useFieldSaver, type EditorProps } from "@/components/grants/inline-field"
import { CERT_STAGE_CHIP, type CertView, type Member } from "@/components/certs/cert-view"
import { daysLeft, deadlineText, validText } from "@/components/certs/cert-dates"
import { checklistProgress, evidenceHref, type ChecklistItem, type EvidenceRef } from "@/lib/certs"
import { CERT_STAGES, CERT_STAGE_LABEL, seoulMinute, seoulYmd, type CertStage } from "@/lib/grants-labels"
import { apiUrl } from "@/lib/base-path"
import { sameText } from "@/lib/inline-field"
import { cn } from "@/lib/utils"

/**
 * 인증 목록 — 줄마다 단계 · 마감 · 담당 · 준비물 진행, 누르면 칸을 그 자리에서 고친다(칸 하나씩 PATCH · expect 로 충돌 확인).
 * 펼침 아래에 준비물 · 근거 · 조사 원문 · 「이 인증을 따면 어느 공고에서 몇 점」.
 */
export function CertList({ rows, members, focus }: { rows: CertView[]; members: Member[]; focus: string | null }) {
  const [open, setOpen] = useState<string | null>(focus)
  useEffect(() => {
    if (!focus) return
    setOpen(focus)
    document.getElementById(`cert-${focus}`)?.scrollIntoView({ block: "start" })
  }, [focus])
  return (
    <>
      <AddCandidate onAdded={(id) => setOpen(id)} />
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 p-4 text-[13px] text-muted-foreground">인증이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card" data-certs-list>
          {rows.map((r) => (
            <CertRow
              key={r.id}
              r={r}
              members={members}
              open={open === r.id}
              onToggle={() => setOpen(open === r.id ? null : r.id)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

/** 후보 올리기 — 인증명 한 줄. 같은 이름이 있으면 그 인증을 연다 */
function AddCandidate({ onAdded }: { onAdded: (id: string) => void }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      const r = await send<{ id: string; name: string; existed: boolean }>("/api/company/certifications", "POST", { name: n })
      toast.success(r.existed ? `이미 있는 인증입니다 · ${r.name}` : `후보로 올렸습니다 · ${r.name}`)
      setName("")
      onAdded(r.id)
      router.push(`/omnis/certs?cert=${r.id}`, { scroll: false })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "올리지 못했습니다")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="mb-3 flex gap-2" aria-label="인증 후보 올리기">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="인증명"
        aria-label="새 인증명"
        maxLength={200}
        className="h-9 min-w-0 flex-1 text-[16px] sm:max-w-80 sm:text-[13px]"
      />
      <Button type="submit" size="sm" disabled={!name.trim() || busy} className="touch-target h-9 shrink-0">
        {busy && <Spinner className="size-3.5" />}
        후보 올리기
      </Button>
    </form>
  )
}

function StageChip({ stage }: { stage: CertStage }) {
  return (
    <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium", CERT_STAGE_CHIP[stage])}>
      {CERT_STAGE_LABEL[stage]}
    </span>
  )
}

const OWNED = new Set<CertStage>(["HELD", "RENEWAL_DUE", "EXPIRED"])

function CertRow({
  r,
  members,
  open,
  onToggle,
}: {
  r: CertView
  members: Member[]
  open: boolean
  onToggle: () => void
}) {
  const owned = OWNED.has(r.stage)
  const due = owned ? validText(r.validUntil) : deadlineText(r.deadline)
  const check = checklistProgress(r.checklist)
  const left = daysLeft(r.deadline)
  const soon = !owned && left !== null && left >= 0 && left <= 14
  return (
    <li id={`cert-${r.id}`} data-certs-row={r.id} className="scroll-mt-24">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${r.name} ${open ? "접기" : "펼치기"}`}
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <StageChip stage={r.stage} />
            <span className="truncate text-[13.5px] font-semibold">{r.name}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted-foreground">
            {due && <span className={cn(soon && "font-medium text-foreground")}>{due}</span>}
            {r.issuer && <span className="max-w-56 truncate">{r.issuer}</span>}
            <span>{r.owner?.name ?? "담당 없음"}</span>
            {check.total > 0 && (
              <span className="tabular-nums">
                준비물 {check.done}/{check.total}
              </span>
            )}
            {r.bonusRows.length > 0 && <span>가점 공고 {r.bonusRows.length}</span>}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground", open && "rotate-180")}
        />
      </button>
      {open && <CertDetail r={r} members={members} />}
    </li>
  )
}

const text = (v: string) => v.trim() || null

function TextEditor({ draft, setDraft, bind, multiline }: EditorProps<string> & { multiline?: boolean }) {
  return multiline ? (
    <Textarea
      {...bind({ multiline: true })}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      rows={3}
      className="min-h-16 w-full text-[16px] sm:text-[12px]"
    />
  ) : (
    <Input
      {...bind()}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="h-8 w-full text-[16px] sm:text-[12px]"
    />
  )
}

/** datetime-local 값(「2026-12-18T16:00」) ↔ 서울 「2026-12-18 16:00」 */
const toLocal = (iso: string | null) => (iso ? seoulMinute(iso)!.replace(" ", "T") : "")

function CertDetail({ r, members }: { r: CertView; members: Member[] }) {
  const saver = useFieldSaver(`/api/company/certifications/${r.id}`)
  const people = r.owner && !members.some((m) => m.id === r.owner!.id) ? [r.owner, ...members] : members
  const name = new Map(people.map((p) => [p.id, p.name]))
  return (
    <div className="px-3 pb-3" data-certs-detail={r.id}>
      <div className="rounded-xl bg-muted/50 p-3 text-[12px]">
        <dl aria-label={`${r.name} 칸`} className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[84px_1fr]">
          <InlineField<CertStage>
            label="단계"
            value={r.stage}
            display={(v) => <StageChip stage={v} />}
            save={saver("status")}
            editor={({ draft, commit, bind }) => (
              <NativeSelect
                {...bind()}
                size="sm"
                className="w-full sm:w-48"
                value={draft}
                onChange={(e) => commit(e.target.value as CertStage)}
              >
                {CERT_STAGES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {CERT_STAGE_LABEL[s]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <InlineField<string>
            label="사유"
            value={r.stageReason ?? ""}
            equals={sameText}
            display={text}
            save={saver("stageReason")}
            editor={(p) => <TextEditor {...p} />}
          />
          <InlineField<string>
            label="인증명"
            value={r.name}
            equals={sameText}
            display={text}
            save={saver("name")}
            editor={(p) => <TextEditor {...p} />}
          />
          <InlineField<string>
            label="발급 기관"
            value={r.issuer ?? ""}
            equals={sameText}
            display={text}
            save={saver("issuer")}
            editor={(p) => <TextEditor {...p} />}
          />
          <InlineField<string>
            label="접수 마감"
            value={toLocal(r.deadline)}
            display={(v) => {
              if (!v) return null
              const d = deadlineText(new Date(`${v}:00+09:00`).toISOString())!.split(" · ")[0]
              return `${v.replace("T", " ")} · ${d}`
            }}
            save={saver("deadline", (v: string) => v.replace("T", " "))}
            editor={({ draft, setDraft, bind }) => (
              <Input
                {...bind()}
                type="datetime-local"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-8 w-full text-[16px] sm:w-56 sm:text-[12px]"
              />
            )}
          />
          <InlineField<string>
            label="담당"
            value={r.owner?.id ?? ""}
            display={(id) => (id ? (name.get(id) ?? "?") : null)}
            save={saver("ownerId")}
            editor={({ draft, commit, bind }) => (
              <NativeSelect
                {...bind()}
                size="sm"
                className="w-full sm:w-48"
                value={draft}
                onChange={(e) => commit(e.target.value)}
              >
                <NativeSelectOption value="">담당 없음</NativeSelectOption>
                {people.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          {(["acquiredOn", "validUntil"] as const).map((key) => (
            <InlineField<string>
              key={key}
              label={key === "acquiredOn" ? "취득일" : "유효기간"}
              value={seoulYmd(r[key]) ?? ""}
              display={(v) => (v ? (key === "validUntil" ? validText(`${v}T00:00:00+09:00`) : v) : null)}
              save={saver(key)}
              editor={({ draft, setDraft, bind }) => (
                <Input
                  {...bind()}
                  type="date"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-8 w-full text-[16px] sm:w-48 sm:text-[12px]"
                />
              )}
            />
          ))}
          <InlineField<string>
            label="메모"
            value={r.note ?? ""}
            equals={sameText}
            display={text}
            save={saver("note")}
            editor={(p) => <TextEditor {...p} multiline />}
          />
        </dl>
        <Checklist cert={r} />
        <Evidence cert={r} />
        <Research r={r} />
        <BonusFor r={r} />
      </div>
    </div>
  )
}

// ─── 준비물 ───

/** 준비물 — 줄을 누르면 끝냄 · 되돌림, 더하기 · 지우기. 목록 통째로 PATCH(고치기 전 목록을 expect 로) */
function Checklist({ cert }: { cert: CertView }) {
  const router = useRouter()
  const [items, setItems] = useState<ChecklistItem[]>(cert.checklist)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const base = useRef(cert.checklist)
  // 서버 값이 실제로 바뀔 때만 따라간다 — 새로 읽기마다 배열이 새로 와도, 늦게 온 옛 값으로 덮지 않게
  const serverKey = JSON.stringify(cert.checklist)
  useEffect(() => {
    setItems(JSON.parse(serverKey) as ChecklistItem[])
    base.current = JSON.parse(serverKey) as ChecklistItem[]
  }, [serverKey])

  async function save(next: ChecklistItem[]) {
    const prev = base.current
    setItems(next)
    setBusy(true)
    try {
      await send(`/api/company/certifications/${cert.id}`, "PATCH", { checklist: next, expect: { checklist: prev } })
      base.current = next
      router.refresh()
    } catch (e) {
      setItems(prev)
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다")
      if ((e as { status?: number }).status === 409) router.refresh()
    } finally {
      setBusy(false)
    }
  }
  const p = checklistProgress(items)
  return (
    <section aria-label="준비물" className="mt-3 border-t pt-2.5" data-certs-checklist>
      <h3 className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-semibold">
        준비물 <span className="font-normal text-muted-foreground tabular-nums">{p.done}/{p.total}</span>
        {busy && <Spinner className="size-3" />}
      </h3>
      {items.length > 0 && (
        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-1.5">
              <label className="touch-target flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-foreground/[0.04]">
                <input
                  type="checkbox"
                  checked={it.done}
                  disabled={busy}
                  onChange={() => save(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                  className="mt-0.5 size-4 shrink-0 accent-foreground"
                />
                <span className={cn("min-w-0 break-words", it.done && "text-muted-foreground line-through")}>{it.text}</span>
              </label>
              <button
                type="button"
                aria-label={`${it.text} 지우기`}
                disabled={busy}
                onClick={() => save(items.filter((x) => x.id !== it.id))}
                className="touch-target flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const t = draft.trim()
          if (!t || busy) return
          setDraft("")
          void save([...items, { id: `n${Date.now().toString(36)}`, text: t, done: false }])
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="준비물"
          aria-label="준비물 더하기"
          maxLength={200}
          className="h-8 min-w-0 flex-1 text-[16px] sm:text-[12px]"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim() || busy} className="touch-target h-8 shrink-0">
          더하기
        </Button>
      </form>
    </section>
  )
}

// ─── 근거 ───

const KIND_LABEL: Record<EvidenceRef["kind"], string> = { message: "채팅 글", file: "파일", url: "링크" }

/** 근거 — 채팅 글(그 방으로) · 파일 · 링크. 링크를 더하고 지운다. 글 본문은 보이지 않는다(방 권한을 따른다) */
function Evidence({ cert }: { cert: CertView }) {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  // 화면이 목록을 쥔다 — 앞서 보낸 다른 칸의 새로 읽기가 늦게 와 옛 목록으로 덮지 않게(준비물과 같다)
  const [items, setItems] = useState<EvidenceRef[]>(cert.evidence)
  const base = useRef(cert.evidence)
  const serverKey = JSON.stringify(cert.evidence)
  useEffect(() => {
    setItems(JSON.parse(serverKey) as EvidenceRef[])
    base.current = JSON.parse(serverKey) as EvidenceRef[]
  }, [serverKey])
  async function save(next: EvidenceRef[]) {
    setBusy(true)
    try {
      await send(`/api/company/certifications/${cert.id}`, "PATCH", { evidence: next, expect: { evidence: base.current } })
      base.current = next
      setItems(next)
      router.refresh()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다")
      if ((e as { status?: number }).status === 409) router.refresh()
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="근거" className="mt-3 border-t pt-2.5" data-certs-evidence>
      <h3 className="mb-1.5 text-[12.5px] font-semibold">근거</h3>
      {items.length > 0 && (
        <ul className="space-y-0.5">
          {items.map((e) => {
            const { href, external } = evidenceHref(e)
            return (
              <li key={`${e.kind}:${e.ref}`} className="flex items-center gap-1.5">
                <a
                  href={external ? href : apiUrl(href)}
                  {...(external || e.kind === "file" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="touch-target inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 hover:bg-foreground/[0.04]"
                >
                  <span className="shrink-0 rounded bg-background px-1 text-[11px] text-muted-foreground">{KIND_LABEL[e.kind]}</span>
                  <span className="min-w-0 truncate underline-offset-2 hover:underline">{e.label}</span>
                  {e.at && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{seoulYmd(e.at)}</span>}
                  {external && <HugeiconsIcon icon={LinkSquare02Icon} size={11} className="shrink-0 opacity-50" aria-hidden />}
                </a>
                <button
                  type="button"
                  aria-label={`${e.label} 근거 지우기`}
                  disabled={busy}
                  onClick={() => save(items.filter((x) => !(x.kind === e.kind && x.ref === e.ref)))}
                  className="touch-target flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const u = url.trim()
          if (!u || busy) return
          if (await save([...items, { kind: "url", ref: u, label: u.replace(/^https?:\/\//, "").slice(0, 120), at: new Date().toISOString() }])) setUrl("")
        }}
      >
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          aria-label="근거 링크 더하기"
          className="h-8 min-w-0 flex-1 text-[16px] sm:text-[12px]"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!url.trim() || busy} className="touch-target h-8 shrink-0">
          더하기
        </Button>
      </form>
    </section>
  )
}

// ─── 조사 원문 ───

function Research({ r }: { r: CertView }) {
  const rows: [string, React.ReactNode][] = [
    ["우리 충족", r.research.ourStatus],
    ["판정 이유", r.research.reason],
    ["자격조건", r.research.requirements.length ? r.research.requirements.map((x) => `· ${x}`).join("\n") : null],
    ["신청기간", r.research.window],
    ["걸리는 기간", r.research.timeToIssue],
    ["비용", r.research.cost],
    ["유효기간 원문", r.research.validity],
    ["가점 원문", r.bonusRaw],
    [
      "TIPS 가점",
      r.tips && (r.tips.general.applies || r.tips.deeptech.applies || r.tips.deeptech.points)
        ? [
            r.tips.general.applies && `일반 ${r.tips.general.points ?? "가점"}`,
            r.tips.deeptech.points && `딥테크 ${r.tips.deeptech.points}`,
            r.tips.sole && `지금 ${r.tips.sole}`,
            r.tips.corp && r.tips.corp !== r.tips.sole && `법인 뒤 ${r.tips.corp}`,
          ]
            .filter(Boolean)
            .join(" · ")
        : null,
    ],
    ["취득 연혁", r.record ? `${r.record.title}${r.record.startsOn ? ` ${seoulYmd(r.record.startsOn)}` : ""}` : null],
    ["인증 번호", r.certNo],
    [
      "조사 근거",
      r.research.sources.length ? (
        <span className="flex flex-col gap-0.5">
          {r.research.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="break-all underline-offset-2 hover:underline">
              {s.title || s.url}
            </a>
          ))}
        </span>
      ) : null,
    ],
  ]
  const shown = rows.filter(([, v]) => v)
  if (!shown.length) return null
  return (
    <section aria-label="조사" className="mt-3 border-t pt-2.5">
      <h3 className="mb-1 text-[12.5px] font-semibold">조사</h3>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[84px_1fr]">
        {shown.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="pt-1 text-muted-foreground">{k}</dt>
            <dd className="py-1 break-words whitespace-pre-line">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ─── 이 인증을 따면 ───

/** 공고 가점을 거꾸로 — 이 인증으로 가점을 받는 접수 중 공고와 점수(근거는 공고 원문) */
function BonusFor({ r }: { r: CertView }) {
  return (
    <section aria-label="이 인증으로 받는 공고 가점" className="mt-3 border-t pt-2.5" data-certs-bonus-for>
      <h3 className="mb-1.5 text-[12.5px] font-semibold">
        {OWNED.has(r.stage) ? "이 인증으로 받는 공고 가점" : "이 인증을 따면 받는 공고 가점"}
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{r.bonusRows.length}</span>
      </h3>
      {r.bonusRows.length === 0 ? (
        <p className="text-muted-foreground">접수 중인 공고 가운데 이 인증에 가점을 주는 곳이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {r.bonusRows.map((b) => (
            <li key={b.noticeId} data-certs-bonus-notice={b.noticeId}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/omnis/grants?tab=notices&deadline=all&verdict=${encodeURIComponent("해당,애매,비해당")}&q=${encodeURIComponent(b.title.slice(0, 40))}`}
                  className="min-w-0 font-medium break-keep underline-offset-2 hover:underline"
                >
                  {b.title}
                </Link>
                <span className="shrink-0 font-semibold tabular-nums">{b.items.map((i) => i.pointsLabel).join(" + ")}</span>
                {b.deadline && <span className="shrink-0 text-muted-foreground tabular-nums">{deadlineText(b.deadline)}</span>}
              </div>
              {b.items.map((i, k) => (
                <q
                  key={k}
                  className="mt-0.5 block border-l-2 border-border pl-2 text-[11.5px] text-muted-foreground before:content-none after:content-none"
                >
                  {i.label} — {i.quote}
                </q>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
