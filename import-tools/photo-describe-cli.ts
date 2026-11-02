// 기존 사진 일괄과 카톡 이식이 공유하는 구독 경로(Claude Code · Codex). 앱의 API 키는 넘기지 않는다.
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { photoPrompt, type PhotoContext } from "../lib/photo-text"

/** 구독 사용 한도 — 사진마다 실패를 되풀이하지 말고 대기열을 멈춘다 */
export class PhotoLimitError extends Error {}
export class ClaudePhotoLimitError extends PhotoLimitError {}
export class CodexPhotoLimitError extends PhotoLimitError {}

const LIMIT_TEXT = /hit your.*limit|rate.?limit|usage.?limit|quota|429|too many requests/i

async function writeSmallJpeg(image: Buffer, dir: string): Promise<string> {
  const path = join(dir, "photo.jpg")
  writeFileSync(path, await sharp(image).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer())
  return path
}

export async function describeImageWithClaude(image: Buffer, context: PhotoContext, model = "sonnet"): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "photo-describe-"))
  try {
    const path = await writeSmallJpeg(image, dir)
    const env = { ...process.env }
    delete env.CLAUDECODE
    delete env.ANTHROPIC_API_KEY
    const prompt = `먼저 Read 도구로 이 이미지 파일을 열어 본다: ${path}\n\n${photoPrompt(context)}`
    const { stdout, code } = await new Promise<{ stdout: string; code?: string | number }>((resolve, reject) => {
      execFile("claude", ["-p", "--model", model, "--allowedTools", "Read", "--output-format", "json", prompt],
        { env, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 },
        (err, stdout) => {
          // CLI는 한도 초과 때 exit 1과 JSON을 함께 반환한다. 프롬프트가 든 err.message는 내보내지 않는다.
          if (err && !stdout.trim()) return reject(new Error(`Claude 사진 설명 실행 실패 (${err.code ?? "unknown"})`))
          resolve({ stdout, code: err ? (err.code ?? "terminated") : undefined })
        })
    })
    const result = JSON.parse(stdout) as { is_error?: boolean; result?: string }
    if (result.is_error) {
      if (LIMIT_TEXT.test(result.result ?? "")) {
        throw new ClaudePhotoLimitError("Claude 구독 사용 한도에 도달했습니다. 초기화 뒤 다시 실행하세요.")
      }
      throw new Error("Claude 사진 설명에 실패했습니다. 미처리 사진은 다음 실행에서 재시도합니다.")
    }
    if (code) throw new Error(`Claude 사진 설명 실행 실패 (${code})`)
    if (!result.result?.trim()) throw new Error("Claude 사진 설명 응답이 비어 있습니다.")
    return result.result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Codex CLI(ChatGPT 구독) — 이미지를 `-i` 로 붙이고 마지막 답만 파일로 받는다.
 * 읽기 전용 샌드박스 · 세션 기록 안 남김(--ephemeral). 모델은 Codex 설정의 기본값, `model` 을 주면 그것.
 */
export async function describeImageWithCodex(image: Buffer, context: PhotoContext, model?: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "photo-describe-"))
  try {
    const path = await writeSmallJpeg(image, dir)
    const out = join(dir, "answer.txt")
    const env = { ...process.env }
    delete env.OPENAI_API_KEY
    delete env.CLAUDECODE
    const argv = ["exec", "--skip-git-repo-check", "-s", "read-only", "--ephemeral", "-C", dir, "-i", path, "-o", out, ...(model ? ["-m", model] : []), photoPrompt(context)]
    const { log, code } = await new Promise<{ log: string; code?: string | number }>((resolve) => {
      const child = execFile("codex", argv, { env, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 },
        (err, stdout, stderr) => resolve({ log: `${stdout}\n${stderr}`, code: err ? (err.code ?? "terminated") : undefined }))
      // stdin 이 열려 있으면 codex 는 그것도 프롬프트로 읽으려고 끝까지 기다린다
      child.stdin?.end()
    })
    // 프롬프트(사진 앞뒤 대화)가 든 로그는 내보내지 않는다 — 한도인지만 본다
    if (code) {
      if (LIMIT_TEXT.test(log)) throw new CodexPhotoLimitError("Codex 구독 사용 한도에 도달했습니다. 초기화 뒤 다시 실행하세요.")
      throw new Error(`Codex 사진 설명 실행 실패 (${code})`)
    }
    const text = existsSync(out) ? readFileSync(out, "utf8") : ""
    if (!text.trim()) {
      if (LIMIT_TEXT.test(log)) throw new CodexPhotoLimitError("Codex 구독 사용 한도에 도달했습니다. 초기화 뒤 다시 실행하세요.")
      throw new Error("Codex 사진 설명 응답이 비어 있습니다.")
    }
    return text
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
