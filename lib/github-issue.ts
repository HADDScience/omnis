/**
 * 운영 오류를 GitHub 이슈로 모은다(2026-09-17).
 *
 * 메일은 흘러가 버리고, 같은 오류가 몇 번 났는지·고쳤는지를 남길 자리가 없다. 이슈는 그 자리다.
 * 같은 오류는 이슈 하나에 모은다 — 열린 이슈 본문의 표식(`<!-- omnis-auto:지문 -->`)을 찾아
 * 있으면 댓글을 달고, 없으면 새로 연다. 닫힌 뒤 다시 나면 새 이슈가 열린다(고친 줄 알았는데 재발).
 *
 * **저장소(HADDScience/omnis)가 공개다.** 이 모듈로 들어오는 글에 사람 이름·파일명·업무명·NAS 경로를
 * 넣지 않는다. 그런 것은 메일에만 적는다(`app/api/errors/route.ts`).
 *
 * 필요한 환경변수 — 없으면 건너뛴다.
 *   GITHUB_ISSUE_TOKEN  이슈 쓰기 권한만 있는 fine-grained 토큰 (Issues: Read and write)
 *   GITHUB_ISSUE_REPO   owner/name. 없으면 HADDScience/omnis
 */
import { createHash } from "crypto"

type IssueResult =
  | { filed: "opened" | "commented"; url: string }
  | { filed: false; reason: "unconfigured" | "failed"; detail?: string }

const LABEL = "bug"

export function githubIssueConfigured(): boolean {
  return Boolean(process.env.GITHUB_ISSUE_TOKEN)
}

/** 같은 오류를 가르는 지문. 사람·파일마다 달라지는 값이 들어가지 않게 부르는 쪽이 다듬어서 준다 */
export function issueFingerprint(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12)
}

/**
 * 공개 저장소에 적어도 되는 모양으로 다듬는다.
 * 「파일명」 · ` — ` 뒤의 설명 · NAS 경로 · UUID 를 걷어낸다. 화면이 만든 문구는 이 모양을 따른다.
 */
export function redactForPublic(text: string): string {
  return text
    .replace(/「[^」]*」/g, "「…」")
    .replace(/\s—\s[\s\S]*$/, "")
    .replace(/\/HADD Science\/\S*/g, "(NAS 경로)")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_ISSUE_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    // 오류를 알리다 요청이 늘어지지 않게 — 메일은 이미 따로 나간다
    signal: AbortSignal.timeout(8000),
  })
}

export async function fileIssue(input: {
  fingerprint: string
  title: string
  /** 새 이슈 본문 (표식은 여기서 붙인다) */
  body: string
  /** 이미 열린 이슈가 있을 때 달 댓글 */
  comment: string
}): Promise<IssueResult> {
  if (!githubIssueConfigured()) return { filed: false, reason: "unconfigured" }
  const repo = process.env.GITHUB_ISSUE_REPO || "HADDScience/omnis"
  const marker = `<!-- omnis-auto:${input.fingerprint} -->`

  try {
    const list = await gh(`/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100`)
    if (!list.ok) return { filed: false, reason: "failed", detail: `목록 ${list.status}: ${await list.text()}` }
    const open = (await list.json()) as { number: number; html_url: string; body: string | null; pull_request?: unknown }[]
    const existing = open.find((i) => !i.pull_request && i.body?.includes(marker))

    if (existing) {
      const res = await gh(`/repos/${repo}/issues/${existing.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: input.comment }),
      })
      if (!res.ok) return { filed: false, reason: "failed", detail: `댓글 ${res.status}: ${await res.text()}` }
      return { filed: "commented", url: existing.html_url }
    }

    const res = await gh(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: input.title, body: `${marker}\n${input.body}`, labels: [LABEL] }),
    })
    if (!res.ok) return { filed: false, reason: "failed", detail: `생성 ${res.status}: ${await res.text()}` }
    return { filed: "opened", url: ((await res.json()) as { html_url: string }).html_url }
  } catch (err) {
    return { filed: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) }
  }
}
