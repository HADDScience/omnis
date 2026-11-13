// 글 없이 첨부만 보낸 글의 글자. 예전 화면은 본문에 「[파일 N개 첨부]」 를 넣어 보냈다(DB 에 그대로 남아 있다 — 고치지 않는다).
// 지금은 본문을 비워 보내고, 화면은 그 옛 자리글도 숨긴다. 목록 미리보기 · 답장 인용 · 푸시는 「파일 N개」 로 쓴다.
// 화면과 서버가 같이 쓴다 — 서버 전용 모듈을 들이지 않는다.

const PLACEHOLDER = /^\s*\[파일 (\d+)개 첨부\]\s*$/

/** 옛 자리글(「[파일 N개 첨부]」)이면 그 개수, 아니면 null */
export function attachPlaceholderCount(content: string): number | null {
  const m = PLACEHOLDER.exec(content)
  return m ? Number(m[1]) : null
}

/** 화면에 그릴 본문 — 옛 자리글은 빈 글로 */
export function visibleBody(content: string): string {
  return attachPlaceholderCount(content) === null ? content : ""
}

export const attachLabel = (n: number) => (n > 0 ? `파일 ${n}개` : "파일")

/**
 * 한 줄로 가리킬 때(답장 인용 · 푸시)의 글 — 본문이 있으면 그대로, 첨부만 있는 글이면 「파일 N개」.
 * fileCount 를 모르면(0) 옛 자리글의 숫자를 쓴다
 */
export function attachAwareText(content: string, fileCount = 0): string {
  const old = attachPlaceholderCount(content)
  if (old !== null) return attachLabel(fileCount || old)
  if (content.trim()) return content
  return fileCount > 0 ? attachLabel(fileCount) : content
}
