// omnis/route-tool-coverage(#248) — app/api 의 route.ts 가 내보내는 GET · POST · PUT · PATCH · DELETE 마다
// lib/tools/route-coverage.ts 에 「라우트 메서드」 줄이 있어야 한다. 없으면 lint 오류(CI verify 가 막는다).
// 줄의 값(도구 이름 · 이유)은 tsc 와 단위 시험(lib/tools/route-coverage.test.ts)이 본다. 여기서는 줄이 있는지만 본다.
import { readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
let cache = null

function table(cwd) {
  if (cache === null) {
    try {
      cache = readFileSync(join(cwd, "lib/tools/route-coverage.ts"), "utf8")
    } catch {
      cache = ""
    }
  }
  return cache
}

/** @type {import("eslint").Rule.RuleModule} */
const routeToolCoverage = {
  meta: {
    type: "problem",
    docs: { description: "API 라우트 메서드마다 AI 도구 표(lib/tools/route-coverage.ts)에 줄이 있어야 한다" },
    schema: [],
    messages: {
      missing: "「{{key}}」 이 lib/tools/route-coverage.ts 에 없습니다 — 같은 일을 하는 AI 도구를 만들거나 system(이유) 로 적으세요(#248).",
    },
  },
  create(context) {
    const file = context.filename ?? context.getFilename()
    const api = join(context.cwd ?? process.cwd(), "app", "api")
    const rel = relative(api, file)
    if (rel.startsWith("..") || !rel.endsWith(`${sep}route.ts`)) return {}
    const route = rel.slice(0, -`${sep}route.ts`.length).split(sep).join("/")
    const text = table(context.cwd ?? process.cwd())
    const check = (node, name) => {
      if (!METHODS.has(name)) return
      const key = `${route} ${name}`
      if (!text.includes(`"${key}"`)) context.report({ node, messageId: "missing", data: { key } })
    }
    return {
      ExportNamedDeclaration(node) {
        const d = node.declaration
        if (!d) return
        if (d.type === "FunctionDeclaration" && d.id) check(node, d.id.name)
        if (d.type === "VariableDeclaration") for (const v of d.declarations) if (v.id.type === "Identifier") check(node, v.id.name)
      },
    }
  },
}

export default routeToolCoverage
