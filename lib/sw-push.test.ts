/**
 * service worker(public/sw.js)의 푸시 처리 — 보고 있는 방이면 띄우지 않는다 · renotify · basePath.
 * 브라우저 없이 sw.js 를 vm 에 올리고 self(등록 · 창 목록)를 흉내 낸다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"

type Shown = { title: string; options: Record<string, unknown> }
type FakeClient = { url: string; focused: boolean; visibilityState: "visible" | "hidden" }

type Posted = { url: string; body: { sha: string; events: { name: string; value: number; path: string }[] } }

function loadWorker(scope: string, clients: FakeClient[], opts: { fetchFails?: boolean } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const shown: Shown[] = []
  const posted: Posted[] = []
  const opened: string[] = []
  const fetch = async (url: string, init: { body: string }) => {
    if (opts.fetchFails) throw new Error("offline")
    posted.push({ url, body: JSON.parse(init.body) })
    return { ok: true }
  }
  const self = {
    addEventListener: (name: string, fn: (e: unknown) => void) => (handlers[name] = fn),
    skipWaiting: () => {},
    registration: {
      scope,
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options })
      },
    },
    clients: { matchAll: async () => clients, claim: async () => {}, openWindow: async (u: string) => void opened.push(u) },
  }
  vm.runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), { self, URL, fetch })
  async function push(payload: unknown) {
    let done: Promise<unknown> = Promise.resolve()
    handlers.push({ data: { json: () => payload, text: () => "" }, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  async function click(data: unknown) {
    let done: Promise<unknown> = Promise.resolve()
    handlers.notificationclick({ notification: { data, close: () => {} }, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  return { push, click, shown, posted, opened }
}

const ROOM = { title: "하드사이언스", body: "김하드: 안녕", url: "/chat/default-room", roomPath: "/chat/default-room", tag: "omnis:chat:room:default-room", renotify: true }

test("그 방을 포커스된 창이 보고 있으면 띄우지 않는다", async () => {
  const w = loadWorker("https://x.app/", [{ url: "https://x.app/chat/default-room", focused: true, visibilityState: "visible" }])
  await w.push(ROOM)
  assert.equal(w.shown.length, 0)
})

test("다른 방 · 백그라운드 창 · 포커스 잃은 창이면 띄운다", async () => {
  for (const c of [
    { url: "https://x.app/chat/other", focused: true, visibilityState: "visible" as const },
    { url: "https://x.app/chat/default-room", focused: false, visibilityState: "visible" as const },
    { url: "https://x.app/chat/default-room", focused: true, visibilityState: "hidden" as const },
  ]) {
    const w = loadWorker("https://x.app/", [c])
    await w.push(ROOM)
    assert.equal(w.shown.length, 1, JSON.stringify(c))
    assert.equal(w.shown[0].options.renotify, true)
    assert.equal(w.shown[0].options.tag, ROOM.tag)
    assert.equal(JSON.stringify(w.shown[0].options.data), JSON.stringify({ url: "https://x.app/chat/default-room" }))
  }
})

test("basePath(/omnis/) 아래에서도 같은 방을 알아본다 · 끝 슬래시는 따지지 않는다", async () => {
  const w = loadWorker("https://x.app/omnis/", [{ url: "https://x.app/omnis/chat/task/t1/", focused: true, visibilityState: "visible" }])
  await w.push({ ...ROOM, roomPath: "/chat/task/t1" })
  assert.equal(w.shown.length, 0)
})

test("방이 없는 알림(업무 지정)은 보고 있는 화면과 상관없이 띄우고, renotify 를 켜지 않는다", async () => {
  const w = loadWorker("https://x.app/", [{ url: "https://x.app/tasks/t1", focused: true, visibilityState: "visible" }])
  await w.push({ title: "새 업무: 시약", body: "정우창님이 업무를 지시했습니다.", url: "/tasks/t1?from=notification", tag: "omnis:t1" })
  assert.equal(w.shown.length, 1)
  assert.equal(w.shown[0].options.renotify, false)
})

test("시범 운영 측정 — sentAt 이 있으면 받은 초 · 연 초를 보낸다. 띄우지 않은 알림도 받은 것으로 센다", async () => {
  const sentAt = Date.now() - 4_000
  const w = loadWorker("https://x.app/omnis/", [{ url: "https://x.app/omnis/chat/default-room", focused: true, visibilityState: "visible" }])
  await w.push({ ...ROOM, sentAt, sha: "abc1234" })
  assert.equal(w.shown.length, 0)
  assert.equal(w.posted.length, 1)
  assert.equal(w.posted[0].url, "https://x.app/omnis/api/ui-metrics/events")
  assert.equal(w.posted[0].body.sha, "abc1234")
  const [ev] = w.posted[0].body.events
  assert.equal(ev.name, "push_recv_s")
  assert.ok(ev.value >= 3 && ev.value <= 6, String(ev.value))
  assert.deepEqual(Object.keys(w.posted[0].body.events[0]).sort(), ["name", "path", "value"]) // 제목 · 본문은 싣지 않는다

  await w.click({ url: "https://x.app/omnis/chat/default-room", sentAt, sha: "abc1234" })
  assert.equal(w.posted[1].body.events[0].name, "push_open_s")
})

test("시범 운영 측정 — sentAt 이 없으면 보내지 않고, 보내기가 실패해도 알림은 뜬다 · 기기 시계가 앞서면 0 · 이상한 sha 는 dev", async () => {
  const off = loadWorker("https://x.app/", [])
  await off.push(ROOM)
  assert.equal(off.posted.length, 0)
  assert.equal(off.shown.length, 1)

  const failing = loadWorker("https://x.app/", [], { fetchFails: true })
  await failing.push({ ...ROOM, sentAt: Date.now() })
  assert.equal(failing.shown.length, 1)

  const skew = loadWorker("https://x.app/", [])
  await skew.push({ ...ROOM, sentAt: Date.now() + 60_000, sha: "<script>" })
  assert.equal(skew.posted[0].body.events[0].value, 0)
  assert.equal(skew.posted[0].body.sha, "dev")
})
