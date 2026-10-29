// 입력칸의 Enter — 보낼지 줄을 바꿀지. 순수 함수 — 시험: lib/enter-to-send.test.ts
//
// PC(물리 키보드): Enter 보내기 · Shift+Enter 줄바꿈.
// 폰(손가락 입력, `(pointer: coarse)`): Enter 는 줄바꿈이고 보내기는 버튼으로만 — 카톡과 같다.
// 화면 키보드의 Enter 는 「다음 줄」 자리라 누르다 반쯤 쓴 글이 나가 버렸다(2026-10-29 작업지시자).
// 한글 조합 중(IME)의 Enter 는 글자를 확정하는 키다 — 어느 기기에서든 보내지 않는다(Safari 는 isComposing 대신 keyCode 229).

export interface EnterKeyLike {
  key: string
  shiftKey: boolean
  nativeEvent: { isComposing?: boolean; keyCode?: number }
}

export function enterSends(e: EnterKeyLike, touchTyping: boolean): boolean {
  if (e.key !== "Enter") return false
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return false
  if (touchTyping) return false
  return !e.shiftKey
}

/** 지금 손가락으로 쓰는 기기인가 — 키를 누르는 순간에 본다(폴더블을 펼치거나 키보드를 꽂으면 바뀐다) */
export function isTouchTyping(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(pointer: coarse)").matches
}
