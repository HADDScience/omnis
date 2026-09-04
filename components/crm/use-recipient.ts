"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { CrmOrgType } from "@/generated/prisma"

export interface OrgLite {
  id: string
  name: string
  type: CrmOrgType
  contacts: { id: string; name: string; title: string | null }[]
  membership: { id: string; discountAmount: number } | null
}

/**
 * 「누구에게」를 고르는 상태. 견적과 샘플요청이 똑같이 쓴다.
 *
 * 없는 기관·담당자를 고르는 자리에서 바로 만드는 것이 핵심이다 — 엑셀에서는
 * 마스터 시트에 먼저 등록해야만 드롭다운에 이름이 떴고, 그래서 사람이 등록
 * 순서를 외워야 했다.
 */
export function useRecipient(initialOrgs: OrgLite[]) {
  const [orgs, setOrgs] = useState(initialOrgs)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [contactSkipped, setContactSkipped] = useState(false)
  const [justCreatedOrgId, setJustCreatedOrgId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const org = orgs.find((o) => o.id === orgId) ?? null

  function pickOrg(id: string | null, onPick?: (o: OrgLite | null) => void) {
    setOrgId(id)
    setContactId(null)
    setContactSkipped(false)
    setJustCreatedOrgId((prev) => (prev === id ? prev : null))
    onPick?.(orgs.find((o) => o.id === id) ?? null)
  }

  async function createOrg(name: string, onPick?: (o: OrgLite | null) => void) {
    setBusy(true)
    try {
      const res = await fetch("/api/crm/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "기관을 만들지 못했습니다")
      const created: OrgLite = { ...data, contacts: [], membership: null }
      setOrgs((prev) => [...prev, created])
      setOrgId(created.id)
      setContactId(null)
      setContactSkipped(false)
      setJustCreatedOrgId(created.id)
      onPick?.(created)
      toast.success(`기관 «${created.name}» 을 만들었어요`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    } finally {
      setBusy(false)
    }
  }

  async function createContact(name: string) {
    if (!orgId) return
    setBusy(true)
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "담당자를 만들지 못했습니다")
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === orgId
            ? { ...o, contacts: [...o.contacts, { id: data.id, name: data.name, title: data.title }] }
            : o
        )
      )
      setContactId(data.id)
      toast.success(`담당자 «${data.name}» 을 만들었어요`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    } finally {
      setBusy(false)
    }
  }

  async function setOrgType(type: CrmOrgType) {
    if (!orgId) return
    setOrgs((prev) => prev.map((o) => (o.id === orgId ? { ...o, type } : o)))
    try {
      const res = await fetch(`/api/crm/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "유형을 바꾸지 못했습니다")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    }
  }

  return {
    orgs,
    org,
    orgId,
    contactId,
    setContactId,
    contactSkipped,
    setContactSkipped,
    justCreatedOrgId,
    busy,
    pickOrg,
    createOrg,
    createContact,
    setOrgType,
  }
}
