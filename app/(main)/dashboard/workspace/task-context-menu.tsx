"use client"

import { useState, useEffect, useCallback } from "react"
import type {
  WorkspaceProduct,
  WorkspaceCategory,
  WorkspaceProject,
  TaskBadgeNodeData,
} from "@/lib/workspace-types"

interface TaskContextMenuProps {
  x: number
  y: number
  task: TaskBadgeNodeData
  products: WorkspaceProduct[]
  categories: WorkspaceCategory[]
  projects: WorkspaceProject[]
  onClose: () => void
  onSave: (taskId: string, updates: { categoryId?: string; projectId?: string }) => void
}

export function TaskContextMenu({
  x,
  y,
  task,
  products,
  categories,
  projects,
  onClose,
  onSave,
}: TaskContextMenuProps) {
  const [categoryId, setCategoryId] = useState(task.categoryId ?? "")
  const [projectId, setProjectId] = useState(task.projectId ?? "")
  const [saving, setSaving] = useState(false)

  // 선택된 프로젝트의 제품으로 필터링된 프로젝트 목록
  const productProjects = projectId
    ? projects
    : projects

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest("[data-context-menu]")) onClose()
    }
    window.addEventListener("keydown", handleEsc)
    window.addEventListener("mousedown", handleClick)
    return () => {
      window.removeEventListener("keydown", handleEsc)
      window.removeEventListener("mousedown", handleClick)
    }
  }, [onClose])

  const handleSave = useCallback(async () => {
    setSaving(true)
    const updates: { categoryId?: string; projectId?: string } = {}
    if (categoryId && categoryId !== task.categoryId) updates.categoryId = categoryId
    if (projectId !== (task.projectId ?? "")) updates.projectId = projectId || undefined
    if (Object.keys(updates).length > 0) {
      onSave(task.taskId, updates)
    }
    onClose()
  }, [categoryId, projectId, task, onSave, onClose])

  // 제품 변경 = 프로젝트 변경으로 처리 (프로젝트가 제품에 연결됨)
  const selectedProject = projects.find((p) => p.id === projectId)
  const currentProductId = selectedProject?.productId ?? null

  return (
    <div
      data-context-menu
      className="fixed z-50 w-[260px] rounded-xl border bg-background/95 p-3 shadow-2xl backdrop-blur-md"
      style={{ left: x, top: y }}
    >
      <div className="mb-2 truncate text-xs font-bold">{task.name}</div>
      <div className="mb-3 text-[10px] text-muted-foreground">
        {task.ownerName}
      </div>

      {/* 카테고리 */}
      <div className="mb-2">
        <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">
          카테고리
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">미배정</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ` : ""}{c.name}
            </option>
          ))}
        </select>
      </div>

      {/* 프로젝트 (제품 연결) */}
      <div className="mb-2">
        <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">
          프로젝트 <span className="font-normal">(→ 제품 연결)</span>
        </label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">미배정</option>
          {productProjects.map((p) => {
            const prod = products.find((pr) => pr.id === p.productId)
            return (
              <option key={p.id} value={p.id}>
                {prod ? `[${prod.name}] ` : ""}{p.name}
              </option>
            )
          })}
        </select>
      </div>

      {/* 현재 제품 표시 */}
      {currentProductId && (
        <div className="mb-3 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <div
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                products.find((p) => p.id === currentProductId)?.color ?? "#9ca3af",
            }}
          />
          <span className="text-[10px] text-muted-foreground">
            제품: {products.find((p) => p.id === currentProductId)?.name ?? "없음"}
          </span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-md border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          취소
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  )
}
