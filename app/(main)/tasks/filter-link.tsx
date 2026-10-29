"use client"

import type { ComponentProps } from "react"
import { useSearchParams } from "next/navigation"
import { FILTER_LABEL } from "./filters"

/** 지금 주소에 걸린 업무 필터. 모르는 값은 없는 것으로 본다 */
export function useTasksFilter() {
  const sp = useSearchParams()
  const raw = sp.get("filter")
  return {
    filter: raw && FILTER_LABEL[raw] ? raw : null,
    assignee: sp.get("assignee"),
  }
}

/**
 * 업무 화면 안에서 필터만 바꾸는 링크. 서버에 다시 묻지 않고 주소만 바꾼다.
 *
 * `?filter=` 만 바뀌는 이동은 같은 화면 안의 이동이라 스켈레톤(loading.tsx)이 뜨지 않는다.
 * 그런데 서버는 업무 전체와 현황을 다시 불러와 화면을 처음부터 그려, 칩을 누르면 0.3~0.5초
 * 그대로 멈췄다가 한꺼번에 바뀌었다(2026-10-29 실측). 거르는 일은 이미 받은 목록 안에서 끝나므로
 * 주소만 바꾸고(history.pushState — Next 의 useSearchParams 가 따라온다) 거르기는 브라우저에서 한다.
 * 새 탭으로 열기·주소 복사는 그대로 되도록 진짜 링크로 둔다.
 */
export function FilterLink({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        window.history.pushState(null, "", href)
      }}
      {...props}
    />
  )
}
