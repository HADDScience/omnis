"use client"

import { EntityPicker, type PickerOption } from "./entity-picker"
import { Step } from "./step"
import { ORG_TYPE_LABEL } from "@/lib/crm"
import type { CrmOrgType } from "@/generated/prisma"
import { cn } from "@/lib/utils"
import type { useRecipient } from "./use-recipient"

type Recipient = ReturnType<typeof useRecipient>

/** 「어느 기관인가요?」 + 「담당자는 누구인가요?」 두 칸. 견적·샘플이 똑같이 쓴다. */
export function RecipientSteps({
  r,
  onOrgPicked,
  contactOptional = true,
}: {
  r: Recipient
  onOrgPicked?: (orgId: string | null) => void
  /** 견적은 담당자를 건너뛸 수 있다. 샘플은 보낼 사람이 있어야 하므로 막을 수도 있다. */
  contactOptional?: boolean
}) {
  const orgOptions: PickerOption[] = r.orgs.map((o) => ({ id: o.id, label: o.name }))
  const contactOptions: PickerOption[] = (r.org?.contacts ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    hint: c.title,
  }))

  return (
    <>
      <Step label="어느 기관인가요?">
        <EntityPicker
          options={orgOptions}
          value={r.orgId}
          onChange={(id) => {
            r.pickOrg(id)
            onOrgPicked?.(id)
          }}
          placeholder="기관 이름으로 찾기"
          emptyLabel="기관을 고르세요"
          onCreate={(name) => r.createOrg(name, (o) => onOrgPicked?.(o?.id ?? null))}
          createLabel="기관으로 새로 만들기"
          disabled={r.busy}
        />
        {r.justCreatedOrgId === r.orgId && r.org && (
          <div className="mt-2 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              새 기관이라 유형이 비어 있어요. 골라 두면 목록에서 분류됩니다.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(ORG_TYPE_LABEL) as CrmOrgType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => r.setOrgType(t)}
                  aria-pressed={r.org!.type === t}
                  className={cn(
                    "inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] transition-colors",
                    r.org!.type === t
                      ? "border-primary/30 bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {ORG_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        )}
      </Step>

      <Step
        show={Boolean(r.orgId)}
        autoFocus
        label="담당자는 누구인가요?"
        hint={
          contactOptional && !r.contactId && !r.contactSkipped ? (
            <button
              type="button"
              onClick={() => r.setContactSkipped(true)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              모르면 건너뛰기
            </button>
          ) : null
        }
      >
        <EntityPicker
          options={contactOptions}
          value={r.contactId}
          onChange={(id) => {
            r.setContactId(id)
            if (id) r.setContactSkipped(false)
          }}
          placeholder="담당자 이름으로 찾기"
          emptyLabel={r.contactSkipped ? "담당자 없이 진행합니다" : "담당자를 고르세요"}
          onCreate={r.createContact}
          createLabel="담당자로 새로 만들기"
          disabled={r.busy}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          직함은 따로 저장돼요. 「김광민 교수님」처럼 붙여 쓰지 않아도 됩니다.
        </p>
      </Step>
    </>
  )
}
