import { apiUrl } from "@/lib/base-path"

/** 저장 실패 — 서버 메시지와 HTTP 상태(409 = 그새 다른 사람이 고침) */
export class SendError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** 인증 · 국가과제 화면의 저장 요청 — 실패하면 서버 메시지로 던진다 */
export async function send<T = { changed?: string[]; id?: string }>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  })
  const data = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!res.ok)
    throw new SendError(data?.error ?? "저장하지 못했습니다", res.status)
  return data as T
}
