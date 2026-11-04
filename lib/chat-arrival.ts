/**
 * 채팅 검색 결과에 도착한 글을 짧게 튕겨 어디에 왔는지 알린다.
 * 재생은 Web Animations 로 한다 — CSS 클래스를 다시 붙이지 않아도 같은 글을 또 눌렀을 때 처음부터 돈다.
 */

const ARRIVAL_ID = "chat-arrival"
export const ARRIVAL_DURATION_MS = 900
/** 말풍선 강조가 남아 있는 시간. 튕김이 끝난 뒤 잠깐 더 남는다 */
export const ARRIVAL_FLASH_MS = 1200

export const ARRIVAL_KEYFRAMES: Keyframe[] = [
  { transform: "translateY(0)", offset: 0 },
  { transform: "translateY(-10px)", offset: 0.22 },
  { transform: "translateY(0)", offset: 0.48 },
  { transform: "translateY(-4px)", offset: 0.68 },
  { transform: "translateY(0)", offset: 1 },
]

/**
 * 도착을 어떻게 알릴까.
 * - 검색어를 고치는 동안 같은 글에 머물면 알리지 않는다(글자마다 튕기면 어지럽다)
 * - 움직임 줄이기면 튕기지 않고 말풍선 강조만
 * - 걸린 글자가 이미 진하게 표시되면 말풍선까지 칠하지 않는다(카톡처럼)
 */
export function arrivalEffects(input: {
  /** 검색어 입력이 데려온 이동인가(▲▼ · Enter 를 누른 게 아니라) */
  typing: boolean
  sameTarget: boolean
  reducedMotion: boolean
  textMarked: boolean
}): { bounce: boolean; flash: boolean } {
  if (input.typing && input.sameTarget) return { bounce: false, flash: false }
  return { bounce: !input.reducedMotion, flash: input.reducedMotion || !input.textMarked }
}

/** 재생 중이면 끊고 처음부터 */
export function playArrival(el: HTMLElement) {
  for (const a of el.getAnimations()) if (a.id === ARRIVAL_ID) a.cancel()
  el.animate(ARRIVAL_KEYFRAMES, { id: ARRIVAL_ID, duration: ARRIVAL_DURATION_MS, easing: "ease-out" })
}
