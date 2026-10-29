// 사진 설명 만들기 — 사진 + 앞뒤 대화 → 설명 글 → File.description → 검색 색인(PHOTO).
//
// 앱에 올라온 사진은 여기서 모델(기본 gpt-6.1-terra, lib/ai-models.ts 의 photo)로 만든다.
// 기존 사진 일괄과 카톡 이식은 이 맥의 claude 구독으로 만들어 savePhotoDescription 만 부른다(scripts/photo-backfill.ts).
// 계획: mydocs/plans/2026-10-29-photo-search.md · 실측: mydocs/working/2026-10-29-photo-describe-bench.md
import sharp from "sharp"
import { generateText } from "ai"
import { prisma } from "@/lib/db"
import { openFileObject } from "@/lib/file-object"
import { syncEmbeddings } from "@/lib/embeddings"
import { modelFor, modelKey } from "@/lib/ai-models"
import { costOf } from "@/lib/ai-pricing"
import { realModel } from "@/lib/agent/model"
import { parsePhotoDescription, photoIndexText, photoPrompt, type PhotoContext } from "@/lib/photo-text"

/** 모델에 보내는 크기. 실험과 같은 값 — 문서 사진의 글자를 읽을 만하고 토큰은 2천 안쪽 */
const MAX_SIDE = 1280
const BEFORE = 6
const AFTER = 4

const isImage = (mimeType: string) => mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp"

const kst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)

/** 사진이 올라온 메시지 앞 6 · 뒤 4 와 그 메시지 본문, 붙은 업무. 메시지에 안 붙은 사진이면 null */
export async function photoContextFor(fileId: string): Promise<{ ctx: PhotoContext; file: { id: string; name: string; path: string; mimeType: string } } | null> {
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: {
      id: true, name: true, path: true, mimeType: true,
      task: { select: { name: true } },
      message: { select: { roomId: true, createdAt: true, content: true, deletedAt: true, room: { select: { kind: true } }, author: { select: { name: true } }, task: { select: { name: true } } } },
    },
  })
  // 색인과 같은 범위만 — 전사방 사진. 옴니스 1:1 · 단톡 사진은 그 방 사람만 보므로 설명도 만들지 않는다(밖으로 보내지도 않는다)
  if (!file?.message || file.message.deletedAt || file.message.room.kind !== "COMPANY" || !isImage(file.mimeType)) return null
  const m = file.message
  const select = { createdAt: true, content: true, author: { select: { name: true } } } as const
  const [before, after] = await Promise.all([
    prisma.chatMessage.findMany({ where: { roomId: m.roomId, createdAt: { lt: m.createdAt }, deletedAt: null }, orderBy: { createdAt: "desc" }, take: BEFORE, select }),
    prisma.chatMessage.findMany({ where: { roomId: m.roomId, createdAt: { gt: m.createdAt }, deletedAt: null }, orderBy: { createdAt: "asc" }, take: AFTER, select }),
  ])
  const line = (x: { createdAt: Date; content: string; author: { name: string } }) => `[${kst(x.createdAt)}] ${x.author.name}: ${x.content.slice(0, 300)}`
  // 카톡 사진 메시지 본문은 「Photo」 뿐이라 뺀다. 앱에서 올린 사진은 본문이 곧 사진 설명이다
  const own = /^(Photo|\d+ photos)$/.test(m.content.trim()) ? "" : ` ${m.content.slice(0, 300)}`
  return {
    file,
    ctx: {
      task: m.task?.name ?? file.task?.name ?? null,
      lines: [...before.reverse().map(line), `[${kst(m.createdAt)}] ${m.author.name}:${own} <<이 사진>>`, ...after.map(line)],
    },
  }
}

/** 설명 글을 저장하고 색인한다. 모델 출력이 JSON 으로 읽히지 않으면 저장하지 않고 false */
export async function savePhotoDescription(fileId: string, modelText: string, describedBy: string, userId?: string): Promise<boolean> {
  const parsed = parsePhotoDescription(modelText)
  if (!parsed) return false
  await prisma.file.update({
    where: { id: fileId },
    data: { description: photoIndexText(parsed), describedAt: new Date(), describedBy },
  })
  await syncEmbeddings("PHOTO", fileId, userId)
  return true
}

/** 앱에 올라온 사진 하나를 모델로 설명한다. 이미 했거나 사진이 아니면 건너뛴다 */
export async function describePhoto(fileId: string, userId?: string): Promise<"done" | "skipped" | "unparsed"> {
  const already = await prisma.file.findUnique({ where: { id: fileId }, select: { describedAt: true } })
  if (!already || already.describedAt) return "skipped"
  const found = await photoContextFor(fileId)
  if (!found) return "skipped"

  const obj = await openFileObject(found.file)
  const chunks: Buffer[] = []
  for await (const c of obj.body) chunks.push(Buffer.from(c))
  const image = await sharp(Buffer.concat(chunks)).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()

  const choice = modelFor("photo")
  const key = modelKey(choice)
  const r = await generateText({
    model: await realModel(choice),
    reasoning: choice.reasoning,
    ...(choice.vendor === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
    messages: [{ role: "user", content: [{ type: "text", text: photoPrompt(found.ctx) }, { type: "file", mediaType: "image/jpeg", data: image }] }],
  })

  const usage = {
    inputTokens: r.usage.inputTokens ?? 0,
    cachedInputTokens: r.usage.inputTokenDetails.cacheReadTokens ?? 0,
    outputTokens: r.usage.outputTokens ?? 0,
  }
  const cost = costOf(key, usage)
  await prisma.aiUsage.create({
    data: {
      vendor: choice.vendor, model: choice.model, feature: "photo",
      ...usage, reasoningTokens: r.usage.outputTokenDetails.reasoningTokens ?? 0,
      costUsd: cost.usd, costKrw: cost.krw, userId: userId ?? null,
    },
  })
  return (await savePhotoDescription(fileId, r.text, key, userId)) ? "done" : "unparsed"
}

/** 메시지 전송 뒤 백그라운드로 — 실패해도 업로드 · 전송은 그대로다. describedAt 이 빈 채로 남아 일괄이 다시 줍는다 */
export function describePhotosSafe(fileIds: string[], userId?: string): void {
  void (async () => {
    for (const id of fileIds) {
      try {
        const r = await describePhoto(id, userId)
        if (r === "unparsed") console.error("[photo] 설명을 읽지 못함", id)
      } catch (err) {
        console.error("[photo] 설명 실패", id, err)
      }
    }
  })()
}
