"use client"

import { useSyncExternalStore } from "react"

import { todayKst } from "@/lib/ip/date"

/** 날짜는 스스로 변경 알림을 보내지 않으므로 구독은 no-op 이다. */
function subscribe(): () => void {
  return () => {}
}

/** 빌드 시점 날짜. 프리렌더 동안 값이 흔들리지 않게 모듈 로드 때 한 번만 잡는다. */
const BUILD_TODAY = todayKst()

function getServerSnapshot(): string {
  return BUILD_TODAY
}

/**
 * 정적 배포이므로 HTML 은 빌드 시점에 만들어진다.
 * 프리렌더/하이드레이션 시점에는 빌드 날짜를 쓰고, 브라우저에서는 실제 오늘(KST)로 바뀌어
 * 경과일이 항상 "오늘 기준"이 된다.
 */
export function useToday(): string {
  return useSyncExternalStore(subscribe, todayKst, getServerSnapshot)
}
