// 탭바 위 연결 상태 한 줄 — React 밖에서 DOM 으로 직접 그린다.
// Next 가 RSC 실패를 문서 이동으로 바꾸면 앱 라우터가 페이지가 떠날 때까지 멈춰(unresolvedThenable) React 트리 전체가
// 새로 그려지지 않는다(2026-11-26 e2e 로 확인). 그 동안에도 보여야 해서 React 상태로 그리지 않는다.
import { apiUrl } from "@/lib/base-path"

const ID = "omnis-nav-status"
let shown: { kind: "offline" | "slow"; href?: string } | null = null
/** 지금 이동 뒤 RSC 실패를 봤는지 — 봤으면 라우터가 멈춘 것이다 */
let rscFailedSinceTap = false

export const noteRscFailure = () => {
  rscFailedSinceTap = true
}
export const routerStalled = () => rscFailedSinceTap
export const resetStall = () => {
  rscFailedSinceTap = false
  document.documentElement.removeAttribute("data-nav-stalled")
}
/** 누른 표시를 거둔다 — React 가 멈췄어도 CSS 로 알약을 숨긴다(globals.css [data-nav-stalled]) */
export const markStalled = () => document.documentElement.setAttribute("data-nav-stalled", "")

const CLASS =
  "glass fixed left-1/2 z-[var(--z-nav)] -translate-x-1/2 rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap text-foreground bottom-[calc(var(--safe-bottom)+70px)] md:top-[calc(var(--demo-banner-height,0px)+3.25rem)] md:bottom-auto"
const BUTTON = "cursor-pointer font-semibold underline-offset-2 hover:underline"

/** offline 이 slow 보다 앞선다. null 이면 그 종류를 내린다 */
export function setNavStatus(kind: "offline" | "slow", on: boolean, href?: string): void {
  if (typeof document === "undefined") return
  if (on) {
    if (shown?.kind === "offline" && kind === "slow") return
    shown = { kind, href }
  } else if (shown?.kind === kind) shown = null
  else return
  render()
}

function render() {
  let el = document.getElementById(ID)
  if (!shown) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement("div")
    el.id = ID
    el.setAttribute("role", "status")
    el.setAttribute("aria-live", "polite")
    el.className = CLASS
    document.body.appendChild(el)
  }
  el.textContent = ""
  if (shown.kind === "offline") {
    el.textContent = "오프라인"
    return
  }
  el.append("연결이 느립니다 · ")
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = BUTTON
  btn.textContent = "다시 시도"
  const href = shown.href
  btn.onclick = () => {
    if (href) window.location.assign(apiUrl(href))
    else window.location.reload()
  }
  el.append(btn)
}
