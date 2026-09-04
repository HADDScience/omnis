"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Invoice01Icon, PackageIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * 「새로 만들기」 하나로 견적과 샘플요청을 모두 시작한다.
 *
 * 예전에는 견적 화면에만 「새 견적」이 있어서, 샘플요청은 만들 방법이 아예 없었다.
 * 둘은 같은 자리에서 시작하는 일이므로 입구도 같아야 한다 — 화면을 먼저 찾아
 * 들어간 다음에야 만들 수 있으면, 어디로 가야 하는지를 사람이 외워야 한다.
 */
export function NewRecordButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={15} aria-hidden />
            새로 만들기
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuItem render={<Link href="/crm/quotes/new" />} className="gap-2">
          <HugeiconsIcon icon={Invoice01Icon} size={15} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">견적</div>
            <div className="text-[11px] text-muted-foreground">품목과 금액을 담는다</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/crm/samples/new" />} className="gap-2">
          <HugeiconsIcon icon={PackageIcon} size={15} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">샘플요청</div>
            <div className="text-[11px] text-muted-foreground">요청 내용과 소개경로를 담는다</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
