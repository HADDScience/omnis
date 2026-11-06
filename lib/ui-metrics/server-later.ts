import { runAfterResponse } from "@/lib/after-response"
import type { ServerEventName } from "./pilot"
import { recordServerUiEvents, uiMetricsServerEnabled } from "./server"

/**
 * 응답 뒤에 남긴다 — 검색 응답을 늦추지 않게.
 * server.ts 와 나눈 것은 next/server 때문이다 — playwright spec 이 server.ts 를 import 하는데 next/server 는 거기서 못 읽는다.
 */
export function recordServerUiEventLater(userId: string, name: ServerEventName, path: string, value?: number): void {
  if (!uiMetricsServerEnabled()) return
  runAfterResponse("ui-metrics", () => recordServerUiEvents([{ userId, name, value }], path))
}
