// Claude Code 헤드리스(`claude -p`) 호출 — 심판을 작업지시자의 Claude 구독으로 돌린다.
//
// 같은 방식의 헬퍼가 import-tools/kakao-common.ts askClaude 에 있지만 그 파일은 import 하는 순간
// PrismaClient 를 만든다. 심판은 DB 가 필요 없어 여기 따로 둔다.
//
// 구독 인증을 강제하는 장치:
//   - env 에서 ANTHROPIC_API_KEY · ANTHROPIC_AUTH_TOKEN 을 지운다. 키가 남아 있으면 claude 가 그 키로
//     API 를 불러 **API 요금이 청구된다**. bench 는 dotenv 로 .env 를 읽고 .env 에 ANTHROPIC_API_KEY 가 있다.
//   - stream-json 첫 줄(init)의 apiKeySource 가 "none" 이 아니면 오류로 멈춘다 (키로 돌았다는 뜻).
// 맥락 차단: --tools "" (내장 도구 없음) · --strict-mcp-config (claude.ai 커넥터 Gmail·Drive 등도 안 붙음) ·
//   --setting-sources "" (사용자·프로젝트 설정·훅 안 읽음) · cwd 는 os.tmpdir() 아래 빈 폴더 (CLAUDE.md 가 안 낀다).
import { execFile } from "child_process"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { Usage } from "./providers"

/** 구독 사용량 한도(5시간 창 등)에 걸렸다. 다음 호출도 실패하므로 멈추고 나중에 이어 돌린다 */
export class ClaudeLimitError extends Error {}

const LIMIT_RE = /usage limit|rate.?limit|limit reached|limit will reset|resets? at|\b429\b/i

export interface ClaudeCliResult {
  text: string
  usage: Usage
  ms: number
  /** total_cost_usd — API 요금표로 환산한 값. 구독이라 실제 청구는 없다 */
  notionalUsd: number
  apiKeySource: string
  model: string
}

let emptyCwd: string | null = null

export function claudeCli(prompt: string, opts: { model: string; system: string; timeoutMs?: number }): Promise<ClaudeCliResult> {
  emptyCwd ??= mkdtempSync(join(tmpdir(), "bench-judge-"))
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // Claude Code 안에서 돌리면 CLAUDECODE 가 물려받아 중첩 실행을 막는다 (kakao-common.ts 와 같은 처리)
  delete env.CLAUDECODE
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", "--model", opts.model,
    "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence",
    "--system-prompt", opts.system,
  ]
  const t0 = performance.now()
  return new Promise((resolve, reject) => {
    const child = execFile("claude", args, { env, cwd: emptyCwd!, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 10 * 60 * 1000 }, (err, stdout, stderr) => {
      let init: { apiKeySource?: string; model?: string } = {}
      let result: { result?: string; is_error?: boolean; api_error_status?: number | null; total_cost_usd?: number; usage?: Record<string, number> } | null = null
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue
        try {
          const d = JSON.parse(line)
          if (d.type === "system" && d.subtype === "init") init = d
          if (d.type === "result") result = d
        } catch { /* 줄 단위 JSON 이 아닌 출력은 무시 */ }
      }
      if (init.apiKeySource && init.apiKeySource !== "none") {
        return reject(new Error(`claude 가 구독이 아닌 API 키(${init.apiKeySource})로 돌았다 — 청구가 생긴다. env 를 확인할 것`))
      }
      const errText = `${result?.result ?? ""} ${stderr} ${err?.message ?? ""}`
      if (LIMIT_RE.test(errText) && (err || result?.is_error || !result)) return reject(new ClaudeLimitError(errText.trim().slice(0, 300)))
      if (!result) return reject(new Error(`claude 실패: ${err?.message ?? "결과 줄 없음"}\n${stderr.slice(0, 300)}`))
      if (result.is_error) return reject(new Error(`claude 오류 응답(${result.api_error_status ?? "?"}): ${String(result.result).slice(0, 300)}`))
      const u = result.usage ?? {}
      const cacheRead = u.cache_read_input_tokens ?? 0
      resolve({
        text: result.result ?? "",
        usage: { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + cacheRead, output: u.output_tokens ?? 0, thinking: 0, cached: cacheRead },
        ms: performance.now() - t0,
        notionalUsd: result.total_cost_usd ?? 0,
        apiKeySource: init.apiKeySource ?? "?",
        model: init.model ?? opts.model,
      })
    })
    child.stdin?.end(prompt)
  })
}
