/**
 * 터치 기기 화면 키보드 판정 — visualViewport 높이가 「평소 높이」 에서 얼마나 줄었는가로 본다.
 *
 * window.innerHeight 와 비교하지 않는다. iOS 에서는 키보드와 함께 줄어드는 경우가 있어 비율이 어긋난다 —
 * 그래서 기기 폭(가로 · 세로)마다 본 가장 큰 높이를 기억해 기준으로 삼는다.
 * 포커스만으로 판단하지도 않는다. 물리 키보드를 쓰면 포커스가 있어도 화면 높이가 줄지 않는다.
 */

/** 이만큼 줄어야 키보드다. 주소창이 접히거나 물리 키보드의 제안 막대가 뜨는 정도로는 줄지 않는 값 */
export const KEYBOARD_MIN_DROP_PX = 120

/** 하단 nav 를 쓰는 폭의 터치 기기. PC 는 창을 좁혀도 여기 들지 않는다 */
export const PHONE_TOUCH_QUERY = "(max-width: 767px) and (pointer: coarse)"

/** 화면 키보드가 뜨는 기기 — 폰과 태블릿. iPad 는 폭이 md 이상이라 PHONE_TOUCH_QUERY 로는 잡히지 않는다 */
export const TOUCH_SCREEN_QUERY = "(pointer: coarse)"

/** 이 폭에서 본 가장 큰 높이를 기억하고 돌려준다 */
export function rememberBaseline(baselines: Map<number, number>, width: number, height: number): number {
  const baseline = Math.max(baselines.get(width) ?? 0, height)
  baselines.set(width, baseline)
  return baseline
}

export function isKeyboardOpen(input: {
  touch: boolean
  textEntryFocused: boolean
  baseline: number
  height: number
}): boolean {
  return input.touch && input.textEntryFocused && input.baseline - input.height >= KEYBOARD_MIN_DROP_PX
}

/** 글자를 치는 입력 칸에서만 키보드가 뜬다. <input> 은 type 을 가린다 */
const NON_TEXT_INPUT = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
])

export function isTextEntry(
  el: { tagName: string; type?: string; readOnly?: boolean; disabled?: boolean; isContentEditable?: boolean } | null,
): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  if (el.disabled || el.readOnly) return false
  if (el.tagName === "TEXTAREA") return true
  return el.tagName === "INPUT" && !NON_TEXT_INPUT.has(el.type ?? "text")
}
