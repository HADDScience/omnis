// JobStore 의 운영 구현 — prisma(WorkbenchJob · AiUsage · 채팅방) · NAS(File) · ip.oauth_tokens(단기 MCP 토큰).
// 서버 전용. Workflow 단계(steps.ts)와 서비스(service.ts)에서만 부른다.
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/db"
import { getSystemUserId } from "@/lib/system-user"
import { IS_DEMO, DEMO_STORAGE_MESSAGE } from "@/lib/demo"
import { randomToken, sha256 } from "@/lib/ip-mcp"
import type { WorkbenchCost } from "./pricing"
import type { Job, JobStatus, JobStore } from "./runner"

/** 이 client 로 발급한 토큰은 옴니스 MCP 에서 읽기 도구만 연다 — 마이그레이션 20261126180000_workbench 가 행을 만든다 */
export const WORKBENCH_CLIENT_ID = "omnis-workbench"

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  hwpx: "application/hwp+zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  zip: "application/zip",
}
export const mimeOfName = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"

const toJob = (r: {
  id: string; userId: string; roomId: string; request: string; model: string; status: string; budgetKrw: number
  sessionId: string | null; vaultId: string | null; tokenId: string | null; cursor: string | null; lastMessage: string | null
  startedAt: Date | null; costKrw: unknown
}): Job => ({ ...r, status: r.status as JobStatus, costKrw: Number(r.costKrw) })

export function prismaJobStore(opts: { tokenTtlMinutes: number }): JobStore {
  return {
    async get(id) {
      return toJob(await prisma.workbenchJob.findUniqueOrThrow({ where: { id } }))
    },
    async patch(id, d) {
      const { cost, ...rest } = d
      await prisma.workbenchJob.update({
        where: { id },
        data: {
          ...(rest.status !== undefined ? { status: rest.status } : {}),
          ...(rest.sessionId !== undefined ? { sessionId: rest.sessionId } : {}),
          ...(rest.vaultId !== undefined ? { vaultId: rest.vaultId } : {}),
          ...(rest.tokenId !== undefined ? { tokenId: rest.tokenId } : {}),
          ...(rest.cursor !== undefined ? { cursor: rest.cursor } : {}),
          ...(rest.lastMessage !== undefined ? { lastMessage: rest.lastMessage } : {}),
          ...(rest.startedAt !== undefined ? { startedAt: rest.startedAt } : {}),
          ...(rest.budgetKrw !== undefined ? { budgetKrw: rest.budgetKrw } : {}),
          ...(rest.error !== undefined ? { error: rest.error } : {}),
          ...(rest.finishedAt !== undefined ? { finishedAt: rest.finishedAt } : {}),
          ...(rest.outputFileIds !== undefined ? { outputFileIds: rest.outputFileIds } : {}),
          ...(cost
            ? {
                inputTokens: cost.inputTokens, cacheWriteTokens: cost.cacheWriteTokens, cacheReadTokens: cost.cacheReadTokens,
                outputTokens: cost.outputTokens, activeSeconds: Math.round(cost.activeSeconds), costUsd: cost.usd, costKrw: cost.krw,
              }
            : {}),
        },
      })
    },
    async post(job, text) {
      const systemId = await getSystemUserId()
      const now = new Date()
      await prisma.$transaction([
        prisma.chatMessage.create({ data: { roomId: job.roomId, authorId: systemId, content: text.slice(0, 8000), createdAt: now } }),
        prisma.chatRoom.update({ where: { id: job.roomId }, data: { lastMessageAt: now } }),
      ])
    },
    async saveOutput(job, file) {
      if (IS_DEMO) return { ok: false, reason: DEMO_STORAGE_MESSAGE }
      const { objectKeyFor, putObject, getObject, deleteObject, MAX_UPLOAD_BYTES } = await import("@/lib/storage")
      if (file.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: `너무 큽니다(${Math.round(file.bytes.length / 1024)}KB)` }
      const name = file.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "결과"
      const id = randomUUID()
      const key = objectKeyFor(id, name)
      const mime = mimeOfName(name)
      await putObject(key, file.bytes, mime)
      // 다시 읽어 크기를 대조한다 — NAS 저장 중 잘리는 일이 있었다
      const res = await getObject(key)
      let got = 0
      for await (const c of res.body) got += Buffer.from(c).length
      if (got !== file.bytes.length) {
        await deleteObject(key).catch(() => {})
        return { ok: false, reason: `저장 뒤 크기가 다릅니다(${got}/${file.bytes.length})` }
      }
      try {
        const systemId = await getSystemUserId()
        const now = new Date()
        await prisma.$transaction([
          prisma.chatMessage.create({
            data: {
              roomId: job.roomId, authorId: systemId, content: `📎 ${name}`, createdAt: now,
              files: { create: { id, name, path: `/api/files/${id}/raw`, size: file.bytes.length, mimeType: mime, privateToUserId: job.userId } },
            },
          }),
          prisma.chatRoom.update({ where: { id: job.roomId }, data: { lastMessageAt: now } }),
        ])
      } catch (e) {
        await deleteObject(key).catch(() => {})
        throw e
      }
      return { ok: true, fileId: id }
    },
    async recordUsage(job, cost: WorkbenchCost) {
      await prisma.aiUsage.create({
        data: {
          vendor: "anthropic",
          model: job.model,
          feature: "workbench",
          inputTokens: cost.inputTokens + cost.cacheWriteTokens + cost.cacheReadTokens,
          cachedInputTokens: cost.cacheReadTokens,
          cacheWriteTokens: cost.cacheWriteTokens,
          outputTokens: cost.outputTokens,
          activeSeconds: Math.round(cost.activeSeconds),
          costUsd: cost.usd,
          costKrw: cost.krw,
          userId: job.userId,
          roomId: job.roomId,
          runId: job.id,
        },
      })
    },
    async mintToken(job) {
      const token = randomToken(32)
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO ip.oauth_tokens (access_hash, refresh_hash, client_id, user_id, expires_at)
        VALUES (${sha256(token)}, NULL, ${WORKBENCH_CLIENT_ID}, ${job.userId}, ${new Date(Date.now() + opts.tokenTtlMinutes * 60_000)})
        RETURNING id::text AS id`
      return { token, tokenId: rows[0].id }
    },
    async revokeToken(tokenId) {
      await prisma.$executeRaw`UPDATE ip.oauth_tokens SET revoked_at = now() WHERE id = ${tokenId}::uuid AND revoked_at IS NULL`
    },
  }
}
