// 첨부 뒤 사진 설명. 이번 CSV에 속한 전사방 사진만 고른다. Codex 구독이 먼저, 한도에 닿으면 Claude 구독으로 넘어간다.
// 실패는 건너뛰고 보고한다 — 사진 때문에 이식 전체가 실패로 끝나지 않는다. 실패분은 다음 실행에서 이어 한다.
import { prisma, messageSourceId, parseKakaoCsv, ROOMS } from "../kakao-common"
import { PhotoLimitError, describeImageWithClaude, describeImageWithCodex } from "../photo-describe-cli"
import { openFileObject } from "../../lib/file-object"
import { photoContextFor, savePhotoDescription } from "../../lib/photo-describe"

export async function describeImportedPhotos(csvPaths: string[], opts: { dry: boolean; workers: number }): Promise<{ ids: string[]; left: number }> {
  // ingest의 sessions는 마스터 전체다. 이번 파일을 다시 읽어 과거의 다른 이식까지 처리하지 않는다.
  const sourceIds = csvPaths.flatMap(parseKakaoCsv).filter((m) => ROOMS[m.room]).map((m) => messageSourceId(m.room, m))
  const files = await prisma.file.findMany({
    where: {
      mimeType: { in: ["image/png", "image/jpeg", "image/webp"] },
      message: { sourceId: { in: sourceIds }, deletedAt: null, room: { kind: "COMPANY" } },
    },
    select: { id: true, name: true, path: true, size: true, mimeType: true, describedAt: true },
    orderBy: { createdAt: "asc" },
  })
  const todo = files.filter((f) => !f.describedAt)
  console.log(`  이번 CSV 사진 ${files.length}장 · 미설명 ${todo.length}장 · 구독(Codex → Claude)`)
  if (opts.dry) return { ids: files.map((f) => f.id), left: 0 }

  const engines = [
    { by: "codex-cli:gpt-6.1-sol", run: (image: Buffer, ctx: Parameters<typeof describeImageWithCodex>[1]) => describeImageWithCodex(image, ctx, "gpt-6.1-sol") },
    { by: "claude-cli:sonnet", run: (image: Buffer, ctx: Parameters<typeof describeImageWithClaude>[1]) => describeImageWithClaude(image, ctx, "sonnet") },
  ]
  let engine = 0
  const queue = [...todo]
  let done = 0, failed = 0
  await Promise.all(Array.from({ length: Math.min(opts.workers, 3) }, async () => {
    while (engine < engines.length) {
      const file = queue.shift()
      if (!file) break
      try {
        const found = await photoContextFor(file.id)
        if (!found) continue
        const obj = await openFileObject(file)
        const parts: Buffer[] = []
        for await (const part of obj.body) parts.push(Buffer.from(part))
        const image = Buffer.concat(parts)
        for (;;) {
          const current = engine
          const use = engines[current]
          if (!use) throw new PhotoLimitError("구독 한도")
          try {
            const text = await use.run(image, found.ctx)
            // 사진도 마지막 명시적 임베딩 단계에서 색인한다. --no-embed를 지킨다.
            if (!await savePhotoDescription(file.id, text, use.by, undefined, { embed: false })) throw new Error("설명 JSON을 읽지 못함")
            done++
            break
          } catch (e) {
            if (!(e instanceof PhotoLimitError)) throw e
            if (engine === current) { engine++; console.log(`  ${use.by} 한도 — ${engines[engine]?.by ?? "남은 구독 없음"}`) }
          }
        }
      } catch (e) {
        if (e instanceof PhotoLimitError) { queue.unshift(file); break }
        failed++
        console.log(`  ✗ 사진 ${file.id} — ${(e as Error).message.slice(0, 160)}`)
      }
    }
  }))
  console.log(`  사진 설명 성공 ${done} · 실패 ${failed} · 남음 ${queue.length}${failed || queue.length ? " — 다음 실행에서 이어 한다" : ""}`)
  return { ids: files.map((f) => f.id), left: failed + queue.length }
}
