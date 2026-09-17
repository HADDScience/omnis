"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Invoice01Icon, PackageIcon, CloudUploadIcon, MoneyReceive02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * 「새로 만들기」 하나로 CRM 의 모든 일을 시작한다.
 *
 * 예전에는 견적 화면에만 「새 견적」이 있어서, 샘플요청은 만들 방법이 아예 없었다.
 * 같은 자리에서 시작하는 일이므로 입구도 같아야 한다 — 화면을 먼저 찾아
 * 들어간 다음에야 만들 수 있으면, 어디로 가야 하는지를 사람이 외워야 한다.
 *
 * 세금계산서 등록 · 입금 확인도 여기로 모은다(2026-09-17). 순서는 일이 흘러가는 순서다:
 * 샘플 → 견적 → 세금계산서 → 입금. 메뉴를 읽는 것만으로 다음에 무엇이 오는지 보인다.
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
        <DropdownMenuItem render={<Link href="/crm/samples/new" />} className="gap-2">
          <HugeiconsIcon icon={PackageIcon} size={15} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">샘플요청</div>
            <div className="text-[11px] text-muted-foreground">요청 내용과 소개경로를 담는다</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/crm/quotes/new" />} className="gap-2">
          <HugeiconsIcon icon={Invoice01Icon} size={15} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">견적</div>
            <div className="text-[11px] text-muted-foreground">품목과 금액을 담는다</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/crm/invoices/new" />} className="gap-2">
          <HugeiconsIcon icon={CloudUploadIcon} size={15} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">세금계산서 등록</div>
            <div className="text-[11px] text-muted-foreground">홈택스 엑셀 · PDF 를 올린다</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/crm/payments/new" />} className="gap-2">
          <HugeiconsIcon icon={MoneyReceive02Icon} size={15} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">입금 확인</div>
            <div className="text-[11px] text-muted-foreground">들어온 돈을 세금계산서에 짝짓는다</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
