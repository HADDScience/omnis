"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  Folder01Icon,
  CubeIcon,
  Task01Icon,
  ArrowRight01Icon,
  MessageMultiple01Icon,
  BookOpen01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"

export interface InspectorData {
  id: string
  type: "productRoom" | "projectCard" | "task" | string
  title: string
  subtitle?: string
  slug?: string
  statusLabel?: string
  isOverdue?: boolean
  ownerName?: string | null
  ownerInitial?: string | null
  deadline?: string | null
  deadlineLabel?: string | null
  linkedCards?: { id: string; title: string; checked: boolean }[]
  activeTaskCount?: number
  tasks?: { id: string; name: string; status: string; ownerName?: string | null; slug?: string }[]
  color?: string
}

interface InspectorPanelProps {
  data: InspectorData | null
  dockOpen: boolean
  onClose: () => void
}

export function InspectorPanel({ data, dockOpen, onClose }: InspectorPanelProps) {
  const router = useRouter()
  if (!data) return null
  const width = dockOpen ? "w-48" : "w-[260px]"
  const icon =
    data.type === "productRoom" ? CubeIcon : data.type === "projectCard" ? Folder01Icon : Task01Icon

  const isTask = data.type === "task"
  const showMetaRow = isTask && (data.isOverdue || data.slug || data.statusLabel)

  const handleOpenDetail = () => {
    if (!isTask) return
    router.push(`/tasks/${data.id}`)
  }
  const handleOpenThread = () => {
    if (!isTask) return
    router.push(`/tasks/${data.id}?thread=1`)
  }

  return (
    <aside
      className={cn(
        "absolute right-2 top-12 bottom-2 z-20 flex flex-col overflow-hidden rounded-lg border bg-card shadow-[0_10px_30px_-10px_oklch(0_0_0/.35)] transition-[width] duration-200 ease-out",
        width,
      )}
    >
      {/* 헤더: 타이틀 + 닫기 */}
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2.5",
          dockOpen && "gap-1.5 px-2 py-2",
        )}
      >
        <HugeiconsIcon icon={icon} size={13} className="text-muted-foreground" />
        <span
          className={cn(
            "truncate font-semibold text-[12.5px]",
            dockOpen && "text-[11.5px]",
          )}
        >
          {data.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="닫기"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} />
        </button>
      </div>

      {/* 상태 뱃지 행 (단일 태스크일 때) */}
      {showMetaRow && (
        <div
          className={cn(
            "flex items-center gap-1.5 border-b px-3 pt-2.5 pb-2",
            dockOpen && "gap-1 px-2 pt-2 pb-1.5",
          )}
        >
          {data.isOverdue && (
            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
              지연
            </Badge>
          )}
          {data.slug && !dockOpen && (
            <span className="font-mono text-[10.5px] text-muted-foreground">#{data.slug}</span>
          )}
          {data.statusLabel && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {data.statusLabel}
            </Badge>
          )}
        </div>
      )}

      {/* 본문 */}
      <div className={cn("flex-1 overflow-y-auto p-3", dockOpen && "p-2")}>
        {/* 담당자 pill (task 노드) */}
        {isTask && data.ownerName && (
          <div className={cn("mb-2 flex items-center gap-2", dockOpen && "mb-1.5")}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              담당자
            </span>
            <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
              <Avatar className="size-4">
                <AvatarFallback className="bg-primary/10 text-[9px] text-primary">
                  {data.ownerInitial ?? data.ownerName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="text-[11px] font-medium">{data.ownerName}</span>
            </div>
          </div>
        )}

        {/* 마감 라인 (task 노드) */}
        {isTask && data.deadlineLabel && (
          <div className={cn("mb-2 flex items-center gap-2", dockOpen && "mb-1.5")}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              마감
            </span>
            <span
              className={cn(
                "text-[11.5px] font-semibold",
                data.isOverdue ||
                  data.deadlineLabel === "오늘" ||
                  data.deadlineLabel === "D-0" ||
                  data.deadlineLabel?.endsWith("지연")
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              {data.deadlineLabel}
            </span>
          </div>
        )}

        {data.subtitle && !isTask && (
          <div
            className={cn(
              "mb-2 line-clamp-2 text-[11px] text-muted-foreground",
              dockOpen && "mb-1.5 text-[10.5px]",
            )}
          >
            {data.subtitle}
          </div>
        )}

        {data.activeTaskCount !== undefined && (
          <div className={cn("mb-3 flex items-center gap-1.5", dockOpen && "mb-2")}>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              진행 중 · {data.activeTaskCount}
            </Badge>
          </div>
        )}

        {data.tasks && data.tasks.length > 0 && (
          <>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              업무
            </div>
            <ul className="flex flex-col gap-1">
              {data.tasks.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="group/inspect block rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="line-clamp-1 flex-1 text-[11.5px] font-medium leading-snug">
                        {t.name}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {dockOpen
                        ? (t.ownerName ?? "—")
                        : `${t.ownerName ?? "—"}${t.slug ? ` · #${t.slug}` : ""}`}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* 연결된 HADD 카드 (task 노드) */}
        {isTask && data.linkedCards && data.linkedCards.length > 0 && (
          <div className="pt-1">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              연결된 HADD 카드
            </div>
            <ul className="flex flex-col gap-1">
              {data.linkedCards.map((card) => (
                <li
                  key={card.id}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                >
                  <Checkbox checked={card.checked} disabled className="size-3" />
                  <HugeiconsIcon
                    icon={BookOpen01Icon}
                    size={11}
                    className="text-muted-foreground"
                  />
                  <Link
                    href={`/omnis/${card.id}`}
                    className="flex-1 truncate text-[11px] hover:underline"
                  >
                    {card.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isTask && (!data.tasks || data.tasks.length === 0) && (
          <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            표시할 항목이 없습니다.
          </div>
        )}
      </div>

      {/* CTA 버튼 영역 */}
      <div
        className={cn(
          "grid grid-cols-2 gap-1.5 border-t px-3 py-2.5",
          dockOpen && "gap-1 px-2 py-2",
        )}
      >
        <Button
          onClick={handleOpenDetail}
          disabled={!isTask}
          size="sm"
          className={cn(
            "h-8 text-[12px]",
            dockOpen && "h-7 px-2 text-[11px]",
          )}
        >
          {isTask ? "상세 열기" : "업무 목록"}
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
        </Button>
        <Button
          onClick={handleOpenThread}
          disabled={!isTask}
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-[12px]",
            dockOpen && "h-7 px-2 text-[11px]",
          )}
        >
          <HugeiconsIcon icon={MessageMultiple01Icon} size={12} />
          스레드
        </Button>
      </div>
    </aside>
  )
}
