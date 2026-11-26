// 칸 단위 저장의 충돌 확인 — 화면이 「고치기 전에 본 값」(expect)을 함께 보내면, 그새 그 칸이 바뀌었는지 본다.
// expect 를 안 보내는 호출(AI 도구 등)은 전과 같이 그대로 덮어쓴다.
import { seoulYmd } from "@/lib/grants-labels"

export type ExpectKind = "text" | "id" | "ymd" | "ids"

const norm = (kind: ExpectKind, v: unknown): string | null => {
  switch (kind) {
    case "text":
      return typeof v === "string" ? v.trim() || null : null
    case "id":
      return typeof v === "string" && v ? v : null
    case "ymd":
      return v === null || v === undefined || v === ""
        ? null
        : seoulYmd(v as Date | string)
    case "ids":
      return Array.isArray(v)
        ? [...new Set(v.map(String))].sort().join(",")
        : ""
  }
}

/** expect 와 지금 값이 다른 칸 — 모르는 칸 · expect 가 아닌 값은 건너뛴다 */
export function staleFields(
  expect: unknown,
  current: Record<string, unknown>,
  kinds: Record<string, ExpectKind>
): string[] {
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) return []
  const out: string[] = []
  for (const [key, seen] of Object.entries(expect as Record<string, unknown>)) {
    const kind = kinds[key]
    if (!kind) continue
    if (norm(kind, seen) !== norm(kind, current[key])) out.push(key)
  }
  return out
}
