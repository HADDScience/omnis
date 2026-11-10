"use client"

import { flushSync } from "react-dom"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { trackUi } from "@/lib/ui-metrics/client"

export interface ComposerPlusSheetItem {
  key: string
  icon: IconSvgElement
  label: string
  hint?: string
  onSelect: () => void
}

/**
 * 폰의 ＋ 메뉴 — 아래에서 올라오는 시트. 손잡이 · 어두운 바탕 누르기 · 아래로 밀기로 닫는다(vaul).
 *
 * 항목은 시트를 닫은 **같은 탭 동작 안에서** 부른다. iOS 는 사용자 동작 안에서만 파일 고르기 창과 키보드를 연다 —
 * 닫힘 애니메이션을 기다렸다 부르면 조용히 무시된다. flushSync 로 먼저 닫아야 시트의 포커스 가두기가 풀려
 * 「사람 언급」 이 입력칸에 포커스를 줄 수 있다.
 */
export function ComposerPlusSheet({
  open,
  onOpenChange,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ComposerPlusSheetItem[]
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        // 여기로 오는 닫힘은 바탕 누르기 · 밀기 · Esc 뿐이다. 항목을 고른 닫힘은 아래에서 바로 부른다
        if (!next) trackUi("plus_dismiss")
        onOpenChange(next)
      }}
      repositionInputs={false}
      noBodyStyles
    >
      <DrawerContent
        data-composer-plus-sheet
        aria-describedby={undefined}
        overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-none"
        // 닫힐 때 ＋ 단추로 포커스를 돌리지 않는다 — 고른 항목이 입력칸에 준 포커스를 뺏는다
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="pb-[calc(var(--safe-bottom)+16px)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
      >
        <DrawerTitle className="sr-only">추가</DrawerTitle>
        <div className="flex flex-col px-2 pt-3">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                trackUi("plus_act")
                flushSync(() => onOpenChange(false))
                item.onSelect()
              }}
              className="flex min-h-[46px] min-w-0 items-center gap-3 rounded-xl px-3 text-left text-[15px] text-foreground active:bg-accent"
            >
              <HugeiconsIcon icon={item.icon} size={20} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-[12.5px] text-muted-foreground">{item.hint}</span>}
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
