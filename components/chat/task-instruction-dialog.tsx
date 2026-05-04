"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface TaskDraft {
  name: string
  background: string
  expectedResult: string
  checklist: string[]
  projectId: string | null
  categoryId: string | null
}

interface Project {
  id: string
  name: string
  status: string
  product?: { id: string; name: string; color: string } | null
}

interface Category {
  id: string
  name: string
  icon: string | null
}

interface SourceMessage {
  author: string
  content: string
  createdAt: string
}

interface TaskInstructionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedMessages: SourceMessage[]
  ownerId: string
  ownerName: string
  onTaskCreated: () => void
  messageIds: string[]
}

const NEW_PROJECT_VALUE = "__new__"

export function TaskInstructionDialog({
  open,
  onOpenChange,
  selectedMessages,
  ownerId,
  ownerName,
  onTaskCreated,
  messageIds,
}: TaskInstructionDialogProps) {
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  const [projects, setProjects] = useState<Project[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>("")
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("")
  const [newProjectName, setNewProjectName] = useState("")

  useEffect(() => {
    if (open && selectedMessages.length > 0) {
      structureMessages()
    }
    if (open) {
      fetchProjects()
      fetchCategories()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function fetchProjects() {
    try {
      const res = await fetch("/api/projects")
      if (res.ok) {
        setProjects(await res.json())
      }
    } catch {
      // ignore
    }
  }

  async function fetchCategories() {
    try {
      const res = await fetch("/api/categories")
      if (res.ok) {
        setCategories(await res.json())
      }
    } catch {
      // ignore
    }
  }

  async function structureMessages() {
    setLoading(true)
    try {
      const res = await fetch("/api/ai/structure-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: selectedMessages.map((m) => `${m.author}: ${m.content}`),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setDraft(data)
        // Gemini 추천 프로젝트/카테고리 자동 선택
        if (data.projectId) setSelectedProjectId(data.projectId)
        if (data.categoryId) setSelectedCategoryId(data.categoryId)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!draft) return
    setCreating(true)
    try {
      let projectId: string | null = null

      if (selectedProjectId === NEW_PROJECT_VALUE) {
        if (newProjectName.trim()) {
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newProjectName.trim() }),
          })
          if (res.ok) {
            const created: Project = await res.json()
            projectId = created.id
          }
        }
      } else if (selectedProjectId) {
        projectId = selectedProjectId
      }

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          ownerId,
          background: draft.background,
          expectedResult: draft.expectedResult,
          checklists: draft.checklist.map((name) => ({ name })),
          messageIds,
          sourceMessages: selectedMessages,
          projectId,
          categoryId: selectedCategoryId || null,
        }),
      })
      if (res.ok) {
        onOpenChange(false)
        onTaskCreated()
      }
    } finally {
      setCreating(false)
    }
  }

  const isCreatingNew = selectedProjectId === NEW_PROJECT_VALUE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>업무 확인</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Spinner />
            <span className="text-sm text-muted-foreground">
              Gemini가 업무를 구조화하는 중...
            </span>
          </div>
        )}

        {!loading && draft && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">업무명</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-display" className="text-xs">담당자</Label>
              <div id="owner-display" className="text-sm font-medium">{ownerName}</div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">프로젝트</Label>
              <Select
                value={selectedProjectId}
                onValueChange={(value) => setSelectedProjectId(value ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="프로젝트 선택 (선택사항)">
                    {selectedProjectId === NEW_PROJECT_VALUE
                      ? "새 프로젝트 생성"
                      : selectedProjectId
                        ? (projects.find((p) => p.id === selectedProjectId)?.name ?? null)
                        : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id} label={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_PROJECT_VALUE} label="새 프로젝트 생성">
                    ➕ 새 프로젝트 생성
                  </SelectItem>
                </SelectContent>
              </Select>
              {isCreatingNew && (
                <Input
                  placeholder="새 프로젝트명 입력"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="mt-1"
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">카테고리</Label>
              <Select
                value={selectedCategoryId}
                onValueChange={(value) => setSelectedCategoryId(value ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="카테고리 선택 (선택사항)">
                    {selectedCategoryId
                      ? (() => {
                          const cat = categories.find((c) => c.id === selectedCategoryId)
                          return cat ? `${cat.icon ?? ""} ${cat.name}`.trim() : null
                        })()
                      : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id} label={c.name}>
                      {c.icon ? `${c.icon} ` : ""}{c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">배경</Label>
              <Textarea
                value={draft.background}
                onChange={(e) =>
                  setDraft({ ...draft, background: e.target.value })
                }
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">기대 결과</Label>
              <Input
                value={draft.expectedResult}
                onChange={(e) =>
                  setDraft({ ...draft, expectedResult: e.target.value })
                }
                className="text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">체크리스트</Label>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, checklist: [...draft.checklist, ""] })}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HugeiconsIcon icon={Add01Icon} size={13} />
                  항목 추가
                </button>
              </div>
              {draft.checklist.length > 0 && (
                <div className="flex flex-col gap-1">
                  {draft.checklist.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {i + 1}
                      </Badge>
                      <Input
                        value={item}
                        onChange={(e) => {
                          const next = [...draft.checklist]
                          next[i] = e.target.value
                          setDraft({ ...draft, checklist: next })
                        }}
                        className="h-8 text-sm flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = draft.checklist.filter((_, j) => j !== i)
                          setDraft({ ...draft, checklist: next })
                        }}
                        className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              선택된 메시지 {selectedMessages.length}개
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleCreate} disabled={creating || loading || !draft}>
            {creating ? <Spinner /> : "업무 생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
