"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

type OrgRef = { id: string; name: string; bizRegNo: string | null }

/**
 * 세금계산서를 받는 곳. 비어 있으면 이 기관 자신이다.
 * 다른 기관의 청구처인 기관(산학협력단)에는 고르는 칸 대신 그 기관들을 보여 준다 — 청구처는 한 단계만이다.
 */
export function BillingOrgField({
  orgId,
  billingOrg,
  billedOrgs,
  candidates,
}: {
  orgId: string
  billingOrg: OrgRef | null
  billedOrgs: OrgRef[]
  /** 고를 수 있는 기관 — 자기 자신과, 이미 청구처를 따로 둔 기관은 서버가 뺐다 */
  candidates: OrgRef[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  if (billedOrgs.length > 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        세금계산서를 대신 받는 기관:{" "}
        {billedOrgs.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ", "}
            <Link href={`/crm/orgs/${o.id}`} className="text-foreground underline-offset-2 hover:underline">
              {o.name}
            </Link>
          </span>
        ))}
      </p>
    )
  }

  const save = (billingOrgId: string | null) =>
    start(async () => {
      const res = await fetch(apiUrl(`/api/crm/orgs/${orgId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingOrgId }),
      }).catch(() => null)
      if (!res?.ok) {
        const msg = await res?.json().then((j) => j.error as string).catch(() => null)
        toast.error(msg ?? "청구처를 바꾸지 못했습니다")
        return
      }
      toast.success(billingOrgId ? "청구처를 정했어요" : "청구처를 이 기관으로 되돌렸어요")
      router.refresh()
    })

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <label htmlFor="billing-org" className="text-muted-foreground">
        세금계산서 받는 곳
      </label>
      <NativeSelect
        id="billing-org"
        size="sm"
        className="touch-target min-w-0 max-w-full"
        value={billingOrg?.id ?? ""}
        disabled={pending}
        onChange={(e) => save(e.target.value || null)}
      >
        <NativeSelectOption value="">이 기관 (따로 없음)</NativeSelectOption>
        {candidates.map((o) => (
          <NativeSelectOption key={o.id} value={o.id}>
            {o.name}
            {o.bizRegNo ? ` · ${o.bizRegNo}` : ""}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {pending && <Spinner className="h-3.5 w-3.5" />}
      {billingOrg && !billingOrg.bizRegNo && (
        <span className="text-amber-700 dark:text-amber-400">청구처에 사업자번호가 없습니다</span>
      )}
    </div>
  )
}
