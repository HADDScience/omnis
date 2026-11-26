// WorkbenchApi 의 운영 구현 — @anthropic-ai/sdk 의 Managed Agents(beta). 베타 헤더 managed-agents-2026-04-01 은 SDK 가 붙인다.
// 세션 범위 파일 목록(scope_id)만은 client.beta.files 가 헤더를 붙이지 않아 betas 로 넘긴다(claude-api 스킬 managed-agents-environments).
import Anthropic from "@anthropic-ai/sdk"
import type { EventLike } from "./progress"
import type { OutputFile, WorkbenchApi } from "./runner"

const MA_BETA = "managed-agents-2026-04-01"

export function workbenchClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

export function anthropicWorkbenchApi(client: Anthropic): WorkbenchApi {
  return {
    async createVault(displayName) {
      const v = await client.beta.vaults.create({ display_name: displayName })
      return { id: v.id }
    },
    async addBearer(vaultId, mcpUrl, token) {
      await client.beta.vaults.credentials.create(vaultId, {
        display_name: "omnis MCP (요청자 단기 토큰)",
        auth: { type: "static_bearer", mcp_server_url: mcpUrl, token },
      })
    },
    async deleteVault(vaultId) {
      await client.beta.vaults.delete(vaultId)
    },
    async createSession(p) {
      const s = await client.beta.sessions.create({
        agent: p.agentId,
        environment_id: p.environmentId,
        title: p.title,
        ...(p.vaultIds.length ? { vault_ids: p.vaultIds } : {}),
        budget: { type: "limit", max_list_cost: { amount: p.budgetCents, currency: "USD" } },
        // 세션을 만드는 같은 호출에서 일을 시작한다(initial_events) — 따로 보내다 끊길 틈이 없다
        initial_events: [{ type: "user.message", content: [{ type: "text", text: p.text }] }],
      })
      return { id: s.id }
    },
    async listEvents(sessionId, after) {
      const out: EventLike[] = []
      for await (const e of client.beta.sessions.events.list(sessionId, { ...(after ? { "created_at[gt]": after } : {}), order: "asc" })) {
        out.push(e as unknown as EventLike)
        if (out.length >= 500) break
      }
      return out
    },
    async getSession(sessionId) {
      const s = await client.beta.sessions.retrieve(sessionId)
      return { status: s.status, usage: (s.usage ?? null) as never }
    },
    async setBudget(sessionId, cents) {
      await client.beta.sessions.update(sessionId, { budget: { type: "limit", max_list_cost: { amount: cents, currency: "USD" } } })
    },
    async interrupt(sessionId) {
      await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] })
    },
    async listOutputs(sessionId) {
      const out: OutputFile[] = []
      for await (const f of client.beta.files.list({ scope_id: sessionId, betas: [MA_BETA] })) {
        out.push({ id: f.id, filename: f.filename, size: f.size_bytes })
      }
      return out
    },
    async download(fileId) {
      const r = await client.beta.files.download(fileId)
      return Buffer.from(await r.arrayBuffer())
    },
    async deleteSession(sessionId) {
      await client.beta.sessions.delete(sessionId)
    },
  }
}
