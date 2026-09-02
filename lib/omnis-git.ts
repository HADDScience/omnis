import { execFileSync } from "child_process"
import { writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs"
import path from "path"

const OMNIS_DIR = path.join(process.cwd(), "data", "omnis")
const HASH_RE = /^[0-9a-f]{7,40}$/i

function ensureDir() {
  if (!existsSync(OMNIS_DIR)) mkdirSync(OMNIS_DIR, { recursive: true })
  if (!existsSync(path.join(OMNIS_DIR, ".git"))) {
    execFileSync("git", ["init"], { cwd: OMNIS_DIR })
  }
}

// 서버리스(Vercel)에는 쓰기 가능한 디스크도 git 실행파일도 없다.
// 카드 본문과 버전은 DB(OmnisCard / OmnisCardVersion)에 이미 저장되므로
// 여기서는 조용히 비활성화한다. 이 판정을 안 하면 DB 커밋이 끝난 뒤에
// 예외가 터져서, 저장은 됐는데 사용자에게는 실패로 보이게 된다.
let available: boolean | null = null
function gitAvailable(): boolean {
  if (available === null) {
    try {
      ensureDir()
      available = true
    } catch {
      available = false
      console.warn("[omnis-git] 파일 기반 버전관리 비활성화 — DB 버전만 사용합니다")
    }
  }
  return available
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\w가-힣]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

function filePath(cardId: string, title: string): string {
  return path.join(OMNIS_DIR, `${slugify(title)}_${cardId.slice(0, 8)}.md`)
}

function findCurrentFilePath(cardId: string, title: string): string {
  ensureDir()
  const expected = filePath(cardId, title)
  if (existsSync(expected)) return expected

  const suffix = `_${cardId.slice(0, 8)}.md`
  const existing = readdirSync(OMNIS_DIR)
    .filter((name) => name.endsWith(suffix))
    .sort()[0]
  return existing ? path.join(OMNIS_DIR, existing) : expected
}

function findFilePathAtHash(cardId: string, title: string, hash: string): string {
  assertGitHash(hash)
  const currentRelPath = path.relative(OMNIS_DIR, findCurrentFilePath(cardId, title))
  try {
    const paths = git(["ls-tree", "-r", "--name-only", hash], { encoding: "utf-8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    return paths.find((p) => p.endsWith(`_${cardId.slice(0, 8)}.md`)) ?? currentRelPath
  } catch {
    return currentRelPath
  }
}

function assertGitHash(hash: string): void {
  if (!HASH_RE.test(hash)) {
    throw new Error("Invalid git hash")
  }
}

function git(args: string[], options: { encoding: "utf-8" }): string {
  return execFileSync("git", args, {
    cwd: OMNIS_DIR,
    encoding: options.encoding,
  })
}

function gitSilent(args: string[]): void {
  execFileSync("git", args, { cwd: OMNIS_DIR })
}

export function saveAndCommit(
  cardId: string,
  title: string,
  content: string,
  author: string,
  message?: string
): void {
  if (!gitAvailable()) return
  ensureDir()
  const fp = filePath(cardId, title)
  const existingFp = findCurrentFilePath(cardId, title)
  if (existingFp !== fp && existsSync(existingFp)) {
    const existingRel = path.relative(OMNIS_DIR, existingFp)
    const nextRel = path.relative(OMNIS_DIR, fp)
    try {
      gitSilent(["mv", existingRel, nextRel])
    } catch {
      renameSync(existingFp, fp)
      gitSilent(["add", "-A", existingRel, nextRel])
    }
  }
  writeFileSync(fp, content, "utf-8")

  const relPath = path.relative(OMNIS_DIR, fp)
  gitSilent(["add", relPath])

  const msg = message ?? `${title} 수정`
  const authorStr = `${author} <${author}@omnis>`
  try {
    execFileSync("git", ["commit", `--author=${authorStr}`, "-m", msg], { cwd: OMNIS_DIR, env: { ...process.env, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@omnis` } })
  } catch {
    // nothing to commit (동일 내용)
  }
}

export function initCardFile(cardId: string, title: string, content: string): void {
  if (!gitAvailable()) return
  ensureDir()
  const fp = filePath(cardId, title)
  if (!existsSync(fp)) {
    writeFileSync(fp, content, "utf-8")
    const relPath = path.relative(OMNIS_DIR, fp)
    gitSilent(["add", relPath])
    try {
      execFileSync("git", ["commit", "--author=system <system@omnis>", "-m", `초기 등록: ${title}`], { cwd: OMNIS_DIR, env: { ...process.env, GIT_COMMITTER_NAME: "system", GIT_COMMITTER_EMAIL: "system@omnis" } })
    } catch {
      // ignore
    }
  }
}

export interface VersionEntry {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
}

export function getHistory(cardId: string, title: string): VersionEntry[] {
  if (!gitAvailable()) return []
  ensureDir()
  const fp = findCurrentFilePath(cardId, title)
  const relPath = path.relative(OMNIS_DIR, fp)
  if (!existsSync(fp)) return []

  try {
    const log = git(["log", "--follow", "--format=%H|%h|%an|%ai|%s", "--", relPath], { encoding: "utf-8" }).trim()

    if (!log) return []
    return log.split("\n").map((line) => {
      const [hash, shortHash, author, date, message] = line.split("|")
      return { hash, shortHash, author, date, message }
    })
  } catch {
    return []
  }
}

export function getVersionContent(cardId: string, title: string, hash: string): string {
  if (!gitAvailable()) return ""
  ensureDir()
  assertGitHash(hash)
  const relPath = findFilePathAtHash(cardId, title, hash)
  try {
    return git(["show", `${hash}:${relPath}`], { encoding: "utf-8" })
  } catch {
    return ""
  }
}

export function getDiff(cardId: string, title: string, hash1: string, hash2: string): string {
  if (!gitAvailable()) return ""
  ensureDir()
  assertGitHash(hash1)
  assertGitHash(hash2)
  const relPath = path.relative(OMNIS_DIR, findCurrentFilePath(cardId, title))
  try {
    return git(["diff", hash1, hash2, "--", relPath], { encoding: "utf-8" })
  } catch {
    return ""
  }
}

export function getCardVersion(cardId: string, title: string): number {
  if (!gitAvailable()) return 0
  return getHistory(cardId, title).length || 1
}

export function rollback(cardId: string, title: string, hash: string, author: string): string {
  if (!gitAvailable()) return ""
  ensureDir()
  assertGitHash(hash)
  const fp = findCurrentFilePath(cardId, title)
  const relPath = path.relative(OMNIS_DIR, fp)

  const oldContent = getVersionContent(cardId, title, hash)
  writeFileSync(fp, oldContent, "utf-8")

  gitSilent(["add", relPath])
  const msg = `${title} 롤백 (${hash.slice(0, 7)})`
  const authorStr = `${author} <${author}@omnis>`
  try {
    execFileSync("git", ["commit", `--author=${authorStr}`, "-m", msg], { cwd: OMNIS_DIR, env: { ...process.env, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@omnis` } })
  } catch {
    // nothing changed
  }

  return oldContent
}
