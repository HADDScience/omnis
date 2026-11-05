import { apiUrl } from "@/lib/base-path"
import {
  ATTACH_RETRY_WINDOW_MS,
  DEV_SHA,
  isRoomPattern,
  pathPattern,
  ROOM_OPEN_MAX_MS,
  UI_BATCH_SIZE,
  type UiEventName,
} from "./rules"

/**
 * 화면에서 사용 기록을 모아 묶어 보낸다.
 *
 * Neon 은 깨어 있던 시간이 곧 요금이라(mydocs/working/2026-09-28-neon-wake-time.md) 타이머를 두지 않는다.
 * 묶음이 차거나 탭을 숨길 때만 보낸다 — 동작이 없으면 요청도 없고, 자리를 비운 탭이 DB 를 깨우지 않는다.
 * 실패하면 버린다. 사용 기록 때문에 사람의 일이 막히거나 재시도가 쌓이면 안 된다.
 *
 * 여기 들어오는 것은 이름 · 숫자뿐이다. 내용을 넘길 인자가 없다.
 */

export const uiMetricsEnabled = process.env.NEXT_PUBLIC_UI_METRICS === "1"
const SHA = process.env.NEXT_PUBLIC_BUILD_SHA || DEV_SHA

let currentPattern = "/"
let queue: { name: UiEventName; value?: number; path: string }[] = []
let roomOpenedAt: number | null = null
let attachFailedAt: number | null = null
let roomTappedAt: number | null = null

function post(body: string, beacon: boolean) {
  const url = apiUrl("/api/ui-metrics/events")
  if (beacon && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return
  }
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {})
}

export function flushUiEvents(beacon = false) {
  if (queue.length === 0) return
  const events = queue
  queue = []
  try {
    post(JSON.stringify({ sha: SHA, events }), beacon)
  } catch {
    // 기록을 못 보내도 사람의 일과 상관없다
  }
}

export function trackUi(name: UiEventName, value?: number) {
  if (!uiMetricsEnabled) return
  queue.push({ name, path: currentPattern, ...(value === undefined ? {} : { value }) })
  if (queue.length >= UI_BATCH_SIZE) flushUiEvents()
}

/** 화면이 옮겨 갔다. 방이면 첫 전송까지 재기 시작한다 */
export function noteUiPath(pathname: string) {
  currentPattern = pathPattern(pathname)
  roomOpenedAt = isRoomPattern(currentPattern) ? performance.now() : null
}

/** 글을 보냈다. 방을 연 뒤 처음이면 걸린 시간을 남긴다 */
export function noteUiSend() {
  if (roomOpenedAt === null) return
  const ms = Math.round(performance.now() - roomOpenedAt)
  roomOpenedAt = null
  if (ms <= ROOM_OPEN_MAX_MS) trackUi("room_open_to_send", ms)
}

/** 목록에서 방을 눌렀다. 인자는 탭 이벤트의 timeStamp — performance.now 와 같은 시계다 */
export function noteRoomTap(timeStamp: number) {
  roomTappedAt = timeStamp
}

/** 방 화면에 첫 글이 그려졌다. 탭 한 번에 한 번만 남는다 — 주소로 바로 연 방은 재지 않는다 */
export function noteRoomFirstMessage(fromSnapshot: boolean) {
  if (roomTappedAt === null) return
  const ms = Math.round(performance.now() - roomTappedAt)
  roomTappedAt = null
  if (ms >= 0 && ms <= ROOM_OPEN_MAX_MS) trackUi(fromSnapshot ? "room_first_message_saved" : "room_first_message", ms)
}

/** 첨부가 실패했다(lib/report-client-error.ts 의 reportIncident 가 부른다) */
export function noteAttachFailed(status?: number) {
  attachFailedAt = Date.now()
  trackUi("attach_failed", status)
}

/** 첨부를 올리기 시작한다. 방금 실패한 뒤라면 재시도다 */
export function noteAttachAttempt() {
  if (attachFailedAt !== null && Date.now() - attachFailedAt <= ATTACH_RETRY_WINDOW_MS) trackUi("attach_retry")
  attachFailedAt = null
}
