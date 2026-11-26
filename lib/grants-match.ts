// 국가과제 결정 ↔ NAS 「(2026) 예비 지원과제」 폴더 이름 맞추기. 순수 함수만 — 이식 스크립트와 화면(폴더 고르기)이 같이 쓴다.
//
// 폴더 이름은 사람이 붙인 것이라 앞에 진행 표시가 붙는다: 참_ · 불참_ · 탈락_참_ · (260814) · 26 · 2026년 …
// 그런 것을 떼고 남은 글자의 두 글자 묶음(bigram)이 얼마나 겹치는지(Dice)로 비슷함을 잰다.

/** 비교용으로 이름을 다듬는다 — 진행 표시 · 날짜 · 연도 · 괄호 · 기호를 뗀다 */
export function normalizeGrantName(s: string): string {
  return s
    .normalize("NFC")
    .replace(/^(?:\d{6}_)?(?:탈락_)?(?:불참_|참_)?/, "")
    .replace(/\((?:\d{6}|상시)\)_?/g, "")
    .replace(/20\d{2}\s*년도?|\b2\d\b|20\d{2}/g, "")
    .replace(/[\[\]()（）「」『』<>_\-·.,:;~!?'"“”‘’/]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** 0~1. 한쪽이 다른 쪽을 통째로 품으면 1 에 가깝다 */
export function grantNameSimilarity(a: string, b: string): number {
  const x = normalizeGrantName(a)
  const y = normalizeGrantName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const bx = bigrams(x)
  const by = bigrams(y)
  let common = 0
  for (const [g, n] of bx) common += Math.min(n, by.get(g) ?? 0)
  const total = Math.max(1, x.length - 1) + Math.max(1, y.length - 1)
  const dice = (2 * common) / total
  // 짧은 쪽이 긴 쪽에 거의 다 들어 있으면(폴더 이름이 과제명을 줄여 쓴 경우) 높게 본다
  const [short, long] = x.length <= y.length ? [bx, y] : [by, x]
  let inside = 0
  let shortTotal = 0
  for (const [g, n] of short) {
    shortTotal += n
    if (long.includes(g)) inside += n
  }
  const containment = shortTotal >= 4 ? inside / shortTotal : 0
  return Math.max(dice, containment * 0.9)
}

export interface FolderCandidate {
  path: string
  name: string
  score: number
}

/** 비슷한 순서로 — 0.3 미만은 뺀다 */
export function rankFolders(
  title: string,
  folders: { path: string; name: string }[],
  extraTitles: string[] = []
): FolderCandidate[] {
  return folders
    .map((f) => ({
      ...f,
      score: Math.max(
        ...[title, ...extraTitles].map((t) => grantNameSimilarity(t, f.name))
      ),
    }))
    .filter((f) => f.score >= 0.3)
    .sort((a, b) => b.score - a.score)
}

/** 자동으로 이어도 될 만큼 확실한 폴더 — 0.62 이상이고 다음 후보보다 0.12 이상 앞설 때만(0.60 「소상공인 생활문화」→「도약 지원」 같은 오연결을 막는다) */
export function confidentFolder(
  ranked: FolderCandidate[]
): FolderCandidate | null {
  const [first, second] = ranked
  if (!first || first.score < 0.62) return null
  if (second && first.score - second.score < 0.12) return null
  return first
}
