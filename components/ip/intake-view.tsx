"use client"

import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  MailOpen01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHeader } from "@/components/ip/page-header"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { useToday } from "@/hooks/ip/use-today"
import {
  extract,
  toCommunication,
  type Extraction,
  type Proposal,
} from "@/lib/ip/mail-extract"
import {
  nextId,
  saveAction,
  saveCommunication,
  savePatent,
  saveTrademark,
} from "@/lib/ip/db"
import { extractThreadId } from "@/lib/ip/mail-parse"
import type { ActionItem, Communication, Patent, Trademark } from "@/lib/ip/types"
import { cn } from "@/lib/utils"

export function IntakeView() {
  const today = useToday()
  const { trademarks, patents, actions, refresh } = useData()
  const { canWrite } = useAuth()

  const [raw, setRaw] = useState("")
  const [threadInput, setThreadInput] = useState("")
  const [result, setResult] = useState<Extraction | null>(null)
  const [draft, setDraft] = useState<Communication | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function analyze() {
    setError(null)
    setDone(null)
    const e = extract(raw, trademarks, patents)
    setResult(e)
    setDraft(toCommunication(e, today))
    // 번호·등록가능성처럼 본문에 명시된 값만 기본 선택한다.
    // 상태 전이는 추론이라 오판 여지가 있어 사용자가 직접 켜도록 둔다.
    setChecked(
      Object.fromEntries(
        e.proposals.map((p) => [
          p.key,
          p.type === "field" && p.field !== "status",
        ])
      )
    )
  }

  function reset() {
    setRaw("")
    setThreadInput("")
    setResult(null)
    setDraft(null)
    setChecked({})
    setError(null)
  }

  const selected = useMemo(
    () => (result?.proposals ?? []).filter((p) => checked[p.key]),
    [result, checked]
  )

  async function apply() {
    if (!result || !draft) return
    setSaving(true)
    setError(null)
    try {
      // 1) 커뮤니케이션 기록
      const threadId = extractThreadId(threadInput) ?? null
      await saveCommunication({ ...draft, threadId }, true)

      // 2) 상표/특허 필드 갱신 — 건별로 모아서 한 번에 저장한다.
      const tmPatch = new Map<string, Partial<Trademark>>()
      const ptPatch = new Map<string, Partial<Patent>>()
      const noteAppend = new Map<string, string[]>()

      for (const p of selected) {
        if (p.type === "field") {
          // 상표/특허는 status 타입이 달라 한 변수로 묶으면 좁혀지지 않는다.
          if (p.entity.kind === "trademark") {
            tmPatch.set(p.entity.id, {
              ...(tmPatch.get(p.entity.id) ?? {}),
              [p.field]: p.value,
            } as Partial<Trademark>)
          } else {
            ptPatch.set(p.entity.id, {
              ...(ptPatch.get(p.entity.id) ?? {}),
              [p.field]: p.value,
            } as Partial<Patent>)
          }
        } else if (p.type === "note") {
          const key = `${p.entity.kind}:${p.entity.id}`
          noteAppend.set(key, [...(noteAppend.get(key) ?? []), p.text])
        }
      }

      for (const [id, patch] of tmPatch) {
        const base = trademarks.find((t) => t.id === id)
        if (!base) continue
        const extra = noteAppend.get(`trademark:${id}`)
        noteAppend.delete(`trademark:${id}`)
        await saveTrademark(
          {
            ...base,
            ...patch,
            note: extra
              ? [base.note, ...extra].filter(Boolean).join("\n")
              : base.note,
          },
          false
        )
      }

      for (const [id, patch] of ptPatch) {
        const base = patents.find((p) => p.id === id)
        if (!base) continue
        const extra = noteAppend.get(`patent:${id}`)
        noteAppend.delete(`patent:${id}`)
        await savePatent(
          {
            ...base,
            ...patch,
            note: extra
              ? [base.note, ...extra].filter(Boolean).join("\n")
              : base.note,
          },
          false
        )
      }

      // 필드 변경 없이 비고만 덧붙이는 건도 처리한다.
      for (const [key, texts] of noteAppend) {
        const [kind, id] = key.split(":")
        if (kind === "trademark") {
          const base = trademarks.find((t) => t.id === id)
          if (base)
            await saveTrademark(
              {
                ...base,
                note: [base.note, ...texts].filter(Boolean).join("\n"),
              },
              false
            )
        } else {
          const base = patents.find((p) => p.id === id)
          if (base)
            await savePatent(
              {
                ...base,
                note: [base.note, ...texts].filter(Boolean).join("\n"),
              },
              false
            )
        }
      }

      // 3) 미결 액션
      const actionProposals = selected.filter((p) => p.type === "action")
      let ids = actions.map((a) => a.id)
      for (const p of actionProposals) {
        if (p.type !== "action") continue
        const id = nextId("A", ids)
        ids = [...ids, id]
        const item: ActionItem = {
          id,
          target: p.entity?.kind === "patent" ? "특허" : "상표",
          subject: p.entity
            ? `${p.entity.id} ${p.entity.label}`
            : draft.subject || "메일 후속",
          requestedAt: draft.date,
          requester: draft.from || null,
          todo: p.todo,
          owner: "정우창",
          priority: p.priority,
          note: "",
          state: "open",
          resolution: null,
          resolvedAt: null,
        }
        await saveAction(item, true)
      }

      await refresh()
      setDone(
        `커뮤니케이션 1건${selected.length > 0 ? ` · 변경 ${selected.length}건` : ""} 반영했습니다.`
      )
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="메일로 입력"
        description="해안과 주고받은 메일을 그대로 붙여넣으면 커뮤니케이션 기록과 상표·특허 변경사항을 한 번에 만들어 줍니다. 적용 전에 항상 검토할 수 있습니다."
      />

      {done ? (
        <Card className="ring-emerald-500/30">
          <CardContent className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <HugeiconsIcon
              icon={Tick02Icon}
              strokeWidth={2}
              className="size-4"
            />
            {done}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <HugeiconsIcon
              icon={MailOpen01Icon}
              strokeWidth={2}
              className="size-4"
            />
            메일 붙여넣기
          </CardTitle>
          <CardDescription>
            Gmail·네이버웍스 어느 쪽이든 됩니다. 본문을 통째로 붙여넣으세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            value={raw}
            rows={10}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={
              "보낸사람: 이주철 <jcpatent@daum.net>\n날짜: 2026년 5월 26일\n제목: [해안] ADHEAL 상표출원 등록가능성 검토의견\n\n제05류에 ADHEAL 출원 시 등록가능성 60% …"
            }
            className="font-mono text-[13px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={analyze} disabled={!raw.trim()}>
              분석하기
            </Button>
            {result ? (
              <Button size="sm" variant="ghost" onClick={reset}>
                초기화
              </Button>
            ) : null}
            <Input
              value={threadInput}
              onChange={(e) => setThreadInput(e.target.value)}
              placeholder="Gmail 스레드 링크·ID (선택)"
              className="ml-auto h-7 w-64 text-[13px]"
            />
          </div>
        </CardContent>
      </Card>

      {result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>1. 커뮤니케이션 기록</CardTitle>
              <CardDescription>필요하면 바로 고칠 수 있습니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Editable
                label="일자"
                value={draft?.date ?? ""}
                onChange={(v) => setDraft((d) => (d ? { ...d, date: v } : d))}
                type="date"
              />
              <Editable
                label="구분"
                value={draft?.dir ?? ""}
                onChange={(v) =>
                  setDraft((d) =>
                    d ? { ...d, dir: v as Communication["dir"] } : d
                  )
                }
              />
              <Editable
                label="발신"
                value={draft?.from ?? ""}
                onChange={(v) => setDraft((d) => (d ? { ...d, from: v } : d))}
              />
              <Editable
                label="수신"
                value={draft?.to ?? ""}
                onChange={(v) => setDraft((d) => (d ? { ...d, to: v } : d))}
              />
              <div className="col-span-2 sm:col-span-4">
                <Editable
                  label="제목"
                  value={draft?.subject ?? ""}
                  onChange={(v) =>
                    setDraft((d) => (d ? { ...d, subject: v } : d))
                  }
                />
              </div>
              {draft && draft.attachments.length > 0 ? (
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-4">
                  <span className="text-[12px] text-muted-foreground">
                    첨부
                  </span>
                  {draft.attachments.map((a) => (
                    <Badge key={a} variant="secondary">
                      {a}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card
            className={
              result.entities.length === 0 ? "ring-amber-500/30" : undefined
            }
          >
            <CardHeader>
              <CardTitle>2. 관련된 건 {result.entities.length}개</CardTitle>
              <CardDescription>
                {result.entities.length === 0
                  ? "메일에서 상표·특허를 찾지 못했습니다. 커뮤니케이션 기록만 저장됩니다."
                  : "메일 내용에서 아래 건을 찾았습니다."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {result.entities.map((e) => (
                <Badge
                  key={`${e.kind}-${e.id}`}
                  variant="outline"
                  className="max-w-[320px] truncate"
                >
                  {e.kind === "trademark" ? "상표" : "특허"} {e.id} · {e.label}
                  <span className="ml-1 text-muted-foreground">
                    ({e.reason})
                  </span>
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card
            className={
              result.proposals.length > 0 ? "ring-primary/25" : undefined
            }
          >
            <CardHeader>
              <CardTitle>
                3. 반영할 변경사항 {selected.length}/{result.proposals.length}
              </CardTitle>
              <CardDescription>
                체크한 항목만 적용됩니다. 모든 변경은 수정 이력에 남습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border/60">
              {result.proposals.length === 0 ? (
                <p className="py-3 text-muted-foreground">
                  제안할 변경사항이 없습니다.
                </p>
              ) : (
                result.proposals.map((p) => (
                  <ProposalRow
                    key={p.key}
                    proposal={p}
                    checked={checked[p.key] ?? false}
                    onToggle={(v) => setChecked((c) => ({ ...c, [p.key]: v }))}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {error ? (
            <Card className="ring-red-500/25">
              <CardContent className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                {error}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex items-center gap-2">
            <Button onClick={() => void apply()} disabled={!canWrite || saving}>
              {saving
                ? "반영 중…"
                : `저장 (커뮤니케이션 1건 + 변경 ${selected.length}건)`}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={saving}>
              취소
            </Button>
            {!canWrite ? (
              <span className="text-[12px] text-muted-foreground">
                읽기 전용 권한입니다.
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function ProposalRow({
  proposal,
  checked,
  onToggle,
}: {
  proposal: Proposal
  checked: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2.5 first:pt-0">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onToggle(Boolean(c))}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          {proposal.entity ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {proposal.entity.id}
            </span>
          ) : null}
          <span className="font-medium">{proposal.label}</span>
        </div>

        {proposal.type === "field" ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="line-through">{proposal.before}</span>
            <span>→</span>
            <span className={cn("font-medium text-foreground")}>
              {proposal.after}
            </span>
          </div>
        ) : proposal.type === "note" ? (
          <p className="mt-0.5 text-muted-foreground">{proposal.text}</p>
        ) : (
          <p className="mt-0.5 text-muted-foreground">{proposal.todo}</p>
        )}
      </div>
    </label>
  )
}

function Editable({
  label,
  value,
  onChange,
  type,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium text-muted-foreground">
        {label}
      </div>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-[13px]"
      />
    </div>
  )
}
