// 옴니스 답의 사진 묶음 — 카톡의 「묶어 보내기」처럼 여러 장을 한 덩어리 격자로 보인다.
// 화면(components/omnis/photo-album.tsx)이 쓰는 순수 함수만 여기 둔다. 실행: pnpm test:unit

/**
 * 한 줄에 몇 장씩 놓을지. 카톡처럼 3장 줄을 기본으로 하고, 남는 것은 2장 줄로 채운다 —
 * 1장만 남는 줄은 그 한 장이 혼자 커져 묶음이 어색해진다.
 *   1 → [1] · 2 → [2] · 4 → [2, 2] · 5 → [3, 2] · 7 → [3, 2, 2] · 9 → [3, 3, 3]
 */
export function albumRows(n: number): number[] {
  if (n <= 0) return []
  if (n <= 3) return [n]
  const rows: number[] = []
  let left = n
  if (left % 3 === 1) { rows.push(2, 2); left -= 4 }
  else if (left % 3 === 2) { rows.push(2); left -= 2 }
  return [...Array(left / 3).fill(3), ...rows]
}

/** 각주 토큰 — [1] · [1, 2] · [7-9]. components/omnis/omnis-ask.tsx 의 CITE_TOKEN 과 같은 모양 */
const CITE = /\[(\d+(?:\s*[,，~–-]\s*\d+)*)\]/g

/** 답 본문이 각주로 가리킨 번호(1부터). 범위가 20을 넘으면 연도 같은 것으로 보고 버린다 */
export function citedNumbers(answer: string, max: number): Set<number> {
  const out = new Set<number>()
  for (const m of answer.matchAll(CITE)) {
    const nums: number[] = []
    let ok = true
    for (const part of m[1].split(/\s*[,，]\s*/)) {
      const range = /^(\d+)\s*[~–-]\s*(\d+)$/.exec(part)
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])]
        if (b < a || b - a > 20) { ok = false; break }
        for (let k = a; k <= b; k++) nums.push(k)
      } else nums.push(Number(part))
    }
    if (ok && nums.every((k) => k >= 1 && k <= max)) nums.forEach((k) => out.add(k))
  }
  return out
}

/**
 * 묶음에 넣을 사진 — 답이 각주로 가리킨 사진만, 출처 순서대로.
 * 검색은 됐지만 답이 버린 사진(도면 · 남의 회사 부스)까지 띄우면 묶음이 질문과 어긋난다.
 * 답이 사진을 하나도 가리키지 않으면 묶음을 그리지 않는다.
 */
export function albumPhotos<T extends { source: string }>(answer: string, sources: T[]): { photo: T; num: number }[] {
  const cited = citedNumbers(answer, sources.length)
  return sources
    .map((s, i) => ({ photo: s, num: i + 1 }))
    .filter(({ photo, num }) => photo.source === "PHOTO" && cited.has(num))
}
