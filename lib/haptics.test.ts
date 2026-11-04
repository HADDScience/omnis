import { test } from "node:test"
import assert from "node:assert/strict"
import { tapHaptic } from "./haptics"
import { PHONE_TOUCH_QUERY } from "./keyboard-viewport"

/** 스위치 라벨을 만드는 과정을 기록하는 가짜 window. 기본은 터치 폰 · vibrate 없음(iOS) */
function fakeWindow({ phone = true, vibrate, clickThrows = false }: { phone?: boolean; vibrate?: (ms: number) => boolean; clickThrows?: boolean } = {}) {
  const log = { queries: [] as string[], clicks: 0, appended: 0, removed: 0, listeners: [] as string[], labels: [] as Record<string, unknown>[] }
  const document = {
    createElement(tag: string) {
      const el: Record<string, unknown> = {
        tag,
        style: {},
        attrs: {} as Record<string, string>,
        children: [] as unknown[],
        setAttribute(k: string, v: string) {
          ;(el.attrs as Record<string, string>)[k] = v
        },
        appendChild(c: unknown) {
          ;(el.children as unknown[]).push(c)
        },
        addEventListener(type: string) {
          log.listeners.push(type)
        },
        click() {
          log.clicks++
          if (clickThrows) throw new Error("click 실패")
        },
        remove() {
          log.removed++
        },
      }
      if (tag === "label") log.labels.push(el)
      return el
    },
    head: {
      appendChild() {
        log.appended++
      },
    },
  }
  const win = {
    matchMedia(q: string) {
      log.queries.push(q)
      return { matches: phone }
    },
    navigator: vibrate ? { vibrate } : {},
    document,
  } as unknown as Parameters<typeof tapHaptic>[0]
  return { win, log }
}

test("vibrate 가 있으면 10ms 한 번 부르고 스위치는 만들지 않는다", () => {
  const calls: number[] = []
  const { win, log } = fakeWindow({ vibrate: (ms) => (calls.push(ms), true) })
  tapHaptic(win)
  assert.deepEqual(calls, [10])
  assert.equal(log.clicks, 0)
  assert.equal(log.appended, 0)
})

test("vibrate 가 거절(false)해도 스위치로 넘어가지 않는다", () => {
  const { win, log } = fakeWindow({ vibrate: () => false })
  tapHaptic(win)
  assert.equal(log.clicks, 0)
})

test("vibrate 가 없으면 숨긴 스위치의 라벨을 눌렀다가 지운다", () => {
  const { win, log } = fakeWindow()
  tapHaptic(win)
  assert.equal(log.clicks, 1)
  assert.equal(log.appended, 1)
  assert.equal(log.removed, 1)
  const label = log.labels[0]
  assert.equal((label.style as { display: string }).display, "none")
  assert.equal((label.attrs as Record<string, string>)["aria-hidden"], "true")
  const input = (label.children as Record<string, unknown>[])[0]
  assert.equal(input.type, "checkbox")
  assert.equal((input.attrs as Record<string, string>).switch, "")
  assert.equal(input.tabIndex, -1)
  assert.deepEqual(log.listeners, ["click"])
})

test("터치 폰이 아니면 아무것도 하지 않는다 — PC · iPad, 좁힌 PC 창", () => {
  const calls: number[] = []
  const { win, log } = fakeWindow({ phone: false, vibrate: (ms) => (calls.push(ms), true) })
  tapHaptic(win)
  assert.deepEqual(log.queries, [PHONE_TOUCH_QUERY])
  assert.deepEqual(calls, [])
  assert.equal(log.appended, 0)
})

test("어디서 예외가 나도 삼킨다", () => {
  const { win: throwing } = fakeWindow({
    vibrate: () => {
      throw new Error("vibrate 실패")
    },
  })
  assert.doesNotThrow(() => tapHaptic(throwing))
  assert.doesNotThrow(() =>
    tapHaptic({
      matchMedia() {
        throw new Error("matchMedia 실패")
      },
    } as unknown as Parameters<typeof tapHaptic>[0]),
  )
})

test("라벨 클릭이 실패해도 요소를 남기지 않는다", () => {
  const { win, log } = fakeWindow({ clickThrows: true })
  assert.doesNotThrow(() => tapHaptic(win))
  assert.equal(log.removed, 1)
})
