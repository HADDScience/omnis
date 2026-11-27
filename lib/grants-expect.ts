// 칸 단위 저장의 충돌 확인 — 화면이 「고치기 전에 본 값」(expect)을 함께 보내면, 그새 그 칸이 바뀌었는지 본다.
// expect 를 안 보내는 호출(AI 도구 등)은 전과 같이 그대로 덮어쓴다.
import { parseSeoulMinute, seoulYmd } from "@/lib/grants-labels"

/** 키 순서를 맞춘 JSON — 같은 값이면 같은 글자 */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`
}

export type ExpectKind = "text" | "id" | "ymd" | "ids" | "int" | "minute" | "json"

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
    case "int": {
      if (v === null || v === undefined || v === "") return null
      const t = String(v).replace(/[,\s원]/g, "")
      return /^\d+$/.test(t) ? BigInt(t).toString() : t
    }
    case "ids":
      return Array.isArray(v)
        ? [...new Set(v.map(String))].sort().join(",")
        : ""
    // 시각 — 분까지(인증 접수 마감 「2026-12-18 16:00」). 화면이 보내는 글은 서울 시각이다 — 서버 시간대(운영 UTC)로
    // 읽으면 9시간 어긋나 늘 충돌이 된다(2026-11-28 CI 에서 잡힘). 서울 시각 글 · ISO · Date 모두 같은 분이면 같다
    case "minute": {
      if (v === null || v === undefined || v === "") return null
      const d = v instanceof Date ? v : parseSeoulMinute(String(v))
      return d ? String(Math.floor(d.getTime() / 60_000)) : String(v)
    }
    // 목록(준비물 · 근거) — 키 순서를 맞춘 JSON
    case "json":
      return stable(v ?? null)
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
