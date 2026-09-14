// route 방법론의 도구 — MCP 서버(lib/omnis-mcp.ts)의 읽기 도구를 그대로 쓴다.
//
// 쓰기 도구(post_message · create_task)와 ask_omnis(자기 자신)는 뺀다. 지식재산권 도구는 구성원
// 권한이 필요하므로 대신 현황 요약(buildIpOverview)을 ip_overview 로 감싼다.
//
// 벤더별 네이티브 함수 호출 대신 JSON 응답 프로토콜을 쓴다 — Gemma 처럼 함수 호출이 없는 모델도
// 같은 조건으로 비교하기 위해서다. 네이티브 함수 호출은 다음 축이다(계획서 "범위 밖").
import { OMNIS_TOOLS, runTool, type Caller, type ToolResult } from "@/lib/omnis-mcp"
import { buildIpOverview } from "@/lib/omnis-ask"

const EXCLUDE = new Set(["ask_omnis", "post_message", "create_task"])

export interface BenchTool {
  name: string
  description: string
  inputSchema: unknown
}

export const BENCH_TOOLS: BenchTool[] = [
  ...OMNIS_TOOLS.filter((t) => !EXCLUDE.has(t.name)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  {
    name: "ip_overview",
    description: "상표·특허 전량 한 줄 요약과 우리 차례로 남은 지식재산권 업무. 상표·특허·출원·등록을 물으면 쓴다.",
    inputSchema: { type: "object", properties: {} },
  },
]

export async function runBenchTool(name: string, args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  if (name === "ip_overview") return { text: (await buildIpOverview()) || "지식재산권 자료가 없습니다." }
  if (EXCLUDE.has(name) || !BENCH_TOOLS.some((t) => t.name === name)) return { error: `벤치에서 열지 않은 도구입니다: ${name}` }
  return runTool(name, args, caller)
}

export function toolCatalog(): string {
  return BENCH_TOOLS.map((t) => `- ${t.name}: ${t.description}\n  args: ${JSON.stringify(t.inputSchema)}`).join("\n")
}

export function routeSystemPrompt(today: string): string {
  return `당신은 HADD Science 의 사내 지식 비서 "옴니스" 입니다. 오늘은 ${today} 입니다.
직원의 질문에 답하려면 아래 도구를 골라 부르세요. 한 번에 도구 하나씩, 최대 5번까지 부를 수 있습니다.

도구:
${toolCatalog()}

응답 형식 — 반드시 JSON 객체 하나만, 마크다운 코드블록 없이:
- 도구를 부를 때: {"call": {"name": "<도구 이름>", "args": { ... }}}
- 최종 답을 낼 때: {"answer": "<한국어 답변. 항목이 여러 개면 마크다운 목록>"}

규칙:
- 대화 내용·진행 상황·"누가 뭐라고 했나" 는 search_knowledge 로 찾으세요. 사람 이름·기관명·제품명처럼 고유명사가 있으면 그것을 query 에 넣으세요.
- 업무 목록·마감·지연·담당자는 list_tasks, 한 업무의 체크리스트·최근 대화는 get_task 를 쓰세요.
- 재고·견적·샘플·거래 기관은 crm_overview 또는 find_org, 상표·특허는 ip_overview, 정리된 지식은 list_omnis_cards → get_omnis_card 를 쓰세요.
- 도구 결과에 있는 내용만으로 답하세요. 결과에 없으면 추측하지 말고 "관련 내용을 찾지 못했습니다" 라고 답하세요.
- 첫 도구 결과로 충분하면 바로 답하세요. 부족할 때만 더 부르세요.`
}

/** 모델 응답에서 JSON 객체 하나를 뽑는다. 코드블록·앞뒤 잡담을 허용한다 */
export function parseRouteReply(text: string): { call?: { name: string; args?: Record<string, unknown> }; answer?: string } | null {
  const cleaned = text.replace(/```(?:json)?/g, "").trim()
  const start = cleaned.indexOf("{")
  if (start < 0) return null
  // 가장 바깥 중괄호 쌍을 찾는다 — 답변 본문에 중괄호가 섞여도 첫 객체를 잡는다.
  let depth = 0
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++
    else if (cleaned[i] === "}") {
      depth--
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}
