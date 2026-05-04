import { execSync } from "child_process"
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs"
import path from "path"

const OMNIS_DIR = path.join(process.cwd(), "data", "omnis")

function ensureDir() {
  if (!existsSync(OMNIS_DIR)) mkdirSync(OMNIS_DIR, { recursive: true })
  if (!existsSync(path.join(OMNIS_DIR, ".git"))) {
    execSync("git init", { cwd: OMNIS_DIR })
  }
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\w가-힣]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

function filePath(cardId: string, title: string): string {
  return path.join(OMNIS_DIR, `${slugify(title)}_${cardId.slice(0, 8)}.md`)
}

export function saveAndCommit(cardId: string, title: string, content: string, author: string): void {
  ensureDir()
  const fp = filePath(cardId, title)
  writeFileSync(fp, content, "utf-8")

  const relPath = path.relative(OMNIS_DIR, fp)
  execSync(`git add "${relPath}"`, { cwd: OMNIS_DIR })

  const msg = `${title} 수정`
  const authorStr = `${author} <${author}@omnis>`
  try {
    execSync(`git commit --author="${authorStr}" -m "${msg}"`, { cwd: OMNIS_DIR, env: { ...process.env, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@omnis` } })
  } catch {
    // nothing to commit (동일 내용)
  }
}

export function initCardFile(cardId: string, title: string, content: string): void {
  ensureDir()
  const fp = filePath(cardId, title)
  if (!existsSync(fp)) {
    writeFileSync(fp, content, "utf-8")
    const relPath = path.relative(OMNIS_DIR, fp)
    execSync(`git add "${relPath}"`, { cwd: OMNIS_DIR })
    try {
      execSync(`git commit --author="system <system@omnis>" -m "초기 등록: ${title}"`, { cwd: OMNIS_DIR, env: { ...process.env, GIT_COMMITTER_NAME: "system", GIT_COMMITTER_EMAIL: "system@omnis" } })
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
  ensureDir()
  const fp = filePath(cardId, title)
  const relPath = path.relative(OMNIS_DIR, fp)
  if (!existsSync(fp)) return []

  try {
    const log = execSync(
      `git log --format="%H|%h|%an|%ai|%s" -- "${relPath}"`,
      { cwd: OMNIS_DIR, encoding: "utf-8" }
    ).trim()

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
  ensureDir()
  const fp = filePath(cardId, title)
  const relPath = path.relative(OMNIS_DIR, fp)
  try {
    return execSync(`git show ${hash}:"${relPath}"`, { cwd: OMNIS_DIR, encoding: "utf-8" })
  } catch {
    return ""
  }
}

export function getDiff(cardId: string, title: string, hash1: string, hash2: string): string {
  ensureDir()
  const fp = filePath(cardId, title)
  const relPath = path.relative(OMNIS_DIR, fp)
  try {
    return execSync(`git diff ${hash1} ${hash2} -- "${relPath}"`, { cwd: OMNIS_DIR, encoding: "utf-8" })
  } catch {
    return ""
  }
}

export function getCardVersion(cardId: string, title: string): number {
  return getHistory(cardId, title).length || 1
}

export function rollback(cardId: string, title: string, hash: string, author: string): string {
  ensureDir()
  const fp = filePath(cardId, title)
  const relPath = path.relative(OMNIS_DIR, fp)

  const oldContent = execSync(`git show ${hash}:"${relPath}"`, { cwd: OMNIS_DIR, encoding: "utf-8" })
  writeFileSync(fp, oldContent, "utf-8")

  execSync(`git add "${relPath}"`, { cwd: OMNIS_DIR })
  const msg = `${title} 롤백 (${hash.slice(0, 7)})`
  const authorStr = `${author} <${author}@omnis>`
  try {
    execSync(`git commit --author="${authorStr}" -m "${msg}"`, { cwd: OMNIS_DIR, env: { ...process.env, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@omnis` } })
  } catch {
    // nothing changed
  }

  return oldContent
}
