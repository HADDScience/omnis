/**
 * 화면 쪽 사용 기록 — 묶어 보내기 · 첨부 실패와 재시도 · 파일 이름 비수집.
 * 데모로 도는 e2e 에서는 첨부가 꺼져 있어(lib/demo) 첨부 경로를 여기서 잰다. 실행: pnpm test:unit
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

process.env.NEXT_PUBLIC_UI_METRICS = "1"
process.env.NEXT_PUBLIC_BUILD_SHA = "abcdef1"

const fetched: { url: string; body: string }[] = []
const beacons: { url: string; blob: Blob }[] = []
let beaconOk = true
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  fetched.push({ url: String(url), body: String(init?.body) })
  return new Response(null, { status: 204 })
}) as typeof fetch
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    sendBeacon: (url: string, blob: Blob) => {
      beacons.push({ url, blob })
      return beaconOk
    },
  },
})

const { flushUiEvents, noteAttachAttempt, noteRoomFirstMessage, noteRoomTap, noteUiPath, noteUiSend, trackUi } = await import("./client")
const { reportIncident } = await import("../report-client-error")
const { UI_BATCH_SIZE, uiEventBatchSchema } = await import("./rules")

const eventPosts = () => fetched.filter((f) => f.url.endsWith("/api/ui-metrics/events")).map((f) => JSON.parse(f.body))

beforeEach(() => {
  flushUiEvents()
  fetched.length = 0
  beacons.length = 0
  beaconOk = true
  noteUiPath("/tasks")
})

test("보낼 것이 없으면 요청을 만들지 않는다", () => {
  flushUiEvents()
  flushUiEvents(true)
  assert.equal(fetched.length, 0)
  assert.equal(beacons.length, 0)
})

test("묶음이 찰 때까지 보내지 않고, 차면 한 번에 보낸다", () => {
  for (let i = 0; i < UI_BATCH_SIZE - 1; i++) trackUi("menu_open")
  assert.equal(fetched.length, 0)
  trackUi("menu_open")
  const [body] = eventPosts()
  assert.equal(body.events.length, UI_BATCH_SIZE)
  assert.equal(body.sha, "abcdef1")
  assert.ok(uiEventBatchSchema.safeParse(body).success)
})

test("탭을 숨길 때는 비콘으로, 비콘이 거절되면 fetch 로 보낸다", async () => {
  trackUi("menu_dismiss")
  flushUiEvents(true)
  assert.equal(beacons.length, 1)
  assert.equal(fetched.length, 0)
  assert.equal(beacons[0].blob.type, "application/json")
  assert.ok(uiEventBatchSchema.safeParse(JSON.parse(await beacons[0].blob.text())).success)

  beaconOk = false
  trackUi("menu_dismiss")
  flushUiEvents(true)
  assert.equal(eventPosts().length, 1)
})

test("첨부 실패는 상태 코드만 남긴다 — 파일 이름 · 메시지 없음", () => {
  reportIncident({ kind: "upload_failed", message: "비밀 메시지", status: 500, size: 123, fileName: "비밀파일.pdf" })
  flushUiEvents()
  const raw = fetched.find((f) => f.url.endsWith("/api/ui-metrics/events"))?.body ?? ""
  assert.deepEqual(JSON.parse(raw).events, [{ name: "attach_failed", path: "/tasks", value: 500 }])
  assert.equal(raw.includes("비밀"), false)
  assert.equal(raw.includes("123"), false)
  noteAttachAttempt()
})

test("실패 뒤 다시 올리면 재시도 한 번, 실패가 없었으면 재시도가 아니다", () => {
  noteAttachAttempt()
  flushUiEvents()
  assert.equal(eventPosts().length, 0)

  reportIncident({ kind: "upload_too_large", message: "x" })
  noteAttachAttempt()
  noteAttachAttempt()
  flushUiEvents()
  const names = eventPosts()[0].events.map((e: { name: string }) => e.name)
  assert.deepEqual(names, ["attach_failed", "attach_retry"])
})

test("전송 실패는 첨부 실패가 아니다", () => {
  reportIncident({ kind: "send_failed", message: "x", status: 500 })
  flushUiEvents()
  assert.equal(eventPosts().length, 0)
})

test("탭 → 첫 글은 탭 한 번에 한 번, 저장본 여부로 이름이 갈린다", () => {
  noteUiPath("/chat/비밀방")
  noteRoomFirstMessage(false)
  noteRoomTap(performance.now() - 120)
  noteRoomFirstMessage(true)
  noteRoomFirstMessage(true)
  noteRoomTap(performance.now() - 300)
  noteRoomFirstMessage(false)
  flushUiEvents()
  const [body] = eventPosts()
  assert.deepEqual(body.events.map((e: { name: string }) => e.name), ["room_first_message_saved", "room_first_message"])
  assert.ok(body.events.every((e: { value: number }) => Number.isInteger(e.value) && e.value >= 100))
  assert.equal(JSON.stringify(body).includes("비밀"), false)
})

test("첫 전송은 방을 연 뒤 한 번만, 방 밖에서는 재지 않는다", () => {
  noteUiPath("/chat/비밀방")
  noteUiSend()
  noteUiSend()
  noteUiPath("/tasks")
  noteUiSend()
  flushUiEvents()
  const [body] = eventPosts()
  assert.equal(body.events.length, 1)
  assert.equal(body.events[0].name, "room_open_to_send")
  assert.equal(body.events[0].path, "/chat/:id")
  assert.equal(JSON.stringify(body).includes("비밀"), false)
})
