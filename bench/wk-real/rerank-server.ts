// 실물 WeKnora 용 Gemini 리랭크 서버 — 실험 중에만 켠다.
//
//   npx tsx bench/wk-real/rerank-server.ts        # 127.0.0.1:8583, 토큰은 $WK_LAB_DIR/rerank-token
//
// 왜: WeKnora v0.8.2 의 스마트 추론은 search_knowledge 를 쓰려면 rerank 모델을 반드시 요구한다. Gemini 공급자에는 rerank 모델이 없다.
// 다른 벤더를 붙이지 않고, R3(bench/wk/search.ts)와 같은 gemini-3.5-flash-lite listwise 리랭크(llmRerank)를
// WeKnora 가 아는 rerank API 모양으로 감싼다 (작업지시자 결정 2026-10-07).
//
// 형식: WeKnora generic 공급자의 cohere-rerank 프로토콜 (internal/models/api/cohererank)
//   POST /rerank  {model, query, documents: string[], top_n?, …}  →  {results: [{index, relevance_score}]}
//   점수: llmRerank 의 0~10 정수 ÷ 10 → 0~1. WeKnora 모델 행의 score_scale 은 probability.
//   문서 본문 자르기: llmRerank 그대로 400 자. 다만 WeKnora 가 보내는 문서는 "제목 + 본문" 한 덩어리라
//   R3(제목 별도 + 본문 400 자)와 달리 제목이 400 자 안에 든다.
//
// 바인드: 127.0.0.1 만. colima(lima) VM 은 192.168.5.2 = 호스트 루프백으로 넘겨 주므로 컨테이너의 host.docker.internal 에서 닿는다
// (2026-10-07 실측). 외부 인터페이스에는 열지 않는다. Authorization: Bearer <토큰> 이 맞지 않으면 401.
//
// 원가: 호출마다 bench ledger 에 run "wk-real-rerank" 한 줄 (flash-lite 사용량 × config.ts 요금표).
import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs"
import { join } from "path"
import { randomBytes, timingSafeEqual } from "crypto"
import { llmRerank } from "../wk/llm"
import { usdToKrw } from "../config"
import { appendLedger } from "../ledger"
import { labDir } from "./client"

const HOST = "127.0.0.1"
const PORT = Number(process.env.WK_RERANK_PORT ?? 8583)
/** llmRerank 한 번에 넣는 후보 수 상한. 넘으면 나눠 부른다 (출력 JSON 이 잘리지 않게) */
const BATCH = 40

export function rerankToken(): string {
  const p = join(labDir(), "rerank-token")
  if (!existsSync(p)) writeFileSync(p, randomBytes(24).toString("hex"), { mode: 0o600 })
  return readFileSync(p, "utf8").trim()
}

interface RerankRequest { model?: string; query?: string; documents?: (string | { text?: string })[]; top_n?: number }

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

function authorized(req: IncomingMessage, token: string): boolean {
  const h = req.headers.authorization ?? ""
  const got = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "")
  const want = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

async function main() {
  const token = rerankToken()
  const logFile = join(labDir(), "rerank.log")
  let calls = 0
  let krwTotal = 0

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok" })
      if (!authorized(req, token)) return send(res, 401, { error: "unauthorized" })
      if (req.method !== "POST" || !req.url?.replace(/\/+$/, "").endsWith("/rerank")) return send(res, 404, { error: "POST /rerank 만" })
      const body = JSON.parse(await readBody(req)) as RerankRequest
      const query = String(body.query ?? "")
      const docs = (body.documents ?? []).map((d) => (typeof d === "string" ? d : String(d?.text ?? "")))
      if (!query || docs.length === 0) return send(res, 200, { results: [] })

      const scores: number[] = []
      let usd = 0
      let tokIn = 0
      let tokOut = 0
      let parsed = true
      const t0 = Date.now()
      for (let i = 0; i < docs.length; i += BATCH) {
        const part = docs.slice(i, i + BATCH)
        const r = await llmRerank(query, part.map((content) => ({ title: "", content })))
        scores.push(...r.scores)
        usd += r.costUsd
        tokIn += r.usage.input
        tokOut += r.usage.output + r.usage.thinking
        parsed &&= r.parsed
      }
      const results = scores.map((s, index) => ({ index, relevance_score: s / 10 })).sort((a, b) => b.relevance_score - a.relevance_score)
      const top = body.top_n && body.top_n > 0 ? results.slice(0, body.top_n) : results
      const krw = usdToKrw(usd)
      calls++
      krwTotal += krw
      appendLedger({ kind: "run", runId: "wk-real-rerank", krw, note: `flash-lite 리랭크 문서 ${docs.length} · 입력 ${tokIn} · 출력 ${tokOut} tok${parsed ? "" : " · 점수 일부 빠짐(0 처리)"}` })
      appendFileSync(logFile, `${new Date().toISOString()} docs=${docs.length} top_n=${body.top_n ?? "-"} in=${tokIn} out=${tokOut} krw=${krw} ms=${Date.now() - t0} parsed=${parsed}\n`)
      console.log(`[${calls}] 문서 ${docs.length} · ${Date.now() - t0}ms · ${krw}원 (누적 ${krwTotal.toFixed(2)}원)${parsed ? "" : " · 점수 일부 빠짐"}`)
      return send(res, 200, { model: body.model ?? "gemini-3.5-flash-lite-listwise", results: top })
    } catch (err) {
      console.error(err)
      return send(res, 500, { error: String(err).slice(0, 300) })
    }
  })
  server.listen(PORT, HOST, () => console.log(`리랭크 서버 http://${HOST}:${PORT}/rerank (컨테이너에서는 http://host.docker.internal:${PORT}) · 토큰 ${join(labDir(), "rerank-token")}`))
}

if (process.argv[1]?.endsWith("rerank-server.ts")) main().catch((err) => { console.error(err); process.exitCode = 1 })
