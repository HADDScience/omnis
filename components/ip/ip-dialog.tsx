"use client"

import type { ComponentProps } from "react"

import {
  Dialog,
  DialogClose,
  DialogContent as BaseContent,
  DialogDescription,
  DialogFooter,
  DialogHeader as BaseHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * 옴니스 Dialog 위에 IP 창의 배치만 얹는다.
 *
 * IP 창(기록하기 · 메일 · 값 정정)은 본문이 길어 창 안에서 스크롤해야 한다. 옴니스
 * 기본 창은 grid + p-6 + 폭 sm:max-w-md 라 그대로 쓰면 좁고 넘친다. 모양(둥근 판 ·
 * 그림자 · 닫기 단추)은 옴니스 것을 쓰고, 높이 제한 · 세로 흐름 · 폭만 여기서 정한다.
 * 폭은 쓰는 쪽이 `sm:max-w-[…]` 로 덮는다.
 */
function DialogContent({ className, ...props }: ComponentProps<typeof BaseContent>) {
  return (
    <BaseContent
      className={cn(
        "flex max-h-[min(90svh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[38rem]",
        className
      )}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: ComponentProps<typeof BaseHeader>) {
  return <BaseHeader className={cn("gap-1 p-4 pr-12 pb-3", className)} {...props} />
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
