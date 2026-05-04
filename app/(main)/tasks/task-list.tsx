"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon, Delete02Icon, Menu01Icon, GridTableIcon, CheckmarkSquare01Icon } from "@hugeicons/core-free-icons"
import { Checkbox } from "@/components/ui/checkbox"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/constants"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PriorityRating } from "@/components/ui/priority-rating"
import { TaskCreateButton } from "@/components/chat/task-create-button"

interface Checklist {
  id: string
  name: string
  done: boolean
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
  project: { id: string; name: string } | null
  checklists: Checklist[]
  createdAt: string
}

interface Project {
  id: string
  name: string
  status: string
}

interface TaskListProps {
  tasks: Task[]
  projects: Project[]
  tableOnly?: boolean
}

export function TaskList({ tasks, projects, tableOnly }: TaskListProps) {
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<"list" | "table">(tableOnly ? "table" : "list")

  const query = search.toLowerCase()

  const projectGroups = projects
    .filter((p) => !query || p.name.toLowerCase().includes(query) || tasks.some((t) => t.project?.id === p.id && t.name.toLowerCase().includes(query)))
    .map((p) => ({
      ...p,
      tasks: tasks.filter((t) => t.project?.id === p.id && (!query || p.name.toLowerCase().includes(query) || t.name.toLowerCase().includes(query))),
    }))
    .filter((g) => g.tasks.length > 0)

  const unlinkedTasks = tasks.filter((t) => !t.project && (!query || t.name.toLowerCase().includes(query)))

  const totalShown = projectGroups.reduce((s, g) => s + g.tasks.length, 0) + unlinkedTasks.length

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <HugeiconsIcon icon={Search01Icon} size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="프로젝트 또는 업무 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {!tableOnly && (
          <div className="flex items-center border rounded-md">
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-l-md transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              aria-label="리스트 뷰"
            >
              <HugeiconsIcon icon={Menu01Icon} size={16} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-2 rounded-r-md transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              aria-label="테이블 뷰"
            >
              <HugeiconsIcon icon={GridTableIcon} size={16} />
            </button>
          </div>
        )}
        {!tableOnly && <TaskCreateButton />}
      </div>

      <span className="text-xs text-muted-foreground">{totalShown}건</span>

      {totalShown === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {search ? `"${search}" 검색 결과가 없습니다.` : "업무가 없습니다."}
        </p>
      ) : viewMode === "list" ? (
        <Accordion multiple defaultValue={projectGroups.slice(0, 3).map((_, i) => i)}>
          {projectGroups.map((group) => {
            const doneCount = group.tasks.filter((t) => t.status === "DONE").length
            return (
              <AccordionItem key={group.id} value={group.id}>
                <AccordionTrigger className="text-sm py-3 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{group.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{group.tasks.length}</Badge>
                    {doneCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">{doneCount} 완료</span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-2 pb-2">
                    {group.tasks.map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}

          {unlinkedTasks.length > 0 && (
            <AccordionItem value="unlinked">
              <AccordionTrigger className="text-sm py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <span className="font-medium">미배정 업무</span>
                  <Badge variant="secondary" className="text-[10px]">{unlinkedTasks.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-2 pb-2">
                  {unlinkedTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      ) : (
        <TaskTable
          tasks={[...projectGroups.flatMap((g) => g.tasks), ...unlinkedTasks]}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
        />
      )}
    </div>
  )
}

function TaskTable({
  tasks,
  globalFilter,
  onGlobalFilterChange,
}: {
  tasks: Task[]
  globalFilter: string
  onGlobalFilterChange: (v: string) => void
}) {
  const router = useRouter()
  const [sorting, setSorting] = useState<SortingState>([])
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)

  async function handleBulkStatus(status: string) {
    if (selectedIds.size === 0) return
    setBulkUpdating(true)
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map((id) =>
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    ))
    setSelectedIds(new Set())
    setBulkUpdating(false)
    router.refresh()
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const visible = tasks.filter((t) => !deletingIds.has(t.id))
    if (selectedIds.size === visible.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(visible.map((t) => t.id)))
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`${selectedIds.size}개 업무를 삭제하시겠습니까?`)) return
    setBulkDeleting(true)
    const ids = Array.from(selectedIds)
    setDeletingIds((prev) => { const s = new Set(prev); ids.forEach((id) => s.add(id)); return s })
    await Promise.all(ids.map((id) => fetch(`/api/tasks/${id}`, { method: "DELETE" })))
    setSelectedIds(new Set())
    setBulkDeleting(false)
    router.refresh()
  }

  async function handleDelete(e: React.MouseEvent, task: Task) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`"${task.name}" 업무를 삭제하시겠습니까?`)) return
    setDeletingIds((prev) => new Set(prev).add(task.id))
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
    else setDeletingIds((prev) => { const s = new Set(prev); s.delete(task.id); return s })
  }

  const columns: ColumnDef<Task>[] = useMemo(() => [
    {
      id: "select",
      header: () => (
        <Checkbox
          checked={selectedIds.size > 0 && selectedIds.size === tasks.filter((t) => !deletingIds.has(t.id)).length}
          onCheckedChange={toggleSelectAll}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.has(row.original.id)}
          onCheckedChange={() => toggleSelect(row.original.id)}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        />
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          상태{column.getIsSorted() === "asc" ? " ↑" : column.getIsSorted() === "desc" ? " ↓" : ""}
        </button>
      ),
      cell: ({ row }) => (
        <Badge variant="secondary" className={`text-[10px] whitespace-nowrap ${TASK_STATUS_COLORS[row.original.status] ?? ""}`}>
          {TASK_STATUS_LABELS[row.original.status] ?? row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          업무명{column.getIsSorted() === "asc" ? " ↑" : column.getIsSorted() === "desc" ? " ↓" : ""}
        </button>
      ),
      cell: ({ row }) => (
        <Link href={`/tasks/${row.original.id}`} className="hover:underline font-medium truncate max-w-[200px] block">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: "project",
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          프로젝트{column.getIsSorted() === "asc" ? " ↑" : column.getIsSorted() === "desc" ? " ↓" : ""}
        </button>
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.project?.name ?? "—"}</span>
      ),
      sortingFn: (a, b) => (a.original.project?.name ?? "").localeCompare(b.original.project?.name ?? ""),
    },
    {
      accessorKey: "owner",
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          담당자{column.getIsSorted() === "asc" ? " ↑" : column.getIsSorted() === "desc" ? " ↓" : ""}
        </button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[9px]">{row.original.owner.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <span>{row.original.owner.name}</span>
        </div>
      ),
      sortingFn: (a, b) => a.original.owner.name.localeCompare(b.original.owner.name),
    },
    {
      accessorKey: "priority",
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          우선순위{column.getIsSorted() === "asc" ? " ↑" : column.getIsSorted() === "desc" ? " ↓" : ""}
        </button>
      ),
      cell: ({ row }) => (
        <PriorityRating value={row.original.priority} disabled size={14} />
      ),
    },
    {
      id: "checklists",
      header: "체크리스트",
      cell: ({ row }) => {
        const done = row.original.checklists.filter((c) => c.done).length
        const total = row.original.checklists.length
        return total > 0
          ? <span className="text-muted-foreground">{done}/{total}</span>
          : <span className="text-muted-foreground">—</span>
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={(e) => handleDelete(e, row.original)}
          className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
          aria-label="업무 삭제"
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </button>
      ),
    },
  ], [deletingIds])

  const filteredTasks = useMemo(
    () => tasks.filter((t) => !deletingIds.has(t.id)),
    [tasks, deletingIds]
  )

  const table = useReactTable({
    data: filteredTasks,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  })

  return (
    <div className="flex flex-col gap-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">{selectedIds.size}개 선택</span>
          <Select onValueChange={(v: string | null) => { if (v) handleBulkStatus(v) }} disabled={bulkUpdating}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue placeholder="상태 변경">
                {bulkUpdating ? "변경 중..." : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TASK_STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5 text-xs h-7"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
          >
            <HugeiconsIcon icon={Delete02Icon} size={13} />
            {bulkDeleting ? "삭제 중..." : "일괄 삭제"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => setSelectedIds(new Set())}
          >
            선택 해제
          </Button>
        </div>
      )}
      <div className="overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b bg-muted/30">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="text-xs px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b hover:bg-muted/50 cursor-pointer group/row transition-colors"
                onClick={(e) => {
                  const target = e.target as HTMLElement
                  if (target.closest("[data-slot=checkbox]") || target.closest("button")) return
                  router.push(`/tasks/${row.original.id}`)
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="h-16 text-center text-sm text-muted-foreground">
                검색 결과 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const doneCount = task.checklists.filter((c) => c.done).length
  const totalCount = task.checklists.length

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`"${task.name}" 업무를 삭제하시겠습니까?`)) return
    setDeleting(true)
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
    else setDeleting(false)
  }

  if (deleting) return null

  return (
    <Link href={`/tasks/${task.id}`}>
      <Card className="group hover:border-primary/30 transition-colors cursor-pointer">
        <CardHeader className="py-3 pb-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="secondary" className={`shrink-0 text-[10px] ${TASK_STATUS_COLORS[task.status] ?? ""}`}>
                {TASK_STATUS_LABELS[task.status] ?? task.status}
              </Badge>
              <CardTitle className="text-sm font-normal truncate">{task.name}</CardTitle>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {totalCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{doneCount}/{totalCount}</span>
              )}
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[10px]">{task.owner.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <button
                onClick={handleDelete}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                aria-label="업무 삭제"
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} />
              </button>
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  )
}
