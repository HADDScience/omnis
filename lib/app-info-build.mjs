// 앱 정보의 「업데이트 소식」 · 「오픈소스 라이선스」 — 빌드 때 next.config.mjs 가 부른다(결과는 env 로 번들에 실린다).
// 순수 함수(humanizeTitle · parseMergeLog · normalizeLicenses)는 app-info-build.test.ts 가 시험한다.
// 화면: app/(main)/settings/page.tsx(업데이트 소식) · app/(legal)/licenses/page.tsx(라이선스).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/** 사람에게 보일 변경 종류 — 이 밖의 종류(chore · ci · test · docs · refactor · build …)는 싣지 않는다 */
const KIND_LABEL = { feat: "새 기능", fix: "고침", perf: "빨라짐" }

/** 사용자가 보지 않는 영역(범위 이름) — 이식 도구 · 시험 · 운영 장치 */
const INTERNAL_SCOPES = /^(kakao|kakao-import|kakao-sync|import|ci|e2e|test|tests|build|deps|db|prisma|infra|lab|bench|scripts|docs|ops|dev|seed|migrate|migration|cron|lint)$/i

/** 제목에 이런 말이 있으면 내부 작업이다 — 싣지 않는다 */
const INTERNAL_WORDS = /(e2e|\bCI\b|lint|시드|\bseed\b|마이그레이션|migration|prisma|워크트리|worktree|리팩터|refactor|keys-v2|raw\/|건식|꺼진 채로|Workflow|\bR2\b|\bS3\b|webhook|env\b|환경변수|스키마|schema)/i

/**
 * PR 제목 하나를 사람이 읽을 한 줄로. 싣지 않을 것이면 null.
 * 「feat(chat): 폰에서 글을 오른쪽으로 밀면 답장」 → { kind: "새 기능", text: "폰에서 글을 오른쪽으로 밀면 답장" }
 * @param {string} title
 * @returns {{ kind: string, text: string } | null}
 */
export function humanizeTitle(title) {
  const m = /^\s*(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(title ?? "")
  if (!m) return null
  const [, type, scope = "", rest] = m
  const kind = KIND_LABEL[type.toLowerCase()]
  if (!kind) return null
  if (scope.split(/[,/]/).some((s) => INTERNAL_SCOPES.test(s.trim()))) return null
  if (INTERNAL_WORDS.test(rest)) return null
  const text = rest
    .replace(/`([^`]*)`/g, "$1") // 코드 표시만 걷는다
    .replace(/\s*\((?:핫픽스|hotfix)\)\s*/gi, " ")
    .replace(/\s*#\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return null
  return { kind, text: text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text }
}

/**
 * `git log --merges --first-parent --format=%cI%x1f%s%x1f%b%x1e` 의 출력 → 최근 업데이트 n 건.
 * 머지 커밋의 본문 첫 줄이 PR 제목이다(GitHub 「Merge pull request #N from 브랜치」 — 제목 줄의 브랜치명은 쓰지 않는다).
 * @param {string} log
 * @param {number} [limit]
 * @returns {{ date: string, kind: string, text: string }[]}
 */
export function parseMergeLog(log, limit = 10) {
  const out = []
  const seen = new Set()
  for (const rec of (log ?? "").split("\x1e")) {
    const [at, subject, body] = rec.replace(/^\s+/, "").split("\x1f")
    if (!at || !subject) continue
    if (!/^Merge pull request #\d+/.test(subject)) continue
    const title = (body ?? "").split("\n").map((l) => l.trim()).find(Boolean)
    const h = title ? humanizeTitle(title) : null
    if (!h || seen.has(h.text)) continue
    seen.add(h.text)
    const d = new Date(at)
    const date = Number.isNaN(d.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
    out.push({ date, ...h })
    if (out.length >= limit) break
  }
  return out
}

/**
 * `pnpm licenses list --prod --json` 의 출력(라이선스별 묶음) → 이름 순 목록.
 * @param {Record<string, { name: string, versions?: string[], license?: string, homepage?: string }[]>} grouped
 * @returns {{ name: string, version: string, license: string, homepage: string | null }[]}
 */
export function normalizeLicenses(grouped) {
  const rows = []
  for (const [license, pkgs] of Object.entries(grouped ?? {})) {
    for (const p of pkgs ?? []) {
      if (!p?.name) continue
      const lic = p.license || license
      rows.push({
        name: p.name,
        version: (p.versions ?? []).join(", "),
        license: !lic || lic === "Unknown" ? "명시 없음" : lic,
        homepage: typeof p.homepage === "string" && /^https?:\/\//.test(p.homepage) ? p.homepage : null,
      })
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 32 * 1024 * 1024 })

const LOG_ARGS = ["log", "--merges", "--first-parent", "-n", "60", "--format=%cI%x1f%s%x1f%b%x1e"]

/** 빌드 때 — 머지 기록에서 업데이트 소식. 실패하면 빈 목록(빌드를 막지 않는다) */
export function collectUpdates(cwd, limit = 10) {
  try {
    let items = parseMergeLog(run("git", LOG_ARGS, cwd), limit)
    // Vercel 은 얕게 받는다 — 모자라면 한 번 더 깊게 받아 본다
    if (items.length < limit && run("git", ["rev-parse", "--is-shallow-repository"], cwd).trim() === "true") {
      try {
        run("git", ["fetch", "--deepen=200", "--quiet"], cwd)
        items = parseMergeLog(run("git", LOG_ARGS, cwd), limit)
      } catch {
        // 받지 못하면 있는 만큼
      }
    }
    return items
  } catch {
    return []
  }
}

/** 빌드 때 — 운영 의존성(전이 포함)의 라이선스. pnpm 이 없으면 직접 의존성만 package.json 에서 */
export function collectLicenses(cwd) {
  try {
    return normalizeLicenses(JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json"], cwd)))
  } catch {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"))
      const grouped = {}
      for (const name of Object.keys(pkg.dependencies ?? {})) {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(cwd, "node_modules", name, "package.json"), "utf8"))
          const lic = typeof p.license === "string" ? p.license : "Unknown"
          ;(grouped[lic] ??= []).push({ name, versions: [p.version], license: lic, homepage: p.homepage })
        } catch {
          // 설치되지 않은 것은 건너뛴다
        }
      }
      return normalizeLicenses(grouped)
    } catch {
      return []
    }
  }
}
