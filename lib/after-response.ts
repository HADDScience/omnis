// 응답 뒤에 돌릴 일 — 푸시 발송처럼 실패해도 원래 동작(글쓰기 · 업무 저장 · 동기화)을 막으면 안 되는 일.
//
// 요청 안(라우트 · MCP)이면 Next 의 after() 로 넘긴다 — 응답이 먼저 나가고, 함수 수명(maxDuration) 안에서 끝난다.
// `void promise` 로 던져 두면 Vercel 은 응답 뒤 함수를 얼려 발송이 잘릴 수 있다.
// 요청 밖(tsx 스크립트 · Workflow 단계)에서는 after() 가 던진다 — 그때는 그 자리에서 돌리고 기다리지 않는다.
// 오류는 던지지 않고 로그만 남긴다.
import { after } from "next/server"

const pending = new Set<Promise<void>>()

export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const safe = async () => {
    try {
      await task()
    } catch (err) {
      console.error(`[${label}]`, err)
    }
  }
  try {
    after(safe)
  } catch {
    const p = safe().finally(() => pending.delete(p))
    pending.add(p)
  }
}

/** 요청 밖에서 넘긴 일이 다 끝날 때까지 — 검증 스크립트가 끝내기 전에 부른다 */
export async function settleAfterResponse(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending])
}
