"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * 섹션 안의 하위 탭 띠(예: 아카이브의 지식 카드 · NAS · 지식재산권 · 고객·견적)를 페이지 제목줄 바로 아래에 붙인다.
 *
 * 띠는 섹션 레이아웃이 정하지만 제목줄(Header)은 각 페이지가 그린다. 레이아웃에서 띠를 children 앞에 두면
 * 제목줄보다 위에 붙고, PC 에서는 떠 있는 nav 가 제목줄 대신 그 띠에 겹친다. 그래서 레이아웃은 띠를 여기 맡기고
 * Header 가 자기 아래에 그린다.
 */
const HeaderSubnavContext = createContext<ReactNode>(null)

export function HeaderSubnavProvider({ subnav, children }: { subnav: ReactNode; children: ReactNode }) {
  return <HeaderSubnavContext.Provider value={subnav}>{children}</HeaderSubnavContext.Provider>
}

export function useHeaderSubnav() {
  return useContext(HeaderSubnavContext)
}
