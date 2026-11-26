import { apiUrl } from "@/lib/base-path"

/** 인증 · 국가과제 화면의 저장 요청 — 실패하면 서버 메시지로 던진다 */
export async function send<T = { changed?: string[]; id?: string }>(
  path: string,
  method: "POST" | "PATCH",
  body: unknown
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!res.ok) throw new Error(data?.error ?? "저장하지 못했습니다")
  return data as T
}
