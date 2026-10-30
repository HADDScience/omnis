// 기존 사진 일괄과 카톡 이식이 공유하는 Claude 구독 경로. 앱의 API 키는 넘기지 않는다.
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { photoPrompt, type PhotoContext } from "../lib/photo-text"

export class ClaudePhotoLimitError extends Error {}

export async function describeImageWithClaude(image: Buffer, context: PhotoContext, model = "sonnet"): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "photo-describe-"))
  try {
    const path = join(dir, "photo.jpg")
    writeFileSync(path, await sharp(image).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer())
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
      if (/hit your.*limit|rate.?limit|usage.?limit/i.test(result.result ?? "")) {
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
