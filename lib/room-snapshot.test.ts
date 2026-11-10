import { test } from "node:test"
import assert from "node:assert/strict"
import { roomsToForget, roomsToPrefetch, serverTimeOf } from "./room-snapshot"

const room = (key: string, kind: "COMPANY" | "DM" | "GROUP" | "TASK" | "OMNIS_DM", lastAt: string) => ({ key, kind, lastAt })

test("목록에 없는 방만 지울 후보다 — 업무방은 목록이 일부라 후보가 아니다", () => {
  const listed = new Set(["room:a"])
  assert.deepEqual(roomsToForget(["room:a", "room:b", "task:c"], listed), ["room:b"])
})

test("미리 받기 — 전사 · 사람 방만, 위에서 정한 수만큼, 저장본이 낡은 방만", () => {
  const rooms = [
    room("task:1", "TASK", "2026-11-05T00:00:03Z"),
    room("room:omnis", "OMNIS_DM", "2026-11-05T00:00:03Z"),
    room("room:new", "DM", "2026-11-05T00:00:03Z"),
    room("room:same", "GROUP", "2026-11-05T00:00:02Z"),
    room("room:old", "COMPANY", "2026-11-05T00:00:03Z"),
    room("room:far", "DM", "2026-11-05T00:00:01Z"),
  ]
  const saved: Record<string, string> = { "room:same": "2026-11-05T00:00:02.000Z", "room:old": "2026-11-05T00:00:01Z" }
  assert.deepEqual(roomsToPrefetch(rooms, (k) => saved[k], 3).map((r) => r.key), ["room:new", "room:old"])
})

test("서버 시각 — 머리가 없으면 지금보다 앞이라 고친 글을 놓치지 않는다", () => {
  const at = serverTimeOf({ headers: new Headers({ date: "Thu, 05 Nov 2026 01:02:03 GMT" }) })
  assert.equal(at, "2026-11-05T01:02:03.000Z")
  assert.ok(new Date(serverTimeOf({ headers: new Headers() })).getTime() < Date.now() - 30_000)
})
