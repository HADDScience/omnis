// 작업용 컴퓨터 — 에이전트 · 환경 정의(만드는 것은 scripts/workbench-setup.ts 한 번, 세션은 저장된 ID 로).
// Managed Agents 문서: platform.claude.com/docs/en/managed-agents/{environments,tools,agent-setup}(2026-11-26 확인).
import type Anthropic from "@anthropic-ai/sdk"
import { ASK_READ_NAMES, toolPolicy } from "@/lib/tools/registry"
import { COMPANY_GUIDELINES } from "./guidelines"

/** 옴니스 MCP 서버 이름 — 에이전트 정의와 vault 자격이 이 이름 · 주소로 맞물린다 */
export const OMNIS_MCP_NAME = "omnis"

/**
 * 샌드박스에 여는 옴니스 MCP 도구 — 읽기만.
 * 기준은 질문 경로(ask: "read")와 같다: 여러 사람이 볼 수 있는 자리에 답이 붙어도 되는 도구만 연다(1:1 · 단톡 방, 개인 질문 기록, 채용 · 관리 설정은 빠진다).
 * 0·1단계는 개인정보를 보내지 않는다는 결정(decisions-v3 4번)을 도구 목록으로 지킨다.
 * - list_chat: MCP 판은 방 보기(view=room)가 열려 있어 뺀다(질문 경로는 스키마에서 닫는다)
 * - ask_omnis: 옴니스 AI 를 다시 불러 비용이 겹친다 — MCP 전용이라 애초에 ask 목록에 없다
 * - search_knowledge · ip_overview: 질문 경로 전용 정의가 따로 있다. MCP 에는 search_knowledge 만 있다
 */
export const WORKBENCH_MCP_TOOLS: readonly string[] = ASK_READ_NAMES.filter(
  (n) => n !== "list_chat" && n !== "ip_overview" && toolPolicy(n)?.mcp === true && toolPolicy(n)?.agent === "read"
)

export const ENVIRONMENT_NAME = "omnis-workbench"

/** 네트워크는 limited — 옴니스 MCP(allow_mcp_servers)와 패키지 저장소만. 한글 글꼴 · HWPX 도구를 미리 깐다(2026-11-26 실측: pyhwp 는 pip 설치 실패라 뺐다) */
export function environmentParams(): Anthropic.Beta.EnvironmentCreateParams {
  return {
    name: ENVIRONMENT_NAME,
    description: "옴니스 작업용 컴퓨터 — 문서 만들기(LibreOffice · python-pptx · pypdf · 한글 글꼴)",
    config: {
      type: "cloud",
      networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: true },
      packages: { apt: ["fonts-nanum", "fonts-nanum-extra", "fonts-noto-cjk", "poppler-utils"], pip: ["python-hwpx"] },
    },
  }
}

export interface AgentDefOptions {
  model: string
  /** 없으면 MCP 를 붙이지 않는다(로컬 시험 — 옴니스가 공개 주소에 없을 때) */
  mcpUrl: string | null
}

export function agentParams(o: AgentDefOptions): Anthropic.Beta.AgentCreateParams {
  return {
    name: "omnis-workbench",
    description: "옴니스 작업용 컴퓨터 — 요청자 권한으로 옴니스를 읽고 파일을 만든다",
    model: o.model,
    system: COMPANY_GUIDELINES,
    ...(o.mcpUrl ? { mcp_servers: [{ type: "url" as const, name: OMNIS_MCP_NAME, url: o.mcpUrl }] } : {}),
    tools: [
      {
        type: "agent_toolset_20260401",
        // 샌드박스 안의 명령 · 파일은 바로 돈다. 바깥 통신은 환경의 limited 네트워크가 막는다
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        configs: [
          { name: "web_fetch", enabled: false },
          { name: "web_search", enabled: false },
        ],
      },
      ...(o.mcpUrl
        ? [
            {
              type: "mcp_toolset" as const,
              mcp_server_name: OMNIS_MCP_NAME,
              // 허용 목록 방식 — 서버에 도구가 더 생겨도 여기 적은 것만 열린다. 옴니스 서버도 이 세션 토큰의 쓰기를 따로 막는다(lib/omnis-mcp.ts)
              default_config: { enabled: false, permission_policy: { type: "always_allow" as const } },
              configs: WORKBENCH_MCP_TOOLS.map((name) => ({ name, enabled: true })),
            },
          ]
        : []),
    ],
  } as Anthropic.Beta.AgentCreateParams
}
