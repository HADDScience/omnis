// 옴니스 에이전트의 작업용 컴퓨터 도구 3개 — 카드 모양(미리보기)과 확인 뒤 실행. lib/agent/outputs.ts 가 결과물 도구로 묶어 부른다.
//   start_workbench     「작업용 컴퓨터로 넘길까요? 예상 약 1,100원」 → [시작]
//   continue_workbench  상한에 닿아 멈춘 작업에 상한을 한 번 더 → [계속]
//   stop_workbench      도는 작업을 멈추고 그때까지 만든 파일을 받는다 → [멈춤]
// 셋 다 WORKBENCH_USER_IDS 에 든 사람에게만 보인다(lib/agent/tools.ts agentToolSpecs).
import type { AgentToolSpec, WritePreview } from "@/lib/agent/tools"
import { workbenchConfig, workbenchEnabledFor } from "./config"
import { estimateKrw, type TaskSize } from "./pricing"

export const WORKBENCH_TOOLS = ["start_workbench", "continue_workbench", "stop_workbench"] as const
export type WorkbenchTool = (typeof WORKBENCH_TOOLS)[number]
export const isWorkbenchTool = (n: string): n is WorkbenchTool => (WORKBENCH_TOOLS as readonly string[]).includes(n)

const SUFFIX = " — 쓰기 도구다. 부르면 바로 실행되지 않고 사용자에게 확인 카드가 뜬다. 사용자가 확인한 뒤에만 실행된다."

