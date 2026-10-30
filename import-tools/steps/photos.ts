// 첨부 뒤 사진 설명. 이번 CSV에 속한 전사방 사진만 고르고, 실패분은 재실행 때 이어 한다.
import { prisma, messageSourceId, parseKakaoCsv, ROOMS } from "../kakao-common"
import { ClaudePhotoLimitError, describeImageWithClaude } from "../photo-describe-cli"
import { openFileObject } from "../../lib/file-object"
import { photoContextFor, savePhotoDescription } from "../../lib/photo-describe"

export async function describeImportedPhotos(csvPaths: string[], opts: { dry: boolean; workers: number }) {
  // ingest의 sessions는 마스터 전체다. 이번 파일을 다시 읽어 과거의 다른 이식까지 처리하지 않는다.
  const sourceIds = csvPaths.flatMap(parseKakaoCsv).filter((m) => ROOMS[m.room]).map((m) => messageSourceId(m.room, m))
  const files = await prisma.file.findMany({
    where: {
      mimeType: { in: ["image/png", "image/jpeg", "image/webp"] },
      message: { sourceId: { in: sourceIds }, deletedAt: null, room: { kind: "COMPANY" } },
    },
    select: { id: true, name: true, path: true, mimeType: true, describedAt: true },
    orderBy: { createdAt: "asc" },
  })
  const todo = files.filter((f) => !f.describedAt)
  console.log(`  이번 CSV 사진 ${files.length}장 · 미설명 ${todo.length}장 · Claude 구독 sonnet`)
  if (opts.dry) return files.map((f) => f.id)

  const queue = [...todo]
  let done = 0, failed = 0
  let limitError: ClaudePhotoLimitError | null = null
  await Promise.all(Array.from({ length: Math.min(opts.workers, 3) }, async () => {
    while (!limitError) {
      const file = queue.shift()
      if (!file) break
      try {
        const found = await photoContextFor(file.id)
        if (!found) continue
        const obj = await openFileObject(file)
        const parts: Buffer[] = []
        for await (const part of obj.body) parts.push(Buffer.from(part))
        const text = await describeImageWithClaude(Buffer.concat(parts), found.ctx)
        // 사진도 마지막 명시적 임베딩 단계에서 색인한다. --no-embed를 지킨다.
        if (!await savePhotoDescription(file.id, text, "claude-cli:sonnet", undefined, { embed: false })) throw new Error("설명 JSON을 읽지 못함")
        done++
      } catch (e) {
        failed++
        if (e instanceof ClaudePhotoLimitError) limitError = e
        console.log(`  ✗ 사진 ${file.id} — ${(e as Error).message.slice(0, 160)}`)
      }
    }
  }))
  console.log(`  사진 설명 성공 ${done} · 실패 ${failed} · 남음 ${queue.length}`)
  if (limitError) throw limitError
  if (failed) throw new Error(`사진 설명 ${failed}장 실패 — 같은 CSV로 재실행하면 실패분만 이어 처리합니다.`)
  return files.map((f) => f.id)
}
