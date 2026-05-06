"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiMagicIcon,
  Task01Icon,
  Cancel01Icon,
  PlusSignIcon,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { PriorityRating } from "@/components/ui/priority-rating"
import { toast } from "sonner"
import { parseSlashTask } from "./slash-command-parser"
import { PrioritySchema } from "@/lib/schemas/task-ai"

interface TaskCmdModalV2Props {
  open: boolean
  rawCommand: string
  onClose: () => void
}

interface UserOption {
  id: string
  name: string
}

interface ProjectOption {
  id: string
  name: string
  product: { id: string; name: string; color: string } | null
}

/** 폼 스키마 — TaskAiDraft 기반 + 사용자 입력 필수 필드 */
const TaskFormSchema = z.object({
  name: z.string().min(1, "제목을 입력하세요").max(120),
  ownerId: z.string().min(1, "담당자를 선택하세요"),
  projectId: z.string().nullable(),
  priority: PrioritySchema,
  deadline: z.string().nullable(), // YYYY-MM-DD
  background: z.string(),
  checklist: z.array(z.string()),
})
type TaskFormValues = z.infer<typeof TaskFormSchema>

const PRIORITY_LABEL: Record<z.infer<typeof PrioritySchema>, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
}

export function TaskCmdModalV2({ open, rawCommand, onClose }: TaskCmdModalV2Props) {
  const router = useRouter()
  const parsed = useMemo(() => parseSlashTask(rawCommand), [rawCommand])

  const [users, setUsers] = useState<UserOption[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(TaskFormSchema),
    defaultValues: {
      name: "",
      ownerId: "",
      projectId: null,
      priority: "NORMAL",
      deadline: null,
      background: "",
      checklist: [],
    },
  })
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, dirtyFields },
  } = form
  const checklist = watch("checklist")
  const projectId = watch("projectId")
  const priority = watch("priority")
  const ownerId = watch("ownerId")

  // 모달 열림 시: 옵션 로딩 + 슬래시 파싱 결과로 초기화
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      fetch("/api/users").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([userList, projectList]) => {
        if (cancelled) return
        setUsers(userList)
        setProjects(projectList)
        // 슬래시 파싱 결과로 초기화 (이름 → id 매핑)
        const ownerByName = parsed?.ownerName
          ? userList.find((u: UserOption) => u.name === parsed.ownerName)
          : null
        const projectByName = parsed?.projectName
          ? projectList.find((p: ProjectOption) => p.name === parsed.projectName)
          : null
        reset({
          name: parsed?.title ?? "",
          ownerId: ownerByName?.id ?? "",
          projectId: projectByName?.id ?? null,
          priority: "NORMAL",
          deadline: parsed?.deadlineLabel ?? null,
          background: "",
          checklist: [],
        })
      })
      .catch(() => {
        toast.error("옵션 로딩 실패")
      })
    return () => {
      cancelled = true
    }
  }, [open, parsed, reset])

  /** R11: AI 응답이 도착해도 사용자가 이미 입력(dirtyFields)한 필드는 덮지 않음 */
  async function runAi() {
    setAiLoading(true)
    try {
      const res = await fetch("/api/ai/structure-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawMessage: rawCommand }),
      })
      if (!res.ok) throw new Error("AI 호출 실패")
      const ai = await res.json()

      // dirtyFields에 없는 필드만 적용
      if (!dirtyFields.name && ai.name) setValue("name", ai.name, { shouldDirty: false })
      if (!dirtyFields.background && ai.background) {
        setValue("background", ai.background, { shouldDirty: false })
      }
      if (!dirtyFields.priority && ai.priority) {
        setValue("priority", ai.priority, { shouldDirty: false })
      }
      if (!dirtyFields.ownerId && ai.ownerHint) {
        const found = users.find((u) => u.name === ai.ownerHint)
        if (found) setValue("ownerId", found.id, { shouldDirty: false })
      }
      if (!dirtyFields.projectId && ai.projectId) {
        setValue("projectId", ai.projectId, { shouldDirty: false })
      }
      if (!dirtyFields.deadline && ai.deadlineHint) {
        // 이미 ISO YYYY-MM-DD 형태면 그대로 사용. 상대표현은 사용자가 직접 확정.
        if (/^\d{4}-\d{2}-\d{2}$/.test(ai.deadlineHint)) {
          setValue("deadline", ai.deadlineHint, { shouldDirty: false })
        }
      }
      if (!dirtyFields.checklist && Array.isArray(ai.checklist) && ai.checklist.length > 0) {
        setValue("checklist", ai.checklist, { shouldDirty: false })
      }
      toast.success("AI 자동완성 완료")
    } catch {
      toast.error("AI 자동완성 실패")
    } finally {
      setAiLoading(false)
    }
  }

  async function onSubmit(values: TaskFormValues) {
    setSubmitting(true)
    try {
      const owner = users.find((u) => u.id === values.ownerId)
      const project = projects.find((p) => p.id === values.projectId)
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          ownerName: owner?.name ?? null,
          deadlineLabel: values.deadline,
          projectName: project?.name ?? null,
          productName: project?.product?.name ?? null,
          priority: values.priority,
          participants: [],
          instruction: values.background,
          checklist: values.checklist.filter((c) => c.trim() !== ""),
          rawCommand,
          // 규칙: #전체 게시는 v0 잔재로 폐기. 항상 채팅에 게시 (postToChat=true)
          postToChat: true,
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

  function addChecklistItem() {
    setValue("checklist", [...(checklist ?? []), ""], { shouldDirty: true })
  }
  function updateChecklistItem(i: number, value: string) {
    setValue(
      "checklist",
      (checklist ?? []).map((v, idx) => (idx === i ? value : v)),
      { shouldDirty: true },
    )
  }
  function removeChecklistItem(i: number) {
    setValue(
      "checklist",
      (checklist ?? []).filter((_, idx) => idx !== i),
      { shouldDirty: true },
    )
  }

  const selectedProject = projects.find((p) => p.id === projectId)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid max-h-[min(85vh,720px)] w-full max-w-[min(640px,calc(100vw-2rem))] grid-rows-[auto_1fr_auto] gap-0 p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold">
            <HugeiconsIcon icon={Task01Icon} size={14} className="text-primary" />
            업무 등록
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            확인 후 채팅에 자동 게시됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          id="task-cmd-modal-v2-form"
          onSubmit={handleSubmit(onSubmit)}
          className="min-h-0 overflow-y-auto"
        >
          <div className="px-5 pt-4">
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-[12px] text-muted-foreground">
              {rawCommand}
            </div>
          </div>

          <div className="px-5 py-4">
            <label htmlFor="task-name" className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
              제목 <span className="text-destructive">*</span>
            </label>
            <Input
              id="task-name"
              {...register("name")}
              placeholder="업무 한 줄 요약"
              className={`h-9 text-[13px] ${errors.name ? "border-destructive" : ""}`}
              autoComplete="off"
            />
            {errors.name && (
              <p className="mt-1 text-[11px] text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 px-5 pb-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                담당자 <span className="text-destructive">*</span>
              </label>
              <Select value={ownerId || ""} onValueChange={(v) => setValue("ownerId", v ?? "", { shouldDirty: true })}>
                <SelectTrigger className={`h-9 text-[13px] ${errors.ownerId ? "border-destructive" : ""}`}>
                  <SelectValue placeholder="담당자 선택">
                    {ownerId ? users.find((u) => u.id === ownerId)?.name : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} label={u.name} className="text-[13px]">
                      <Avatar className="mr-2 inline-flex h-5 w-5 align-middle">
                        <AvatarFallback className="text-[9px]">{u.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.ownerId && (
                <p className="mt-1 text-[11px] text-destructive">{errors.ownerId.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="task-deadline" className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                마감일
              </label>
              <Input
                id="task-deadline"
                type="date"
                {...register("deadline")}
                className="h-9 text-[13px]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                프로젝트 (제품 자동 매핑)
              </label>
              <Select
                value={projectId ?? "none"}
                onValueChange={(v) => setValue("projectId", !v || v === "none" ? null : v, { shouldDirty: true })}
              >
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder="프로젝트 없음">
                    {selectedProject ? (
                      <span>
                        {selectedProject.product ? (
                          <span className="text-muted-foreground">
                            {selectedProject.product.name} /{" "}
                          </span>
                        ) : null}
                        {selectedProject.name}
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="프로젝트 없음" className="text-[13px]">
                    프로젝트 없음
                  </SelectItem>
                  {projects.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      label={p.product ? `${p.product.name} / ${p.name}` : p.name}
                      className="text-[13px]"
                    >
                      {p.product ? (
                        <span className="text-muted-foreground">{p.product.name} / </span>
                      ) : null}
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                우선순위
              </label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
                <PriorityRating
                  value={priority ?? "NORMAL"}
                  onChange={(v) => setValue("priority", v as z.infer<typeof PrioritySchema>, { shouldDirty: true })}
                  size={18}
                />
                <span className="text-[12px] text-muted-foreground">
                  {PRIORITY_LABEL[priority ?? "NORMAL"]}
                </span>
              </div>
            </div>
          </div>

          <div className="px-5 pb-4">
            <label htmlFor="task-background" className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
              배경 / 지시사항
            </label>
            <Textarea
              id="task-background"
              {...register("background")}
              placeholder="배경, 주의사항, 참고 문서 등을 적어주세요."
              className="min-h-[88px] text-[12.5px] leading-relaxed"
            />
          </div>

          <div className="px-5 pb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-[11px] font-semibold text-muted-foreground">
                체크리스트 ({(checklist ?? []).filter((c) => c.trim() !== "").length}개)
              </label>
            </div>
            <div className="flex flex-col gap-1.5">
              {(checklist ?? []).map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1"
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm border" />
                  <Input
                    value={item}
                    onChange={(e) => updateChecklistItem(i, e.target.value)}
                    placeholder="체크리스트 항목"
                    className="h-7 border-none bg-transparent px-1 text-[12.5px] shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(i)}
                    aria-label="항목 삭제"
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
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
                className="h-8 justify-start text-[12px] text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={12} />
                <span className="ml-1">항목 추가</span>
              </Button>
            </div>
          </div>
        </form>

        <div className="flex items-center gap-2 border-t bg-muted/40 px-5 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runAi}
            disabled={aiLoading}
            className="gap-1.5"
          >
            {aiLoading ? <Spinner className="h-3 w-3" /> : <HugeiconsIcon icon={AiMagicIcon} size={12} />}
            AI 자동완성
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            type="submit"
            form="task-cmd-modal-v2-form"
            size="sm"
            disabled={submitting}
            className="gap-1.5"
          >
            {submitting ? <Spinner className="h-3 w-3" /> : null}
            업무 등록
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
