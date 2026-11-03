import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { trailingDebounce } from "./trailing-debounce"

test("연달아 불러도 마지막 부름에서 한 번만 한다", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  let n = 0
  const d = trailingDebounce(() => n++, 1500)
  d.call()
  mock.timers.tick(1000)
  d.call()
  mock.timers.tick(1000)
  assert.equal(n, 0)
  mock.timers.tick(500)
  assert.equal(n, 1)
  mock.timers.tick(5000)
  assert.equal(n, 1, "부르지 않으면 다시 하지 않는다")
  mock.timers.reset()
})

test("떠날 때 기다리던 것은 바로 하고, 기다리는 것이 없으면 하지 않는다", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  let n = 0
  const d = trailingDebounce(() => n++, 1500)
  d.flush()
  assert.equal(n, 0)
  d.call()
  d.flush()
  assert.equal(n, 1)
  mock.timers.tick(5000)
  assert.equal(n, 1, "바로 한 뒤에는 시계가 남지 않는다")
  mock.timers.reset()
})
