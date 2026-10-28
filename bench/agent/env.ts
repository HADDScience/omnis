// .env 읽기 — API 키 세 개는 .env 가 셸 환경변수를 이긴다.
//
// `import "dotenv/config"` 는 이미 있는 환경변수를 덮어쓰지 않는다. ~/.zshrc 가 다른 GEMINI_API_KEY 를
// export 하고 있어, 벤치가 잔액 0 인 키로 불러 402 가 난 적이 있다(2026-10-28). 그래서 키만 .env 값으로
// 덮고, 어느 쪽에서 왔는지(값은 빼고) 시작할 때 보인다.
// DATABASE_URL 등 나머지는 dotenv 기본(셸 우선) 그대로 두고, run.ts 가 localhost 인지 따로 검사한다.
//
// 다른 모듈보다 먼저 import 해야 한다 (run.ts 첫 줄).
import { existsSync, readFileSync } from "fs"
import { config, parse } from "dotenv"

export const API_KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const

export type KeySource = ".env" | ".env (셸 값 무시)" | "셸" | "없음"

const shellHad = Object.fromEntries(API_KEYS.map((k) => [k, Boolean(process.env[k])])) as Record<(typeof API_KEYS)[number], boolean>

config({ quiet: true })
const fromFile = existsSync(".env") ? parse(readFileSync(".env")) : {}

export const KEY_SOURCES = {} as Record<(typeof API_KEYS)[number], KeySource>
for (const k of API_KEYS) {
  if (fromFile[k]) {
    const differs = shellHad[k] && process.env[k] !== fromFile[k]
    process.env[k] = fromFile[k]
    KEY_SOURCES[k] = differs ? ".env (셸 값 무시)" : ".env"
  } else {
    KEY_SOURCES[k] = shellHad[k] ? "셸" : "없음"
  }
}

export function printKeySources(): void {
  for (const k of API_KEYS) console.log(`키 ${k.padEnd(18)} ← ${KEY_SOURCES[k]}`)
}
