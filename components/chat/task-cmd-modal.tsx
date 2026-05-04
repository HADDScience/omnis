"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiMagicIcon,
  Task01Icon,
  Cancel01Icon,
  UserGroupIcon,
  UserIcon,
  Calendar03Icon,
  Folder01Icon,
  CubeIcon,
  StarIcon,
  PlusSignIcon,
  BookOpen01Icon,
} from "@hugeicons/core-free-icons"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { PillField } from "@/components/ui/pill-field"
import { toast } from "sonner"
import { parseSlashTask } from "./slash-command-parser"

interface TaskCmdModalProps {
  open: boolean
  rawCommand: string
  onClose: () => void
}

interface AiFilledFields {
  title?: string
  ownerName?: string
  deadline?: string | null
  projectName?: string
  background?: string
  expectedResult?: string
  checklist?: string[]
  suggestedCards?: { id: string; title: string }[]
}

type Priority = "LOW" | "NORMAL" | "HIGH"

const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
}

export function TaskCmdModal({ open, rawCommand, onClose }: TaskCmdModalProps) {
  const router = useRouter()
  const parsed = useMemo(() => parseSlashTask(rawCommand), [rawCommand])

  const [title, setTitle] = useState("")
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [participants, setParticipants] = useState<string[]>([])
  const [deadlineLabel, setDeadlineLabel] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [productName, setProductName] = useState<string | null>(null)
  const [priority, setPriority] = useState<Priority | null>(null)
  const [extra, setExtra] = useState("")
  const [instruction, setInstruction] = useState("")
  const [checklist, setChecklist] = useState<string[]>([])
  const [suggestedCards, setSuggestedCards] = useState<{ id: string; title: string }[]>([])
  const [postToChat, setPostToChat] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(parsed?.title ?? "")
    setOwnerName(parsed?.ownerName ?? null)
    setParticipants([])
    setDeadlineLabel(parsed?.deadlineLabel ?? null)
    setProjectName(parsed?.projectName ?? null)
    setProductName(null)
    setPriority(null)
    setExtra("")
    setInstruction("")
    setChecklist([])
    setSuggestedCards([])
    setPostToChat(true)
  }, [open, parsed])

  async function runAi() {
    setAiLoading(true)
    try {
      const res = await fetch("/api/ai/structure-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rawMessage: rawCommand,
          extraInstruction: extra,
          currentFields: { title, ownerName, deadlineLabel, projectName },
        }),
      })
      if (!res.ok) throw new Error("AI 호출 실패")
      const data = (await res.json()) as AiFilledFields
      if (data.title && !title) setTitle(data.title)
      if (data.ownerName && !ownerName) setOwnerName(data.ownerName)
      if (data.deadline && !deadlineLabel) setDeadlineLabel(data.deadline)
      if (data.projectName && !projectName) setProjectName(data.projectName)
      if (data.background || data.expectedResult) {
        const next = [
          data.background ? `배경: ${data.background}` : "",
          data.expectedResult ? `기대 결과: ${data.expectedResult}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
        if (next && !instruction) setInstruction(next)
      }
      if (Array.isArray(data.checklist)) setChecklist(data.checklist)
      if (Array.isArray(data.suggestedCards)) setSuggestedCards(data.suggestedCards)
      toast.success("AI 자동완성 완료")
    } catch {
      toast.error("AI 자동완성 실패")
    } finally {
      setAiLoading(false)
    }
  }

  const canSubmit = Boolean(title && ownerName && !submitting)

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: title,
          ownerName,
          deadlineLabel,
          projectName,
          productName,
          priority,
          participants,
          instruction,
          checklist: checklist.filter((c) => c.trim() !== ""),
          suggestedCardIds: suggestedCards.map((s) => s.id),
          rawCommand,
          postToChat,
        }),
      })
      if (!res.ok) throw new Error("업무 생성 실패")
      toast.success("업무 생성 완료")
      onClose()
      router.refresh()
    } catch {
      toast.error("업무 생성 실패")
    } finally {
      setSubmitting(false)
    }
  }

  const missing = [!title && "제목", !ownerName && "담당자"].filter(Boolean)

  function addChecklistItem() {
    setChecklist((prev) => [...prev, ""])
  }
  function updateChecklistItem(i: number, value: string) {
    setChecklist((prev) => prev.map((v, idx) => (idx === i ? value : v)))
  }
  function removeChecklistItem(i: number) {
    setChecklist((prev) => prev.filter((_, idx) => idx !== i))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[640px] sm:!max-w-[640px] p-0">
        <DialogHeader className="flex-row items-center gap-2 border-b px-5 py-3.5 space-y-0">
          <HugeiconsIcon icon={Task01Icon} size={14} className="text-primary" />
          <DialogTitle className="text-[14px] font-semibold">업무 생성 확인</DialogTitle>
          <DialogDescription className="ml-auto mr-6 font-mono text-[10.5px] text-muted-foreground">
            확인 후 채팅에 게시
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(75vh,640px)] overflow-y-auto">
          <div className="px-5 pt-4">
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-[12px] text-muted-foreground">
              {rawCommand}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              속성
            </div>
            <div className="flex flex-wrap gap-1.5">
              <PillField
                variant={ownerName ? "filled" : "ghost"}
                icon={<HugeiconsIcon icon={UserIcon} size={11} />}
                label="담당"
                value={ownerName ?? undefined}
                onClick={() => {
                  const next = prompt("담당자 이름을 입력하세요", ownerName ?? "")
                  if (next !== null) setOwnerName(next.trim() || null)
                }}
              />
              <PillField
                variant={participants.length > 0 ? "filled" : "ghost"}
                icon={<HugeiconsIcon icon={UserGroupIcon} size={11} />}
                label="참여"
                value={participants.length > 0 ? participants.join(", ") : undefined}
                onClick={() => {
                  const next = prompt(
                    "참여자 이름을 콤마로 구분해 입력하세요",
                    participants.join(", "),
                  )
                  if (next !== null)
                    setParticipants(
                      next
                        .split(",")
                        .map((p) => p.trim())
                        .filter(Boolean),
                    )
                }}
              />
              <PillField
                variant={
                  !deadlineLabel
                    ? "ghost"
                    : deadlineLabel === "D-0" || deadlineLabel === "오늘"
                      ? "danger"
                      : "filled"
                }
                icon={<HugeiconsIcon icon={Calendar03Icon} size={11} />}
                label="마감"
                value={deadlineLabel ?? undefined}
                onClick={() => {
                  const next = prompt(
                    "마감을 입력하세요 (예: D-3, 오늘, 내일, 2026-05-01)",
                    deadlineLabel ?? "",
                  )
                  if (next !== null) setDeadlineLabel(next.trim() || null)
                }}
              />
              <PillField
                variant={projectName ? "filled" : "ghost"}
                icon={<HugeiconsIcon icon={Folder01Icon} size={11} />}
                label="프로젝트"
                value={projectName ?? undefined}
                onClick={() => {
                  const next = prompt("프로젝트 이름을 입력하세요", projectName ?? "")
                  if (next !== null) setProjectName(next.trim() || null)
                }}
              />
              <PillField
                variant={productName ? "filled" : "ghost"}
                icon={<HugeiconsIcon icon={CubeIcon} size={11} />}
                label="제품"
                value={productName ?? undefined}
                onClick={() => {
                  const next = prompt("제품 이름을 입력하세요", productName ?? "")
                  if (next !== null) setProductName(next.trim() || null)
                }}
              />
              <PillField
                variant={priority === "HIGH" ? "danger" : priority ? "filled" : "ghost"}
                icon={<HugeiconsIcon icon={StarIcon} size={11} />}
                label="우선순위"
                value={priority ? PRIORITY_LABEL[priority] : undefined}
                onClick={() => {
                  const order: Priority[] = ["LOW", "NORMAL", "HIGH"]
                  const idx = priority ? order.indexOf(priority) : -1
                  const next = order[(idx + 1) % order.length]
                  setPriority(next)
                }}
              />
            </div>
          </div>

          <div className="px-5 pb-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[13px] font-semibold">제목</span>
              <span className="text-[11px] text-muted-foreground">업무의 한 줄 요약</span>
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목 미입력"
              className={[
                "h-8 text-[13px]",
                !title ? "border-[var(--color-warn)]" : "",
              ].join(" ")}
            />
          </div>

          <div className="px-5 pb-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[13px] font-semibold">지시사항</span>
              <span className="text-[11px] text-muted-foreground">담당자가 참고하는 문서</span>
            </div>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="배경·기대 결과·주의사항을 적어주세요."
              className="min-h-[110px] text-[12.5px] leading-relaxed"
            />
          </div>

          <div className="px-5 pb-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[13px] font-semibold">체크리스트</span>
              <span className="text-[11px] text-muted-foreground">
                {checklist.filter((c) => c.trim() !== "").length}개 항목
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {checklist.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1"
                >
                  <span className="h-3 w-3 shrink-0 rounded-sm border" />
                  <Input
                    value={item}
                    onChange={(e) => updateChecklistItem(i, e.target.value)}
                    placeholder="체크리스트 항목"
                    className="h-6 border-none bg-transparent px-1 text-[12px] shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(i)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="항목 삭제"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={12} />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addChecklistItem}
                className="h-7 justify-start text-[12px] text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={12} />
                <span className="ml-1">항목 추가</span>
              </Button>
            </div>
          </div>

          {suggestedCards.length > 0 && (
            <div className="px-5 pb-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[13px] font-semibold">연결된 카드 · AI 추천</span>
                <span className="text-[11px] text-muted-foreground">Gemini 제안</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestedCards.map((card) => (
                  <Badge
                    key={card.id}
                    variant="secondary"
                    className="flex h-6 items-center gap-1 pr-1 text-[11px]"
                  >
                    <HugeiconsIcon icon={BookOpen01Icon} size={11} />
                    <span>{card.title}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSuggestedCards((prev) => prev.filter((s) => s.id !== card.id))
                      }
                      className="ml-1 rounded p-0.5 hover:bg-muted"
                      aria-label="카드 제거"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div
            className="mx-5 mb-4 rounded-md border p-3"
            style={{
              background: "color-mix(in oklch, var(--primary) 6%, transparent)",
              borderColor: "color-mix(in oklch, var(--primary) 20%, transparent)",
            }}
          >
            <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-primary">
              <HugeiconsIcon icon={AiMagicIcon} size={12} /> AI 추가 지시 (선택)
            </div>
            <Input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="예: 컬럼 압력 체크 먼저, SOP v3 포맷"
              className="h-7 text-[12.5px]"
            />
            <div className="mt-1 text-[10.5px] text-muted-foreground">
              AI가 빈 필드와 지시사항·체크리스트·추천 카드를 채웁니다.
            </div>
          </div>

          {missing.length > 0 && (
            <div className="px-5 pb-3 text-[11px] text-[var(--color-warn)]">
              ⚠ {missing.join(" · ")} 누락 · AI 자동생성으로 보강하세요
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t bg-muted/40 px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-muted-foreground">
            <Checkbox
              checked={postToChat}
              onCheckedChange={(checked) => setPostToChat(checked === true)}
              className="h-3.5 w-3.5"
            />
            생성 후 #전체에 게시
          </label>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button variant="outline" size="sm" onClick={runAi} disabled={aiLoading}>
            {aiLoading ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <HugeiconsIcon icon={AiMagicIcon} size={12} />
            )}
            AI 자동생성
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {submitting ? <Spinner className="h-3 w-3" /> : null}
            최종 확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
