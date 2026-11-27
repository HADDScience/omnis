"use client"

// 공고 가점표의 「우리 상태」 칸 — 상태가 없음인 항목을 누르면 인증 탭으로 잇는다(2026-11-28).
// 우리 인증이 아직 없으면 「인증 탭 후보로 올리기」, 있으면(후보 · 중단 등) 「인증 탭에서 보기」.
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { send } from "@/components/grants/send"
import { OUR_STATE_LABEL, type OurState } from "@/lib/grant-bonus"
import { cn } from "@/lib/utils"

export function BonusCertState({
  state,
  chip,
  label,
  certId,
  source,
}: {
  state: OurState
  chip: string
  /** 공고의 가점 항목 이름 — 후보 이름이 된다 */
  label: string
  certId: string | null
  /** 어느 공고에서 올렸나 */
  source: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const pill = <span className={cn("rounded-full px-1.5 py-px text-[11px] font-medium", chip)}>{OUR_STATE_LABEL[state]}</span>
  if (state !== "none") return pill

  async function addCandidate() {
    setBusy(true)
    try {
      const r = await send<{ id: string; name: string; existed: boolean }>("/api/company/certifications", "POST", {
        name: label,
        source: source ? `공고 가점표: ${source}` : "공고 가점표",
      })
      toast.success(r.existed ? `이미 있는 인증입니다 · ${r.name}` : `인증 탭 후보로 올렸습니다 · ${r.name}`, {
        action: { label: "열기", onClick: () => router.push(`/omnis/certs?cert=${r.id}`) },
      })
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "올리지 못했습니다")
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label} — 우리 상태 없음, 인증 탭으로`}
        disabled={busy}
        data-grant-bonus-cert-menu
        className="touch-hit inline-flex cursor-pointer items-center rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {pill}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {certId ? (
          <DropdownMenuItem render={<Link href={`/omnis/certs?cert=${certId}`} />}>인증 탭에서 보기</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={addCandidate}>인증 탭 후보로 올리기</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
