"use client"

import { useEffect } from "react"

import {
  registerServiceWorker,
  setInstallPrompt,
  type InstallPromptEvent,
} from "@/lib/pwa"

/**
 * service worker 를 등록하고 설치 이벤트를 이어받는다. 화면에 아무것도 그리지 않는다.
 *
 * 로그인한 영역에서 한 번 돌면 충분하다 — worker 는 브라우저에 남아, 탭을 닫아도
 * 푸시를 받는다. 구독(권한 요청)은 여기서 하지 않는다: 버튼을 누른 흐름 밖에서 부르면
 * 브라우저가 거부하고, 사람이 고르기도 전에 권한 팝업이 뜨는 것도 곤란하다.
 */
export function PwaRegister() {
  useEffect(() => {
    void registerServiceWorker()

    // layout 의 인라인 스크립트가 놓친 뒤늦은 이벤트를 여기서 받는다.
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => setInstallPrompt(null)

    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  return null
}
