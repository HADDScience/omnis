/**
 * 담당자 이름 해석 — AI ownerHint나 슬래시 명령에서 추출된 이름을
 * 실제 팀원 레코드로 매핑한다. 존칭("우창님")·약칭("우창")을 모두 흡수한다.
 *
 * 서버(app/api/tasks)·클라이언트(TaskCmdModal) 양쪽에서 공용으로 쓰인다.
 */

/** 이름 뒤에 흔히 붙는 존칭/직함 — 매칭 전에 제거한다. (긴 것부터) */
const HONORIFICS = [
  "대표님",
  "이사님",
  "팀장님",
  "선생님",
  "선임님",
  "책임님",
  "매니저님",
  "프로님",
  "님",
  "씨",
  "쌤",
]

/** "우창님" → "우창" 처럼 끝에 붙은 존칭을 떼어 정규화한다. */
export function normalizeName(input: string): string {
  let n = input.trim()
  for (const h of HONORIFICS) {
    if (n.length > h.length && n.endsWith(h)) {
      n = n.slice(0, -h.length).trim()
      break
    }
  }
  return n
}

/**
 * ownerHint를 팀원 목록과 매칭한다.
 * 1) 완전 일치 → 2) 팀원 이름이 힌트를 포함("정우창" ⊇ "우창")
 * → 3) 힌트가 팀원 이름을 포함 → 4) 한국식 이름 끝 2글자 매칭.
 * 일치가 없으면 null. 모호하면 첫 일치를 반환한다.
 */
export function matchUserByName<T extends { name: string }>(
  hint: string | null | undefined,
  users: T[],
): T | null {
  if (!hint) return null
  const raw = hint.trim()
  if (!raw) return null
  const norm = normalizeName(raw)

  // 1. 완전 일치 (원본 또는 정규화)
  const exact = users.find((u) => u.name === raw || u.name === norm)
  if (exact) return exact
  if (!norm) return null

  // 2. 팀원 이름이 힌트를 포함: "우창" → "정우창"
  const contained = users.find((u) => u.name.includes(norm))
  if (contained) return contained

  // 3. 힌트가 팀원 이름을 포함: "정우창 담당자" → "정우창"
  const wrapping = users.find((u) => norm.includes(u.name))
  if (wrapping) return wrapping

  // 4. 한국식 이름 끝 2글자(이름 부분)로 매칭
  const givenName = users.find(
    (u) => u.name.length >= 2 && norm.includes(u.name.slice(-2)),
  )
  return givenName ?? null
}
