"use client"

import { createContext, useContext } from "react"

/** CRM 탭 전환 — CrmNav 가 누르면 go 를 부른다. 공급자는 components/crm/crm-tabs.tsx(crm 레이아웃이 얹는다) */
export const CrmTabsContext = createContext<{ go: (href: string) => void; pendingHref: string | null } | null>(null)

export const useCrmTabs = () => useContext(CrmTabsContext)
