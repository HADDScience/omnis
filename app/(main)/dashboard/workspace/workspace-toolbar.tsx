"use client"

import { useState } from "react"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  FilterIcon,
  MagnetIcon,
  Link04Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type GroupMode = "product" | "project" | "status" | "owner"

interface ToolbarProps {
  groupMode: GroupMode
  onGroupChange: (m: GroupMode) => void
  autoArrange: boolean
  onToggleAutoArrange: () => void
  haddLinkMode: boolean
  onToggleHaddLink: () => void
  stats: { totalNodes: number; overdueCount: number; inProgressCount: number }
  onReset?: () => void
}

export function WorkspaceToolbar({
  groupMode,
  onGroupChange,
  autoArrange,
  onToggleAutoArrange,
  haddLinkMode,
  onToggleHaddLink,
  stats,
  onReset,
}: ToolbarProps) {
  const { zoomIn, zoomOut, setViewport } = useReactFlow()
  const [zoom, setZoom] = useState(100)

  const groups: { key: GroupMode; label: string }[] = [
    { key: "product", label: "제품별" },
    { key: "project", label: "프로젝트별" },
    { key: "status", label: "상태별" },
    { key: "owner", label: "담당자별" },
  ]

  return (
    <div
      className="absolute left-0 right-0 top-0 z-20 flex h-10 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 그룹핑 탭 */}
      <div className="flex items-center gap-0.5 rounded-md border bg-muted/50 p-0.5">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => onGroupChange(g.key)}
            className={cn(
              "rounded-sm px-2 py-0.5 text-[11px] font-medium transition-colors",
              groupMode === g.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border" />

      {/*
        규칙 12 (omnis/CLAUDE.md): 빈 onClick 금지. 미구현 UI는 disabled + Tooltip.
        필터/자동정렬/HADD 카드 연결은 핸들러가 canvas에 연결되지 않은 상태(상태만 토글).
        Phase 4에서 사용 로그 검증 후 활용/제거 결정.
      */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" disabled />
            }
          >
            <HugeiconsIcon icon={FilterIcon} size={11} />
            필터
          </TooltipTrigger>
          <TooltipContent>곧 제공 예정</TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border" />

        {/* 모드 토글 — 비활성 상태 */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={autoArrange ? "default" : "outline"}
                size="sm"
                className="h-7 gap-1 text-[11px]"
                onClick={onToggleAutoArrange}
                disabled
              />
            }
          >
            <HugeiconsIcon icon={MagnetIcon} size={11} />
            자동 정렬
          </TooltipTrigger>
          <TooltipContent>곧 제공 예정</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={haddLinkMode ? "default" : "outline"}
                size="sm"
                className="h-7 gap-1 text-[11px]"
                onClick={onToggleHaddLink}
                disabled
              />
            }
          >
            <HugeiconsIcon icon={Link04Icon} size={11} />
            HADD 카드 연결
          </TooltipTrigger>
          <TooltipContent>곧 제공 예정</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div className="flex-1" />

      {/* 통계 뱃지 */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {stats.totalNodes}
          <span className="ml-0.5">노드</span>
        </span>
        {stats.overdueCount > 0 && (
          <span className="text-destructive">
            · {stats.overdueCount}
            <span className="ml-0.5">지연</span>
          </span>
        )}
        {stats.inProgressCount > 0 && (
          <span>
            · {stats.inProgressCount}
            <span className="ml-0.5">진행</span>
          </span>
        )}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* 줌 컨트롤 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            zoomOut()
            setZoom((z) => Math.max(20, z - 10))
          }}
          title="축소"
        >
          <HugeiconsIcon icon={ZoomOutAreaIcon} size={11} />
        </Button>
        <button
          type="button"
          className="rounded border px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
          onClick={() => {
            setViewport({ x: 0, y: 0, zoom: 1 })
            setZoom(100)
          }}
        >
          {zoom}%
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            zoomIn()
            setZoom((z) => Math.min(200, z + 10))
          }}
          title="확대"
        >
          <HugeiconsIcon icon={ZoomInAreaIcon} size={11} />
        </Button>
        {onReset && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 h-6 w-6"
            onClick={onReset}
            title="초기화"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={11} />
          </Button>
        )}
      </div>
    </div>
  )
}
