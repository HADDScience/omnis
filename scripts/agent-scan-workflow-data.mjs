// 로컬 Workflow 기록(.next/workflow-data)에 API 키 · 승인 비밀이 남지 않았는지 훑는다.
// 기록은 base64 + (일부) zstd 로 싸여 있어 그대로 grep 하면 놓친다 — 풀어서 본다.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { zstdDecompressSync } from "node:zlib"

const dir = process.argv[2] ?? ".next/workflow-data"
const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]
}))
const secrets = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OMNIS_AGENT_APPROVAL_SECRET"].map((k) => [k, env[k]]).filter(([, v]) => v && v.length > 10)
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
let files = 0, blobs = 0, sawModel = 0
const hits = []
for (const f of walk(dir)) {
  files++
  const texts = [readFileSync(f, "utf8")]
  for (const m of texts[0].matchAll(/"data":\s*"([A-Za-z0-9+/=]+)"/g)) {
    let b = Buffer.from(m[1], "base64")
    if (b.subarray(0, 4).toString() === "zstd") { try { b = zstdDecompressSync(b.subarray(4)) } catch { try { b = zstdDecompressSync(b) } catch {} } }
    blobs++
    texts.push(b.toString("utf8"))
  }
  for (const t of texts) {
    if (t.includes("gpt-6.1-sol")) sawModel++
    for (const [k, v] of secrets) if (t.includes(v)) hits.push(`${k} in ${f}`)
    if (/Bearer\s+sk-/.test(t)) hits.push(`Bearer sk- in ${f}`)
  }
}
console.log(`파일 ${files} · 푼 덩어리 ${blobs} · 모델 이름이 보인 곳 ${sawModel} (풀기가 됐는지 대조용)`)
console.log(hits.length ? `✗ 비밀 발견 ${hits.length}\n${hits.join("\n")}` : `✓ 비밀 ${secrets.length}종(${secrets.map(([k]) => k).join(" · ")}) 없음`)
process.exit(hits.length ? 1 : 0)
