// 제자리 편집 한 칸의 상태 — 보기 → 입력 → 저장 중 → 보기. 화면(components/grants/inline-field.tsx)과 시험이 같이 쓴다.
// 저장이 끝나면 서버 새 값이 올 때까지 고친 값을 먼저 보이고, 실패하면 원래 값으로 되돌린다.

export type FieldMode = "view" | "edit" | "saving"

export interface FieldNote {
  kind: "error" | "conflict"
  message: string
}

export interface FieldState<T> {
  mode: FieldMode
  draft: T
  /** 저장했거나 저장 중인 값 — 서버 값(base)이 바뀔 때까지 이것을 보인다 */
  optimistic: { value: T; base: string } | null
  note: FieldNote | null
  /** 방금 저장됨 표시 */
  saved: boolean
}

export type Equals<T> = (a: T, b: T) => boolean

/** 서버에서 온 칸 값과 그 값을 가리키는 키(JSON) — 키가 바뀌면 새 값이 온 것이다 */
export interface Server<T> {
  value: T
  key: string
}

export const server = <T>(value: T): Server<T> => ({
  value,
  key: JSON.stringify(value ?? null),
})

export function initField<T>(value: T): FieldState<T> {
  return { mode: "view", draft: value, optimistic: null, note: null, saved: false }
}

/** 지금 보일 값 — 저장한 뒤 서버 값이 아직 그대로면 저장한 값, 서버 값이 새로 왔으면 그것 */
export function shownValue<T>(s: FieldState<T>, srv: Server<T>): T {
  return s.optimistic && (s.mode === "saving" || s.optimistic.base === srv.key)
    ? s.optimistic.value
    : srv.value
}

/** 칸을 누르면 입력 상태로 — 저장 중이면 받지 않는다 */
export function beginEdit<T>(s: FieldState<T>, srv: Server<T>): FieldState<T> {
  if (s.mode === "saving") return s
  return {
    ...s,
    mode: "edit",
    draft: shownValue(s, srv),
    note: null,
    saved: false,
  }
}

export function editDraft<T>(s: FieldState<T>, draft: T): FieldState<T> {
  return s.mode === "edit" ? { ...s, draft } : s
}

/** Esc — 입력을 버리고 보기로 */
export function cancelEdit<T>(s: FieldState<T>): FieldState<T> {
  return s.mode === "edit" ? { ...s, mode: "view" } : s
}

/**
 * Enter · 칸 벗어남 — 바뀐 게 없으면 보기로 돌아가고, 바뀌었으면 저장 중으로.
 * send 가 null 이 아니면 그 값을 서버에 보낸다(prev 는 고치기 전 값 — 충돌 확인에 쓴다).
 */
export function commitEdit<T>(
  s: FieldState<T>,
  srv: Server<T>,
  equals: Equals<T>,
  draft: T = s.draft
): { state: FieldState<T>; send: { next: T; prev: T } | null } {
  if (s.mode !== "edit") return { state: s, send: null }
  const prev = shownValue(s, srv)
  if (equals(draft, prev))
    return { state: { ...s, mode: "view", draft }, send: null }
  return {
    state: {
      ...s,
      mode: "saving",
      draft,
      optimistic: { value: draft, base: srv.key },
    },
    send: { next: draft, prev },
  }
}

/** 저장됨 — 서버 새 값(router.refresh)이 오기 전까지 저장한 값을 보인다 */
export function saveSucceeded<T>(s: FieldState<T>): FieldState<T> {
  return { ...s, mode: "view", saved: true }
}

/** 실패 · 충돌 — 고친 값을 버리고 서버 값으로 되돌린다 */
export function saveFailed<T>(s: FieldState<T>, note: FieldNote): FieldState<T> {
  return { ...s, mode: "view", optimistic: null, note, saved: false }
}

/** 저장 실패를 칸 옆 한 줄로 — 409 는 다른 사람이 그새 고친 것 */
export function noteFromError(err: unknown): FieldNote {
  const status = (err as { status?: number } | null)?.status
  const message =
    err instanceof Error && err.message ? err.message : "저장하지 못했습니다"
  return status === 409
    ? { kind: "conflict", message }
    : { kind: "error", message }
}

// ─── 값 비교 ───

export const sameText: Equals<string> = (a, b) => a.trim() === b.trim()
export const sameValue = <T>(a: T, b: T) => a === b
export const sameSet: Equals<string[]> = (a, b) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n")

/** 입력 칸 키 — Enter 는 저장(여러 줄 칸은 Shift+Enter 가 줄바꿈), Esc 는 취소 */
export function keyAction(
  key: string,
  opts: { shift?: boolean; multiline?: boolean; composing?: boolean } = {}
): "commit" | "cancel" | null {
  if (opts.composing) return null
  if (key === "Escape") return "cancel"
  if (key === "Enter" && !(opts.multiline && opts.shift)) return "commit"
  return null
}
