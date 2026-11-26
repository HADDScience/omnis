/**
 * 작업용 컴퓨터 — Managed Agents 에이전트 · 환경을 만든다(한 번). 나온 ID 를 WORKBENCH_AGENT_ID · WORKBENCH_ENVIRONMENT_ID 에 넣는다.
 *
 *   WORKBENCH_ANTHROPIC_API_KEY=… WORKBENCH_MCP_URL=https://omnis.haddscience.com/api/ip-mcp npx tsx scripts/workbench-setup.ts
 *   … --no-mcp        옴니스 MCP 없이(로컬 시범용 — 옴니스가 공개 주소에 없을 때)
 *   … --agent agent_… 이미 있는 에이전트를 새 버전으로 고친다(지침 · 도구 목록이 바뀌었을 때). 진행 중인 세션은 옛 버전 그대로
 *
 * 키는 출력하지 않는다. 회사 계정으로 옮길 때는 키만 바꿔 이것을 다시 돌린다(에이전트 · 환경은 키의 작업 공간에 속한다).
 */
import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"
import { agentParams, environmentParams } from "@/lib/workbench/definitions"
import { workbenchConfig } from "@/lib/workbench/config"

async function main() {
  const c = workbenchConfig()
  const apiKey = c.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("WORKBENCH_ANTHROPIC_API_KEY 가 없습니다")
  const client = new Anthropic({ apiKey })
  const noMcp = process.argv.includes("--no-mcp")
  const agentArg = process.argv.indexOf("--agent")
  const existing = agentArg > 0 ? process.argv[agentArg + 1] : null
  const mcpUrl = noMcp ? null : c.mcpUrl
  if (!noMcp && !mcpUrl) throw new Error("WORKBENCH_MCP_URL(또는 PUBLIC_URL)이 없습니다. 로컬 시범이면 --no-mcp")

  const env = c.environmentId && !process.argv.includes("--new-env") ? await client.beta.environments.retrieve(c.environmentId) : await client.beta.environments.create(environmentParams())
  const def = agentParams({ model: c.model, mcpUrl })
  const agent = existing
    ? await client.beta.agents.update(existing, { ...def, version: (await client.beta.agents.retrieve(existing)).version } as never)
    : await client.beta.agents.create(def)
  console.log(JSON.stringify({ WORKBENCH_ENVIRONMENT_ID: env.id, WORKBENCH_AGENT_ID: agent.id, agentVersion: agent.version, model: c.model, mcp: mcpUrl ?? "없음" }, null, 1))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
