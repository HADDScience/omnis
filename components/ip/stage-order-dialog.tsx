"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ip/ip-dialog"
import { StatusBadge } from "@/components/ip/status-badge"

/**
 * 단계 정렬 순서 고치기.
 *
 * 다른 열은 오름차순·내림차순이면 뜻이 분명한데 단계는 그렇지 않다. 글자순으로
 * 세우면 「검토의견 → 등록 → 출원」처럼 일의 흐름과 무관한 차례가 된다. 그래서
 * 파이프라인 순서를 기본으로 두되, 먼저 보고 싶은 단계는 사람마다 다르므로
 * 각자 바꿔 쓰게 한다. 이 순서는 계정에 저장돼 어느 기기에서나 같다.
 */
export function StageOrderDialog({
  open,
  onOpenChange,
  stages,
  value,
  onSave,
  description = "단계 열로 정렬할 때 쓸 차례입니다. 위에 있을수록 먼저 옵니다. 이 순서는 본인에게만 적용됩니다.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 기본 순서대로 들어온 전체 단계 — 「기본 순서로」가 이 차례로 되돌린다 */
  stages: string[]
  /** 지금 저장돼 있는 개인 순서 */
  value: string[]
  onSave: (next: string[]) => Promise<void>
  description?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[26rem]">
        <DialogHeader className="pr-10">
          <DialogTitle>단계 정렬 순서</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/*
          열려 있을 때만 그린다. 그래야 닫았다 다시 열 때 새로 마운트되어
          저장된 값으로 되돌아온다 — 효과로 되돌리면 렌더가 한 번 더 돈다.
        */}
        {open ? (
          <Reorder
            stages={stages}
            value={value}
            onSave={onSave}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Reorder({
  stages,
  value,
  onSave,
  onDone,
}: {
  stages: string[]
  value: string[]
  onSave: (next: string[]) => Promise<void>
  onDone: () => void
}) {
  const [items, setItems] = useState<string[]>(() => {
    // 저장된 순서를 앞에 두고, 그 사이 새로 생긴 단계는 뒤에 붙인다.
    const known = value.filter((v) => stages.includes(v))
    return [...known, ...stages.filter((s) => !known.includes(s))]
  })
  const [busy, setBusy] = useState(false)

  function move(index: number, delta: number) {
    setItems((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <ul className="flex flex-col divide-y divide-border/60">
          {items.map((stage, i) => (
            <li key={stage} className="flex items-center gap-2 py-1.5">
              <span className="w-5 shrink-0 text-right text-[11.5px] text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <StatusBadge status={stage} />
              <div className="ml-auto flex shrink-0 gap-0.5">
                <button
                  type="button"
                  aria-label={`${stage} 위로`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                </button>
                <button
                  type="button"
                  aria-label={`${stage} 아래로`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                  className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 p-4">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(items)
              onDone()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "저장 중…" : "저장"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setItems(stages)}
        >
          기본 순서로
        </Button>
      </div>
    </>
  )
}
