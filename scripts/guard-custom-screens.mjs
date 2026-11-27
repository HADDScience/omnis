#!/usr/bin/env node
// 맞춤 화면 경로 diff 0 검사 — 공통 층 1단계 PR 이 맞춤 화면(IP · 국가과제 · CRM · 연혁)을 건드리지 않게 막는다.
// 경로 목록: scripts/guard-custom-screens.txt. 계획: mydocs/plans/2026-11-27-ontology-phase1.md §8
//
//   git diff --name-only origin/main...HEAD | node scripts/guard-custom-screens.mjs
//   PR_BODY="$(gh pr view 123 --json body -q .body)" node scripts/guard-custom-screens.mjs < files.txt
//
// 걸린 파일이 있어도 PR 본문(PR_BODY)에 「맞춤 화면 변경: <까닭>」 한 줄이 있으면 지나간다(까닭은 비울 수 없다).
// 의존성 없이 node 만으로 돈다 — CI 에서 설치 없이 부른다. 시험: lib/guard-custom-screens.test.ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const LIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "guard-custom-screens.txt")

/** 목록 글 → 경로 규칙. 빈 줄 · # 설명은 버린다 */
export function parsePatterns(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
}

/** 끝이 /** 면 그 폴더 아래 전부, 아니면 그 파일 하나 */
export function matches(pattern, file) {
  if (pattern.endsWith("/**")) return file.startsWith(pattern.slice(0, -2))
  return file === pattern
}

export function findViolations(patterns, files) {
  return files.filter((f) => patterns.some((p) => matches(p, f)))
}

/** PR 본문의 「맞춤 화면 변경: <까닭>」 — 까닭이 있어야 한다 */
export function reasonIn(body) {
  // [ \t] 만 — \s 는 줄바꿈을 넘어 다음 줄을 까닭으로 읽는다
  const m = /^[ \t]*맞춤 화면 변경[ \t]*:[ \t]*(\S.*)$/m.exec(body ?? "")
  return m ? m[1].trim() : null
}

async function main() {
  const patterns = parsePatterns(readFileSync(LIST_PATH, "utf8"))
  let input = ""
  for await (const chunk of process.stdin) input += chunk
  const files = input.split("\n").map((s) => s.trim()).filter(Boolean)
  const hits = findViolations(patterns, files)
  console.log(`바뀐 파일 ${files.length}개 · 맞춤 화면 경로 규칙 ${patterns.length}개 · 걸린 파일 ${hits.length}개`)
  if (!hits.length) return
  for (const f of hits) console.log(`  ${f}`)
  const reason = reasonIn(process.env.PR_BODY)
  if (reason) {
    console.log(`PR 본문의 까닭: ${reason} — 지나간다`)
    return
  }
  console.error("맞춤 화면 경로를 바꿨다. 계획에 적힌 예외라면 PR 본문에 「맞춤 화면 변경: <까닭>」 한 줄을 적는다.")
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
