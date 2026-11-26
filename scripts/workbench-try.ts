/**
 * 작업용 컴퓨터 로컬 시범 — DB · 옴니스 없이 lib/workbench/runner.ts 를 실제 Managed Agents 로 끝까지 한 번 돌린다.
 * 채팅방 대신 화면에 출력하고, 결과 파일은 OUT 폴더에 받는다. 데이터는 가짜만 쓴다(지원자 2명 · 기관 · 날짜 모두 지어낸 값).
 *
 *   WORKBENCH_ANTHROPIC_API_KEY=… WORKBENCH_AGENT_ID=… WORKBENCH_ENVIRONMENT_ID=… OUT=/tmp/wb npx tsx scripts/workbench-try.ts
 *
 * 비용 상한은 WORKBENCH_TASK_LIMIT_KRW(기본 3,000원)이 세션 예산으로 걸린다. 키는 출력하지 않는다.
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { workbenchConfig } from "@/lib/workbench/config"
import { anthropicWorkbenchApi, workbenchClient } from "@/lib/workbench/api"
import { finishJob, openJob, pumpJob, type Job, type JobStore } from "@/lib/workbench/runner"

const FAKE_REQUEST = `# 12/1 인턴 면접 지원자 묶음 PDF (시험 — 모든 값은 가짜다)

아래 가짜 지원자 2명으로 면접용 묶음 PDF 를 만들어 /mnt/session/outputs/ 에 둔다. 옴니스 도구는 쓰지 않는다(이번 시험에는 연결돼 있지 않다).

- 표지 1쪽: 「2026 하계 인턴 면접 자료」, 일시 2026-12-01(월) 14:00, 장소 「광교 시험센터 8층 회의실」(가짜), 지원자 2명 목록
- 지원자마다 프로필 1쪽: 이름 · 지원 분야 · 학교/전공 · 한 줄 소개 · 면접 질문 3개(아래 내용으로)
  1) 가나다(가짜) — 바이오 소재 연구, ○○대 생명공학과 3학년, 「하이드로젤 배양 실험을 1년 했습니다」
  2) 라마바(가짜) — 데이터 분석, △△대 통계학과 4학년, 「실험 데이터 자동 정리 도구를 만들었습니다」
- 글꼴은 NanumSquare, A4 세로. 책갈피(표지 · 지원자별)를 단다.
- 결과: interview-pack.pdf (3쪽) 와 첫 쪽 미리보기 interview-pack-p1.png
- 다 만든 뒤 pdffonts 로 글꼴이 들어갔는지, 쪽수가 3인지 확인하고 마지막 답에 적는다.`

async function main() {
  const c = workbenchConfig()
  if (!c.apiKey || !c.agentId || !c.environmentId) throw new Error("키 · 에이전트 · 환경 ID 가 필요합니다")
  const out = process.env.OUT ?? "/tmp/workbench-try"
  fs.mkdirSync(out, { recursive: true })
  const jobs = new Map<string, Job & { extra?: unknown }>()
  const job: Job = {
    id: "try-" + Date.now(), userId: "local", roomId: "local", request: FAKE_REQUEST, model: c.model, status: "QUEUED", budgetKrw: c.taskLimitKrw,
    sessionId: null, vaultId: null, tokenId: null, cursor: null, lastMessage: null, startedAt: null, costKrw: 0,
  }
  jobs.set(job.id, job)
  const log: string[] = []
  const t0 = Date.now()
  const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`
  const store: JobStore = {
    async get(id) { return { ...jobs.get(id)! } },
    async patch(id, d) {
      const cur = jobs.get(id)!
      const { cost, error, finishedAt, outputFileIds, ...rest } = d
      jobs.set(id, { ...cur, ...rest, ...(cost ? { costKrw: cost.krw } : {}), extra: { cost, error, finishedAt, outputFileIds } })
    },
    async post(_j, text) { const l = `${stamp()} ${text}`; log.push(l); console.log(l) },
    async saveOutput(_j, f) { fs.writeFileSync(path.join(out, f.name), f.bytes); return { ok: true, fileId: f.name } },
    async recordUsage(_j, cost) { fs.writeFileSync(path.join(out, "usage.json"), JSON.stringify(cost, null, 1)) },
    async mintToken() { throw new Error("로컬 시범은 MCP 를 붙이지 않는다") },
    async revokeToken() {},
  }
  const deps = { api: anthropicWorkbenchApi(workbenchClient(c.apiKey)), store, agentId: c.agentId, environmentId: c.environmentId, mcpUrl: null, krwPerUsd: c.krwPerUsd, maxMinutes: c.maxMinutes }
  const opened = await openJob(job.id, deps)
  if (!opened.ok) throw new Error("세션을 열지 못했습니다")
  let status = ""
  for (let i = 0; i < 1000; i++) {
    const r = await pumpJob(job.id, deps)
    if (r.state === "running") { await new Promise((res) => setTimeout(res, 5000)); continue }
    status = await finishJob(job.id, r.state === "timeout" ? "timeout" : r.outcome, deps)
    break
  }
  const final = jobs.get(job.id)!
  fs.writeFileSync(path.join(out, "progress.log"), log.join("\n"))
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ status, seconds: Math.round((Date.now() - t0) / 1000), model: c.model, job: { ...final, request: undefined } }, null, 1))
  console.log(JSON.stringify({ status, seconds: Math.round((Date.now() - t0) / 1000), costKrw: final.costKrw, out }))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
