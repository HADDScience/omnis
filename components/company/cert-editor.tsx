"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  InlineField,
  useFieldSaver,
  type EditorProps,
} from "@/components/grants/inline-field"
import { CERT_STATUSES, CERT_STATUS_LABEL, seoulYmd } from "@/lib/grants-labels"
import { sameText } from "@/lib/inline-field"
import type { CertStatus } from "@/generated/prisma/client"

type Editable = {
  id: string
  name: string
  status: CertStatus
  note: string | null
  acquiredOn: Date | string | null
  validUntil: Date | string | null
}

/**
 * 인증 한 줄의 고칠 수 있는 칸 — 상태 · 취득일 · 유효기간 · 메모. 펼친 칸의 dl 안에 그 자리에서 고친다.
 * 비어 있으면 조사 원문(acquiredHint · validityHint)을 흐리게 보인다.
 */
export function CertFields({
  cert,
  acquiredHint,
  validityHint,
}: {
  cert: Editable
  acquiredHint?: string | null
  validityHint?: string | null
}) {
  const saver = useFieldSaver(`/api/company/certifications/${cert.id}`)
  const hint = (t: string | null | undefined) =>
    t ? <span className="text-muted-foreground">{t}</span> : null
  return (
    <>
      <InlineField<CertStatus>
        label="상태"
        value={cert.status}
        display={(v) => CERT_STATUS_LABEL[v]}
        save={saver("status")}
        editor={({ draft, commit, bind }) => (
          <NativeSelect
            {...bind()}
            size="sm"
            className="w-full sm:w-48"
            value={draft}
            onChange={(e) => commit(e.target.value as CertStatus)}
          >
            {CERT_STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {CERT_STATUS_LABEL[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      />
      <InlineField<string>
        label="취득일"
        value={seoulYmd(cert.acquiredOn) ?? ""}
        display={(v) => v || hint(acquiredHint)}
        save={saver("acquiredOn")}
        editor={(p) => <DateEditor {...p} />}
      />
      <InlineField<string>
        label="유효기간"
        value={seoulYmd(cert.validUntil) ?? ""}
        display={(v) => (v ? `${v} 까지` : hint(validityHint))}
        save={saver("validUntil")}
        editor={(p) => <DateEditor {...p} />}
      />
      <InlineField<string>
        label="메모"
        value={cert.note ?? ""}
        equals={sameText}
        display={(v) => v.trim() || null}
        save={saver("note")}
        editor={({ draft, setDraft, bind }) => (
          <Textarea
            {...bind({ multiline: true })}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-16 text-[12px] md:text-[12px]"
          />
        )}
      />
    </>
  )
}

function DateEditor({ draft, setDraft, bind }: EditorProps<string>) {
  return (
    <Input
      {...bind()}
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="h-8 w-full text-[12px] sm:w-48 md:text-[12px]"
    />
  )
}
