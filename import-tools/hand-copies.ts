// 손으로 옮긴 사본과 카톡 원본의 짝 맞추기.
//
// 9/5 이후 카톡 대화 일부를 사람이 구성원 계정으로 옴니스에 옮겨 적었다. 이 사본에는 sourceId 가 없어
// 멱등 키로는 걸러지지 않는다. 같은 사람 · 시간 순서가 맞고 본문이 겹치는 것만 사본으로 본다.
// 사본은 옮긴 시각에 찍히므로 카톡 시각보다 늦고, 옮기는 데 사흘을 넘기지 않았다.
//
// 옮길 때 연달아 쓴 카톡 몇 줄을 한 글로 합친 경우가 많다(「회의 자료입니다!」 + 「검토 후 의견 주세요~~」).
// 그래서 같음 말고도 "카톡 한 줄이 사본 안에 들어 있음" 을 짝으로 본다. 짧은 말("네")은 아무 글에나
// 들어 있으므로 포함 판정은 CONTAIN_MIN 글자 이상일 때만 한다. 짧은 말은 완전히 같을 때만, 하나와만 짝짓는다.

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000
const CONTAIN_MIN = 8

export interface KakaoSide { sourceId: string; authorId: string; content: string; createdAt: Date }
export interface CopySide { id: string; authorId: string; content: string; createdAt: Date }

/** 옮기면서 붙인 `/업무` · `#슬러그` · `@이름` 과 첨부 표시를 떼고 공백을 지운다. */
export function normalizeForCopy(s: string): string {
  return s
    .replace(/^(?:\s*(?:\/업무|#\S+|@\S+))+/, "")
    .replace(/\s*\[(?:첨부|파일 \d+개 첨부)[^\]]*\]\s*$/, "")
    .replace(/\s+/g, "")
}

/**
 * 사본과 짝이 맞는 카톡 메시지의 sourceId 와, 하나도 짝을 못 찾은 사본을 돌려준다.
 * 카톡 메시지 하나는 사본 하나에만 쓰인다.
 */
export function matchHandCopies(kakao: KakaoSide[], copies: CopySide[]): { skip: Set<string>; unmatched: CopySide[] } {
  const byAuthor = new Map<string, { k: KakaoSide; n: string }[]>()
  for (const k of kakao) {
    const n = normalizeForCopy(k.content)
    if (n) byAuthor.set(k.authorId, [...(byAuthor.get(k.authorId) ?? []), { k, n }])
  }
  const skip = new Set<string>()
  const unmatched: CopySide[] = []
  for (const c of [...copies].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const cn = normalizeForCopy(c.content)
    const near = (byAuthor.get(c.authorId) ?? [])
      .filter(({ k }) => !skip.has(k.sourceId))
      .filter(({ k }) => { const d = c.createdAt.getTime() - k.createdAt.getTime(); return d >= 0 && d <= WINDOW_MS })
      .sort((a, b) => b.k.createdAt.getTime() - a.k.createdAt.getTime())
    if (!cn) { unmatched.push(c); continue }
    const same = near.find(({ n }) => n === cn)
    const contained = near.filter(({ n }) => n !== cn && (
      (n.length >= CONTAIN_MIN && cn.includes(n)) || (cn.length >= CONTAIN_MIN && n.includes(cn))
    ))
    const hits = [...(same ? [same] : []), ...contained]
    if (hits.length === 0) { unmatched.push(c); continue }
    for (const { k } of hits) skip.add(k.sourceId)
  }
  return { skip, unmatched }
}
