"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { format } from "date-fns"
import { parseSlashTask, resolveDeadline } from "./slash-command-parser"
import { PrioritySchema } from "@/lib/schemas/task-ai"
import { matchUserByName } from "@/lib/name-match"

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

interface ProductOption {
  id: string
  name: string
  color: string
}

/** 프로젝트 Select에서 "신규 프로젝트 생성"을 의미하는 sentinel 값 */
const NEW_PROJECT_VALUE = "__new__"
/** 제품 Select에서 "신규 제품 생성"을 의미하는 sentinel 값 */
const NEW_PRODUCT_VALUE = "__new_product__"

/** 폼 스키마 — TaskAiDraft 기반 + 사용자 입력 필수 필드 */
const TaskFormSchema = z
  .object({
    name: z.string().min(1, "제목을 입력하세요").max(120),
    ownerIds: z.array(z.string()).min(1, "담당자를 한 명 이상 선택하세요"),
    projectId: z.string().nullable(),
    productId: z.string().nullable(),
    priority: PrioritySchema,
    deadline: z.string().nullable(), // YYYY-MM-DD
    background: z.string(),
    checklist: z.array(z.string()),
    // 신규 프로젝트 생성 시에만 사용 (projectId === NEW_PROJECT_VALUE)
    newProjectName: z.string(),
    newProjectPurpose: z.string(),
    newProjectGoal: z.string(),
    // 신규 제품 생성 시에만 사용 (productId === NEW_PRODUCT_VALUE)
    newProductName: z.string(),
  })
  .refine(
    (v) => v.projectId !== NEW_PROJECT_VALUE || v.newProjectName.trim().length > 0,
    { message: "프로젝트명을 입력하세요", path: ["newProjectName"] },
  )
  .refine(
    (v) => v.productId !== NEW_PRODUCT_VALUE || v.newProductName.trim().length > 0,
    { message: "제품명을 입력하세요", path: ["newProductName"] },
  )
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
  const [products, setProducts] = useState<ProductOption[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [glowFields, setGlowFields] = useState<Set<string>>(new Set())
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 자동 채워진 필드 테두리를 잠깐 빛나게 한다 */
  const flashGlow = useCallback((fields: string[]) => {
    if (fields.length === 0) return
    if (glowTimer.current) clearTimeout(glowTimer.current)
    setGlowFields(new Set(fields))
    glowTimer.current = setTimeout(() => setGlowFields(new Set()), 1700)
  }, [])

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(TaskFormSchema),
    defaultValues: {
      name: "",
      ownerIds: [],
      projectId: null,
      productId: null,
      priority: "NORMAL",
      deadline: null,
      background: "",
      checklist: [],
      newProjectName: "",
      newProjectPurpose: "",
      newProjectGoal: "",
      newProductName: "",
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
  const productId = watch("productId")
  const priority = watch("priority")
  const ownerIds = watch("ownerIds")

  // 모달 열림 시: 옵션 로딩 + 슬래시 파싱 결과로 초기화
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      fetch("/api/users").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/products").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([userList, projectList, productList]) => {
        if (cancelled) return
        setUsers(userList)
        setProjects(projectList)
        setProducts(productList)
        // 슬래시 파싱 결과로 초기화 (이름 → id 매핑)
        const ownerByName = parsed?.ownerName
          ? userList.find((u: UserOption) => u.name === parsed.ownerName)
          : null
        const projectByName = parsed?.projectName
          ? projectList.find((p: ProjectOption) => p.name === parsed.projectName)
          : null
        reset({
          name: parsed?.title ?? "",
          ownerIds: ownerByName ? [ownerByName.id] : [],
          projectId: projectByName?.id ?? null,
          productId: projectByName?.product?.id ?? null,
          priority: "NORMAL",
          deadline: parsed?.deadline
            ? format(parsed.deadline, "yyyy-MM-dd")
            : null,
          background: "",
          checklist: [],
          newProjectName: "",
          newProjectPurpose: "",
          newProjectGoal: "",
          newProductName: "",
        })
        // 슬래시 명령에서 자동 추출된 필드 글로우
        const preFilled: string[] = []
        if (parsed?.title) preFilled.push("name")
        if (ownerByName) preFilled.push("ownerIds")
        if (projectByName) preFilled.push("projectId")
        if (parsed?.deadline) preFilled.push("deadline")
        flashGlow(preFilled)
      })
      .catch(() => {
        toast.error("옵션 로딩 실패")
      })
    return () => {
      cancelled = true
    }
  }, [open, parsed, reset, flashGlow])

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

      // dirtyFields에 없는 필드만 적용 + 채운 필드 기록(글로우용)
      const filled: string[] = []
      if (!dirtyFields.name && ai.name) {
        setValue("name", ai.name, { shouldDirty: false })
        filled.push("name")
      }
      if (!dirtyFields.background && ai.background) {
        setValue("background", ai.background, { shouldDirty: false })
        filled.push("background")
      }
      if (!dirtyFields.priority && ai.priority) {
        setValue("priority", ai.priority, { shouldDirty: false })
        filled.push("priority")
      }
      if (!dirtyFields.ownerIds && ai.ownerHints.length > 0) {
        // 존칭("우창님")·약칭("우창")도 흡수해 팀원과 매칭
        // 여러 명을 지목한 지시("인턴들 각자 ~")면 모두 채운다
        const found = (ai.ownerHints as string[])
          .map((hint: string) => matchUserByName(hint, users))
          .filter((u: UserOption | null | undefined): u is UserOption => !!u)
        if (found.length > 0) {
          setValue("ownerIds", found.map((u: UserOption) => u.id), { shouldDirty: false })
          filled.push("ownerIds")
        }
      }
      if (!dirtyFields.projectId) {
        if (ai.newProject) {
          // AI가 신규 프로젝트 생성을 제안 → 신규 프로젝트 모드 전환 + 필드 채움
          setValue("projectId", NEW_PROJECT_VALUE, { shouldDirty: false })
          setValue("newProjectName", ai.newProject.name ?? "", { shouldDirty: false })
          setValue("newProjectPurpose", ai.newProject.purpose ?? "", { shouldDirty: false })
          setValue("newProjectGoal", ai.newProject.goal ?? "", { shouldDirty: false })
          filled.push("projectId")
        } else if (ai.projectId) {
          setValue("projectId", ai.projectId, { shouldDirty: false })
          filled.push("projectId")
        }
      }
      if (!dirtyFields.productId) {
        if (ai.newProduct?.name) {
          // AI가 신규 제품 생성을 제안 → 신규 제품 모드 전환 + 제품명 채움
          setValue("productId", NEW_PRODUCT_VALUE, { shouldDirty: false })
          setValue("newProductName", ai.newProduct.name, { shouldDirty: false })
          filled.push("productId")
        } else if (ai.productId) {
          setValue("productId", ai.productId, { shouldDirty: false })
          filled.push("productId")
        } else if (ai.newProject?.productId) {
          // 신규 프로젝트가 기존 제품을 참조한 경우 그 제품을 업무 제품으로 사용
          setValue("productId", ai.newProject.productId, { shouldDirty: false })
          filled.push("productId")
        }
      }
      if (!dirtyFields.deadline && ai.deadlineHint) {
        // ISO(YYYY-MM-DD)면 그대로, 한국어 상대표현이면 날짜로 변환
        let ymd: string | null = null
        if (/^\d{4}-\d{2}-\d{2}$/.test(ai.deadlineHint)) {
          ymd = ai.deadlineHint
        } else {
          const resolved = resolveDeadline(ai.deadlineHint)
          if (resolved) ymd = format(resolved, "yyyy-MM-dd")
        }
        if (ymd) {
          setValue("deadline", ymd, { shouldDirty: false })
          filled.push("deadline")
        }
      }
      if (!dirtyFields.checklist && Array.isArray(ai.checklist) && ai.checklist.length > 0) {
        setValue("checklist", ai.checklist, { shouldDirty: false })
        filled.push("checklist")
      }
      flashGlow(filled)
      if (ai._fallback && ai.message) toast.info(ai.message)
      else toast.success("AI 자동완성 완료")
    } catch {
      toast.error("AI 자동완성 실패")
    } finally {
      setAiLoading(false)
    }
  }

  async function onSubmit(values: TaskFormValues) {
    setSubmitting(true)
    try {
      const owners = users.filter((u) => values.ownerIds.includes(u.id))
      const isNewProject = values.projectId === NEW_PROJECT_VALUE
      const isNewProduct = values.productId === NEW_PRODUCT_VALUE

      // 1. 제품 결정: 신규 생성 / 기존 선택 / 없음
      let finalProductId: string | null = null
      if (isNewProduct) {
        const prodRes = await fetch("/api/products", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: values.newProductName.trim() }),
        })
        if (!prodRes.ok) throw new Error("제품 생성 실패")
        const prod = await prodRes.json()
        finalProductId = prod.id
      } else {
        finalProductId = values.productId ?? null
      }

      // 2. 프로젝트 결정: 신규 생성 / 기존 선택 / 없음
      //    신규 프로젝트의 제품은 위에서 결정한 finalProductId를 그대로 사용
      let finalProjectId: string | null = null
      if (isNewProject) {
        const projRes = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: values.newProjectName,
            productId: finalProductId,
            purpose: values.newProjectPurpose,
            goal: values.newProjectGoal,
          }),
        })
        if (!projRes.ok) throw new Error("프로젝트 생성 실패")
        const proj = await projRes.json()
        finalProjectId = proj.id
      } else if (values.projectId) {
        finalProjectId = values.projectId
      }

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          ownerNames: owners.map((u) => u.name),
          deadlineLabel: values.deadline,
          projectId: finalProjectId,
          productId: finalProductId,
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
      const created = [isNewProject && "프로젝트", isNewProduct && "제품"].filter(
        Boolean,
      )
      toast.success(
        created.length > 0
          ? `신규 ${created.join("·")}와 업무 생성 완료`
          : "업무 생성 완료",
      )
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
              className={`h-9 text-[13px] ${errors.name ? "border-destructive" : ""} ${glowFields.has("name") ? "ai-fill-glow" : ""}`}
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
              {/* 담당자는 여러 명일 수 있다. 인원이 10명 안쪽이라 칩 토글이
                  드롭다운보다 빠르고, 지금 누가 걸려 있는지 한눈에 보인다. */}
              <div
                role="group"
                aria-label="담당자 선택"
                className={`flex flex-wrap gap-1.5 rounded-md border p-2 ${
                  errors.ownerIds ? "border-destructive" : "border-input"
                } ${glowFields.has("ownerIds") ? "ai-fill-glow" : ""}`}
              >
                {users.map((u) => {
                  const on = ownerIds.includes(u.id)
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setValue(
                          "ownerIds",
                          on ? ownerIds.filter((id) => id !== u.id) : [...ownerIds, u.id],
                          { shouldDirty: true },
                        )
                      }
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted"
                      }`}
                    >
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[9px]">{u.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {u.name}
                    </button>
                  )
                })}
              </div>
              {errors.ownerIds && (
                <p className="mt-1 text-[11px] text-destructive">{errors.ownerIds.message}</p>
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
                className={`h-9 text-[13px] ${glowFields.has("deadline") ? "ai-fill-glow" : ""}`}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                프로젝트 (제품 자동 매핑)
              </label>
              <Select
                value={projectId ?? "none"}
                onValueChange={(v) => {
                  const next = !v || v === "none" ? null : v
                  setValue("projectId", next, { shouldDirty: true })
                  // 기존 프로젝트 선택 시 제품을 그 프로젝트의 제품으로 자동 매핑
                  if (next && next !== NEW_PROJECT_VALUE) {
                    const proj = projects.find((p) => p.id === next)
                    setValue("productId", proj?.product?.id ?? null, { shouldDirty: true })
                  }
                }}
              >
                <SelectTrigger className={`h-9 w-full text-[13px] ${glowFields.has("projectId") ? "ai-fill-glow" : ""}`}>
                  <SelectValue placeholder="프로젝트 없음">
                    {projectId === NEW_PROJECT_VALUE ? (
                      <span className="font-medium text-primary">+ 신규 프로젝트 생성</span>
                    ) : selectedProject ? (
                      <span>
                        {selectedProject.product ? (
                          <span className="text-muted-foreground">
                            {selectedProject.product.name} /{" "}
                          </span>
                        ) : null}
                        {selectedProject.name}
                      </span>
                    ) : (
                      "프로젝트 없음"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="프로젝트 없음" className="text-[13px]">
                    프로젝트 없음
                  </SelectItem>
                  <SelectItem
                    value={NEW_PROJECT_VALUE}
                    label="+ 신규 프로젝트 생성"
                    className="text-[13px]"
                  >
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <HugeiconsIcon icon={PlusSignIcon} size={12} />
                      신규 프로젝트 생성
                    </span>
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

              {projectId === NEW_PROJECT_VALUE && (
                <div className="mt-2 flex flex-col gap-2.5 rounded-md border border-dashed border-primary/40 bg-primary/[0.03] p-3">
                  <p className="text-[11px] font-semibold text-primary">신규 프로젝트 정보</p>

                  <div>
                    <label
                      htmlFor="new-project-name"
                      className="mb-1 block text-[11px] font-medium text-muted-foreground"
                    >
                      프로젝트명 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="new-project-name"
                      {...register("newProjectName")}
                      placeholder="예: 전사 자원관리 시스템 구축"
                      className={`h-8 text-[12.5px] ${errors.newProjectName ? "border-destructive" : ""}`}
                      autoComplete="off"
                    />
                    {errors.newProjectName && (
                      <p className="mt-1 text-[11px] text-destructive">
                        {errors.newProjectName.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="new-project-purpose"
                      className="mb-1 block text-[11px] font-medium text-muted-foreground"
                    >
                      목적
                    </label>
                    <Textarea
                      id="new-project-purpose"
                      {...register("newProjectPurpose")}
                      placeholder="이 프로젝트를 왜 하는지 (1-2문장)"
                      className="min-h-[52px] text-[12.5px] leading-relaxed"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="new-project-goal"
                      className="mb-1 block text-[11px] font-medium text-muted-foreground"
                    >
                      목표
                    </label>
                    <Input
                      id="new-project-goal"
                      {...register("newProjectGoal")}
                      placeholder="달성하려는 결과 한 줄"
                      className="h-8 text-[12.5px]"
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                제품
              </label>
              <Select
                value={productId ?? "none"}
                onValueChange={(v) =>
                  setValue("productId", !v || v === "none" ? null : v, { shouldDirty: true })
                }
              >
                <SelectTrigger className={`h-9 w-full text-[13px] ${glowFields.has("productId") ? "ai-fill-glow" : ""}`}>
                  <SelectValue placeholder="제품 없음">
                    {productId === NEW_PRODUCT_VALUE ? (
                      <span className="font-medium text-primary">+ 신규 제품 생성</span>
                    ) : productId ? (
                      products.find((p) => p.id === productId)?.name ?? "제품 없음"
                    ) : (
                      "제품 없음"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="제품 없음" className="text-[13px]">
                    제품 없음
                  </SelectItem>
                  <SelectItem
                    value={NEW_PRODUCT_VALUE}
                    label="+ 신규 제품 생성"
                    className="text-[13px]"
                  >
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <HugeiconsIcon icon={PlusSignIcon} size={12} />
                      신규 제품 생성
                    </span>
                  </SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id} label={p.name} className="text-[13px]">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {productId === NEW_PRODUCT_VALUE && (
                <div className="mt-2">
                  <Input
                    {...register("newProductName")}
                    aria-label="신규 제품명"
                    placeholder="신규 제품명 (예: 비보젤)"
                    className={`h-8 text-[12.5px] ${errors.newProductName ? "border-destructive" : ""}`}
                    autoComplete="off"
                  />
                  {errors.newProductName && (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.newProductName.message}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                우선순위
              </label>
              <div className={`flex h-9 items-center gap-2 rounded-md border bg-background px-3 ${glowFields.has("priority") ? "ai-fill-glow" : ""}`}>
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
              className={`min-h-[88px] text-[12.5px] leading-relaxed ${glowFields.has("background") ? "ai-fill-glow" : ""}`}
            />
          </div>

          <div className="px-5 pb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-[11px] font-semibold text-muted-foreground">
                체크리스트 ({(checklist ?? []).filter((c) => c.trim() !== "").length}개)
              </label>
            </div>
            <div className={`flex flex-col gap-1.5 rounded-md ${glowFields.has("checklist") ? "ai-fill-glow" : ""}`}>
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
            className="gap-1.5 ai-rainbow-border"
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