export const WORKBENCH_TOOL_SPECS: AgentToolSpec[] = [
  {
    name: "start_workbench",
    description:
      "작업용 컴퓨터(리눅스 · LibreOffice · python-pptx · pypdf · 한글 글꼴)에 일을 넘긴다. 여러 자료를 모아 PDF · PPT · 표를 만들거나, 파일을 바꾸고 합치고 렌더해 확인해야 하는 일에 쓴다. " +
      "질문 · 검색 · 짧은 기록 · 단순한 docx/xlsx/pptx 한 장은 이 도구가 아니라 직접 하거나 create_file 로 한다(작업용 컴퓨터는 1건에 수백~수천 원이 든다). " +
      "request 에는 사용자가 한 말 그대로와, 지금까지 옴니스에서 찾은 자료의 위치(업무 슬러그 · 파일 ID · 날짜)를 함께 적는다 — 작업용 컴퓨터도 옴니스를 읽을 수 있지만 같은 것을 다시 찾느라 비용이 든다. " +
      "개인정보(주민번호 · 연락처 · 지원자 서류)와 기밀은 넣지 않는다. 결과 파일은 이 방에 붙는다. 발송 · 기록 바꾸기 · NAS 저장은 작업용 컴퓨터가 하지 않고 요청만 남긴다." +
      SUFFIX,
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "카드에 보일 한 줄(예: 「12/1 면접 지원자 묶음 PDF」)" },
        request: { type: "string", description: "작업용 컴퓨터에게 줄 지시 전체 — 사용자 말 그대로 + 찾은 자료 위치 + 결과 파일 모양" },
        size: { type: "string", enum: ["light", "standard", "heavy"], description: "light 파일 1개 간단히 · standard 자료 몇 개 모아 PDF/PPT · heavy 10장 넘는 PPT, 여러 번 렌더" },
      },
      required: ["title", "request", "size"],
    },
    risk: "write",
  },
  {
    name: "continue_workbench",
    description: "작업용 컴퓨터 작업이 1건 상한에 닿아 멈췄을 때, 상한을 한 번 더 주고 이어 가게 한다. 사용자가 「작업 계속」 이라고 하면 부른다." + SUFFIX,
    schema: { type: "object", properties: {} },
    risk: "write",
  },
  {
    name: "stop_workbench",
    description: "도는(또는 상한에 닿아 멈춘) 작업용 컴퓨터 작업을 멈춘다. 그때까지 만든 파일은 이 방에 붙이고 세션을 지운다. 사용자가 「작업 멈춰」 라고 하면 부른다." + SUFFIX,
    schema: { type: "object", properties: {} },
    risk: "write",
  },
]

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export async function workbenchPreview(name: WorkbenchTool, args: Record<string, unknown>, ctx: { userId: string }): Promise<WritePreview> {
  const c = workbenchConfig()
  const off = workbenchEnabledFor(ctx.userId, c) ? undefined : "작업용 컴퓨터가 이 계정에 켜져 있지 않습니다"
  const { monthSpend, grantBudget, liveJobOf } = await import("./service")
  if (name === "start_workbench") {
    const size = (["light", "standard", "heavy"].includes(str(args.size)) ? str(args.size) : "standard") as TaskSize
    const request = str(args.request)
    const spend = off ? { userKrw: 0, companyKrw: 0 } : await monthSpend(ctx.userId)
    const g = grantBudget(c, spend)
    const busy = off ? null : await liveJobOf(ctx.userId)
    return {
      title: "작업용 컴퓨터로 넘길까요?",
      target: str(args.title) || "(제목 없음)",
      changes: [
        { label: "맡길 일", before: null, after: request.length > 600 ? `${request.slice(0, 600)}…` : request || "(없음)" },
        { label: "예상 비용", before: null, after: `약 ${won(estimateKrw(size, c.model))} (${c.model}, 실측 전 가정)` },
        { label: "1건 상한", before: null, after: g.ok ? `${won(g.budgetKrw)} — 넘으면 멈추고 계속할지 묻습니다` : "—" },
        { label: "이번 달 쓴 것", before: null, after: `나 ${won(spend.userKrw)} / ${won(c.userMonthlyKrw)} · 회사 ${won(spend.companyKrw)} / ${won(c.companyMonthlyKrw)}` },
      ],
      confirmLabel: "시작",
      risk:
        "Anthropic 의 작업용 컴퓨터(미국)가 내 권한으로 옴니스를 읽습니다(읽기만). 맡길 일에 개인정보 · 기밀을 넣지 마세요. " +
        "발송 · 기록 바꾸기 · NAS 저장은 하지 않고, 끝나면 세션을 지웁니다.",
      ...(off ? { problem: off } : !request ? { problem: "맡길 일이 비었습니다" } : busy ? { problem: "이미 도는 작업이 있습니다" } : !g.ok ? { problem: g.reason } : {}),
    }
  }
  const job = off ? null : await liveJobOf(ctx.userId)
  if (name === "continue_workbench") {
    return {
      title: "작업용 컴퓨터 작업을 이어 갈까요?",
      target: job ? `작업 ${job.id.slice(0, 8)}` : "(없음)",
      changes: [
        { label: "지금까지", before: null, after: job ? won(Number(job.costKrw)) : "—" },
        { label: "더할 상한", before: null, after: won(c.taskLimitKrw) },
      ],
      confirmLabel: "계속",
      risk: "상한만큼 비용이 더 들 수 있습니다.",
      ...(off ? { problem: off } : !job || job.status !== "NEEDS_BUDGET" ? { problem: "상한에 닿아 멈춘 작업이 없습니다" } : {}),
    }
  }
  return {
    title: "작업용 컴퓨터 작업을 멈출까요?",
    target: job ? `작업 ${job.id.slice(0, 8)}` : "(없음)",
    changes: [{ label: "그때까지 만든 파일", before: null, after: "이 방에 붙이고 세션을 지웁니다" }],
    confirmLabel: "멈춤",
    risk: "멈춘 작업은 다시 이어 갈 수 없습니다.",
    ...(off ? { problem: off } : !job ? { problem: "도는 작업이 없습니다" } : {}),
  }
}

export async function executeWorkbench(name: WorkbenchTool, args: Record<string, unknown>, ctx: { userId: string; roomId: string; runId: string }): Promise<{ ok: boolean; text: string }> {
  const svc = await import("./service")
  if (name === "start_workbench") {
    const title = str(args.title)
    const request = str(args.request)
    if (!request) return { ok: false, text: "맡길 일이 비었습니다" }
    return svc.startWorkbench({ request: title ? `# ${title}\n\n${request}` : request }, ctx)
  }
  if (name === "continue_workbench") return svc.continueWorkbench(ctx)
  return svc.stopWorkbench(ctx)
}
