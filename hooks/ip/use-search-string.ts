"use client"

import { useSyncExternalStore } from "react"

/**
 * next/navigation 의 useSearchParams 를 쓰면 정적 내보내기에서 해당 트리가
 * 프리렌더에서 빠져(Suspense fallback 만 남아) HTML 에 데이터가 담기지 않는다.
 * 대시보드에서 넘어올 때 쓰는 초기 필터만 필요하므로, location.search 를
 * 외부 스토어로 읽어 서버 스냅샷은 빈 문자열로 둔다.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

function getSnapshot(): string {
  return window.location.search
}

function getServerSnapshot(): string {
  return ""
}

export function useSearchString(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** 쿼리 파라미터 하나를 읽는다. 없으면 fallback. */
export function useQueryParam(name: string, fallback: string): string {
  const search = useSearchString()
  return new URLSearchParams(search).get(name) ?? fallback
}
