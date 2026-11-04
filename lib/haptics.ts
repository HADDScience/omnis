import { PHONE_TOUCH_QUERY } from "./keyboard-viewport"

/** 안드로이드에서 「톡」 한 번으로 느껴지는 길이 */
const VIBRATE_MS = 10

type HapticWindow = Pick<Window, "matchMedia" | "navigator" | "document">

/**
 * 폰에서 탭을 누른 손끝에 짧은 진동을 준다. 사용자가 누른 처리 안에서 동기적으로 불러야 한다 — 브라우저가 그 밖의 호출은 막는다.
 *
 * iOS Safari 에는 navigator.vibrate 가 없다. 18 부터 스위치 체크박스(<input type=checkbox switch>)가 바뀔 때 햅틱이 나서,
 * 보이지 않는 스위치를 라벨 클릭으로 한 번 바꾼다. 18 미만은 스위치가 그냥 체크박스라 아무 일도 없다.
 * 요소는 display:none 으로 만들어 바로 지운다 — 포커스 · 스크린리더 · 레이아웃에 닿지 않는다.
 * 클릭은 라벨에서 멈춘다 — 화면의 다른 click 처리기는 탭을 누른 진짜 클릭 한 번만 본다.
 *
 * 햅틱 때문에 이동이 막히면 안 되므로 예외는 삼킨다.
 */
export function tapHaptic(win: HapticWindow = window): void {
  try {
    if (!win.matchMedia(PHONE_TOUCH_QUERY).matches) return
    if (typeof win.navigator.vibrate === "function") {
      win.navigator.vibrate(VIBRATE_MS)
      return
    }
    const label = win.document.createElement("label")
    label.setAttribute("aria-hidden", "true")
    label.style.display = "none"
    label.addEventListener("click", (e) => e.stopPropagation())
    const input = win.document.createElement("input")
    input.type = "checkbox"
    input.setAttribute("switch", "")
    input.tabIndex = -1
    label.appendChild(input)
    win.document.head.appendChild(label)
    try {
      label.click()
    } finally {
      label.remove()
    }
  } catch {
    // 햅틱은 없어도 된다
  }
}
