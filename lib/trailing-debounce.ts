// 마지막 부름에서 잠시 뒤 한 번 — 시험: lib/trailing-debounce.test.ts
// 대화창이 글을 연달아 받아도 왼쪽 목록은 한 번만 다시 읽는다(hooks/use-room-list-nudge.ts).

export interface TrailingDebounce {
  call(): void
  /** 기다리는 것이 있으면 지금 한다 — 방을 떠날 때 보낸 글이 목록에 늦게 뜨지 않게 */
  flush(): void
}

export function trailingDebounce(fn: () => void, ms: number): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    timer = null
    fn()
  }
  return {
    call() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, ms)
    },
    flush() {
      if (!timer) return
      clearTimeout(timer)
      fire()
    },
  }
}
