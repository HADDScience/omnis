// 연결 확인 — 키 있는 모델마다 아주 짧은 프롬프트를 한 번 보내 요청 모양·사용량 보고·JSON 프로토콜을 본다.
//
//   npx tsx bench/smoke.ts [--models a,b]
//
// DB 가 필요 없다. 그리드를 돌리기 전에 벤더 오류(모델 ID 오타·thinking 설정 거부)를 여기서 걸러낸다.
import "dotenv/config"
import { MODELS, JUDGE_MODEL, modelAvailable } from "./config"
import { chat, costUsd } from "./providers"
import { parseRouteReply } from "./tools"

async function main() {
  const i = process.argv.indexOf("--models")
  const only = i >= 0 ? process.argv[i + 1].split(",") : null
  for (const m of [...MODELS, JUDGE_MODEL]) {
    if (only && !only.includes(m.key)) continue
    const a = modelAvailable(m)
    if (!a.ok) { console.log(`${m.key.padEnd(26)} 건너뜀 (${a.why})`); continue }
    try {
      const r = await chat(m, "반드시 JSON 객체 하나만 답하세요.", [{ role: "user", content: '{"answer": "..."} 형식으로 "안녕" 이라고 답하세요.' }], { maxOutputTokens: 512 })
      const p = parseRouteReply(r.text)
      console.log(
        `${m.key.padEnd(26)} ${String(r.ms).padStart(5)}ms in=${r.usage.input} out=${r.usage.output} think=${r.usage.thinking}` +
        ` $${costUsd(r.usage, m.price).toFixed(6)} finish=${r.finish} json=${p ? "ok" : "NO"} :: ${r.text.replace(/\n/g, " ").slice(0, 60)}`
      )
    } catch (err) {
      console.log(`${m.key.padEnd(26)} 오류 ${String(err).slice(0, 220)}`)
    }
  }
}
main()
