"use client"

import { useState, useRef, KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, PRIORITY_LABELS } from "@/lib/constants"
import { PriorityRating } from "@/components/ui/priority-rating"
import { HugeiconsIcon } from "@hugeicons/react"
import { PencilEdit01Icon, Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { format } from "date-fns"

interface Checklist {
  id: string
  name: string
  done: boolean
  memo: string | null
}

interface FeedbackMessage {
  id: string
  content: string
  author: { id: string; name: string }
  isTaskInstruction: boolean
  createdAt: string
}

interface FileInfo {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
  createdAt: string
}

interface Task {
  id: string
  name: string
  slug: string
  status: string
  priority: string
  background: string | null
  owner: { id: string; name: string }
  instructor: { id: string; name: string }
  project: { id: string; name: string; product?: { id: string; name: string; color: string } | null } | null
  checklists: Checklist[]
  sourceMessages: unknown
  feedbackMessages: FeedbackMessage[]
  files: FileInfo[]
  createdAt: string
  deadline: string | null
  workStart: string | null
  workEnd: string | null
}

interface Project {
  id: string
  name: string
  /** 1-hop project.product (CLAUDE.md 규칙 21) — 프로젝트 선택 시 자동 표시 */
  product?: { id: string; name: string; color: string } | null
}

const STATUS_OPTIONS = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const
const PRIORITY_OPTIONS = ["LOW", "NORMAL", "HIGH"] as const

export function TaskDetail({
  task: initial,
  projects = [],
}: {
  task: Task
  projects?: Project[]
}) {
  const router = useRouter()
  const [task, setTask] = useState(initial)
  const [saving, setSaving] = useState<string | null>(null)

  // 편집 상태
  const [editingName, setEditingName] = useState(false)
  const [editingBackground, setEditingBackground] = useState(false)
  const [editingDeadline, setEditingDeadline] = useState(false)

  // 편집 중 임시값
  const [draftName, setDraftName] = useState(task.name)
  const [draftBackground, setDraftBackground] = useState(task.background ?? "")
  const [draftDeadline, setDraftDeadline] = useState(
    task.deadline ? task.deadline.slice(0, 10) : ""
  )

  const nameRef = useRef<HTMLInputElement>(null)
  const backgroundRef = useRef<HTMLTextAreaElement>(null)
  const deadlineRef = useRef<HTMLInputElement>(null)

  async function patch(field: string, value: unknown) {
    setSaving(field)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        setTask((prev) => ({ ...prev, [field]: value }))
        router.refresh()
      }
    } finally {
      setSaving(null)
    }
  }

  async function updateStatus(status: string) {
    setSaving("status")
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setTask((prev) => ({ ...prev, status }))
        router.refresh()
      }
    } finally {
      setSaving(null)
    }
  }

  async function toggleChecklist(id: string, done: boolean) {
    const res = await fetch(`/api/tasks/${task.id}/checklists`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done }),
    })
    if (res.ok) {
      setTask((prev) => ({
        ...prev,
        checklists: prev.checklists.map((c) => (c.id === id ? { ...c, done } : c)),
      }))
    }
  }

  // 업무명 저장
  function commitName() {
    setEditingName(false)
    if (draftName.trim() && draftName !== task.name) {
      patch("name", draftName.trim())
    }
  }

  // 배경 저장
  function commitBackground() {
    setEditingBackground(false)
    const val = draftBackground.trim() || null
    if (val !== task.background) {
      patch("background", val)
    }
  }

  // 마감일 저장
  function commitDeadline() {
    setEditingDeadline(false)
    const val = draftDeadline || null
    const currentVal = task.deadline ? task.deadline.slice(0, 10) : null
    if (val !== currentVal) {
      patch("deadline", val)
    }
  }

  const doneCount = task.checklists.filter((c) => c.done).length
  const sourceMsgs = task.sourceMessages as { author: string; content: string; createdAt: string }[] | null
  const feedbackMsgs = task.feedbackMessages.filter((m) => !m.isTaskInstruction && !m.content.startsWith("🤖"))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {/* 업무명 */}
      <Card>
        <CardContent className="pt-6">
          <div className="group flex items-start gap-2">
            {editingName ? (
              <Input
                ref={nameRef}
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") commitName()
                  if (e.key === "Escape") { setEditingName(false); setDraftName(task.name) }
                }}
                className="text-base font-semibold h-8"
                disabled={saving === "name"}
              />
            ) : (
              <>
                <h2 className="text-base font-semibold flex-1">{task.name}</h2>
                <button
                  onClick={() => { setDraftName(task.name); setEditingName(true) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted shrink-0 mt-0.5"
                  aria-label="업무명 편집"
                >
                  <HugeiconsIcon icon={PencilEdit01Icon} size={14} className="text-muted-foreground" />
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 상태 + 메타 */}
      <Card>
        <CardContent className="pt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{task.owner.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="text-sm font-medium">{task.owner.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  지시: {task.instructor.name}
                </div>
              </div>
            </div>
            <Select value={task.status} onValueChange={(v) => v && updateStatus(v)} disabled={saving === "status"}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue>{TASK_STATUS_LABELS[task.status] ?? task.status}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s} label={TASK_STATUS_LABELS[s]} className="text-xs">
                    {TASK_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 메타 필드 그리드 */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {/* 우선순위 */}
            <div>
              <div className="text-xs text-muted-foreground mb-1">우선순위</div>
              <PriorityRating
                value={task.priority}
                onChange={(v) => patch("priority", v)}
                disabled={saving === "priority"}
                size={18}
              />
            </div>

            {/* 마감일 */}
            <div>
              <div className="text-xs text-muted-foreground mb-1">마감일</div>
              {editingDeadline ? (
                <Input
                  ref={deadlineRef}
                  type="date"
                  autoFocus
                  value={draftDeadline}
                  onChange={(e) => setDraftDeadline(e.target.value)}
                  onBlur={commitDeadline}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") commitDeadline()
                    if (e.key === "Escape") {
                      setEditingDeadline(false)
                      setDraftDeadline(task.deadline ? task.deadline.slice(0, 10) : "")
                    }
                  }}
                  className="h-7 text-xs"
                  disabled={saving === "deadline"}
                />
              ) : (
                <div
                  className="group flex items-center gap-1 cursor-pointer rounded px-2 py-1 hover:bg-muted h-7"
                  onClick={() => {
                    setDraftDeadline(task.deadline ? task.deadline.slice(0, 10) : "")
                    setEditingDeadline(true)
                  }}
                >
                  <span className="text-xs flex-1">
                    {task.deadline ? format(new Date(task.deadline), "yyyy-MM-dd") : "—"}
                  </span>
                  <HugeiconsIcon icon={PencilEdit01Icon} size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </div>

            {/* 프로젝트 */}
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground mb-1">프로젝트</div>
              <Select
                value={task.project?.id ?? "none"}
                onValueChange={(v) => {
                  const newProjectId = v === "none" ? null : v
                  patch("projectId", newProjectId).then(() => {
                    const found = projects.find((p) => p.id === v) ?? null
                    setTask((prev) => ({ ...prev, project: found }))
                  })
                }}
                disabled={saving === "projectId"}
              >
                <SelectTrigger className="h-7 text-xs w-full">
                  <SelectValue placeholder="프로젝트 없음">
                    {task.project ? task.project.name : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" label="없음" className="text-xs">
                    없음
                  </SelectItem>
                  {projects.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      label={p.product ? `${p.product.name} / ${p.name}` : p.name}
                      className="text-xs"
                    >
                      {p.product ? <span className="text-muted-foreground">{p.product.name} / </span> : null}
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className={TASK_STATUS_COLORS[task.status] ?? ""}>
              {TASK_STATUS_LABELS[task.status]}
            </Badge>
            <PriorityRating value={task.priority} size={14} />
            {task.project && (
              <Badge variant="outline" className="text-[10px]">
                {task.project.product ? `${task.project.product.name} / ` : ""}{task.project.name}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 업무 개요 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">업무 개요</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* 배경 */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">배경</div>
            {editingBackground ? (
              <Textarea
                ref={backgroundRef}
                autoFocus
                value={draftBackground}
                onChange={(e) => setDraftBackground(e.target.value)}
                onBlur={commitBackground}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === "Escape") { setEditingBackground(false); setDraftBackground(task.background ?? "") }
                }}
                className="text-sm min-h-[80px] resize-none"
                placeholder="배경을 입력하세요"
                disabled={saving === "background"}
              />
            ) : (
              <div
                className="group flex items-start gap-2 cursor-pointer rounded p-2 hover:bg-muted -mx-2"
                onClick={() => { setDraftBackground(task.background ?? ""); setEditingBackground(true) }}
              >
                <p className="text-sm flex-1 whitespace-pre-wrap min-h-[1.25rem]">
                  {task.background ?? <span className="text-muted-foreground text-xs">클릭하여 배경 입력</span>}
                </p>
                <HugeiconsIcon icon={PencilEdit01Icon} size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* 체크리스트 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            체크리스트
            <div className="flex items-center gap-2">
              <span className="text-xs font-normal text-muted-foreground">
                {doneCount}/{task.checklists.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={async () => {
                  const res = await fetch(`/api/tasks/${task.id}/checklists`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "새 항목" }),
                  })
                  if (res.ok) {
                    const cl = await res.json()
                    setTask((prev) => ({ ...prev, checklists: [...prev.checklists, { ...cl, done: false, memo: null }] }))
                  }
                }}
              >
                <HugeiconsIcon icon={Add01Icon} size={12} />
                추가
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1">
            {task.checklists.map((cl) => (
              <ChecklistItem
                key={cl.id}
                item={cl}
                taskId={task.id}
                onToggle={(done) => toggleChecklist(cl.id, done)}
                onRename={(name) => {
                  setTask((prev) => ({
                    ...prev,
                    checklists: prev.checklists.map((c) => c.id === cl.id ? { ...c, name } : c),
                  }))
                }}
                onDelete={() => {
                  setTask((prev) => ({
                    ...prev,
                    checklists: prev.checklists.filter((c) => c.id !== cl.id),
                  }))
                }}
              />
            ))}
            {task.checklists.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">체크리스트가 없습니다. 추가 버튼을 눌러 항목을 만드세요.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 원본 지시 메시지 */}
      {sourceMsgs && sourceMsgs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">원본 지시 메시지</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {sourceMsgs.map((msg, i) => (
                <div key={i} className="rounded-md bg-muted p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {msg.author}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 피드백 메시지 */}
      {feedbackMsgs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              피드백 / 추가 지시
              <Badge variant="secondary" className="text-[10px]">{feedbackMsgs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {feedbackMsgs.map((msg) => (
                <div key={msg.id} className="flex gap-2 rounded-md border p-2.5">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-[10px]">{msg.author.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium">{msg.author.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(msg.createdAt), "MM/dd HH:mm")}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 첨부 파일 */}
      {task.files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              첨부 파일
              <Badge variant="secondary" className="text-[10px]">{task.files.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              {task.files.map((f) => (
                <a
                  key={f.id}
                  href={f.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted transition-colors"
                >
                  <span className="text-sm truncate">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                    {f.size < 1024 ? `${f.size}B` : f.size < 1048576 ? `${Math.round(f.size / 1024)}KB` : `${(f.size / 1048576).toFixed(1)}MB`}
                  </span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 업무 완료 버튼 */}
      {task.status !== "DONE" && (
        <>
          <Separator />
          <Button onClick={() => updateStatus("DONE")} className="w-full" disabled={saving === "status"}>
            업무 완료
          </Button>
        </>
      )}
    </div>
  )
}

function ChecklistItem({
  item,
  taskId,
  onToggle,
  onRename,
  onDelete,
}: {
  item: { id: string; name: string; done: boolean; memo: string | null }
  taskId: string
  onToggle: (done: boolean) => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.name)

  async function commitRename() {
    setEditing(false)
    const trimmed = draft.trim()
    if (!trimmed || trimmed === item.name) { setDraft(item.name); return }
    onRename(trimmed)
    await fetch(`/api/tasks/${taskId}/checklists`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, name: trimmed }),
    })
  }

  async function handleDelete() {
    onDelete()
    await fetch(`/api/tasks/${taskId}/checklists?id=${item.id}`, { method: "DELETE" })
  }

  return (
    <div className="group flex items-center gap-2 rounded-md p-2 hover:bg-muted">
      <Checkbox
        checked={item.done}
        onCheckedChange={(checked) => onToggle(checked === true)}
      />
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename()
            if (e.key === "Escape") { setEditing(false); setDraft(item.name) }
          }}
          className="h-7 text-sm flex-1"
        />
      ) : (
        <span
          className={`text-sm flex-1 cursor-pointer ${item.done ? "line-through text-muted-foreground" : ""}`}
          onClick={() => { setDraft(item.name); setEditing(true) }}
        >
          {item.name}
        </span>
      )}
      <button
        onClick={handleDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
        aria-label="항목 삭제"
      >
        <HugeiconsIcon icon={Delete02Icon} size={13} />
      </button>
    </div>
  )
}
