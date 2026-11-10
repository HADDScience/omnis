// R2 에 있는 큰 첨부 찾기 — lib/file-object.ts 와 /api/files/[fileId]/raw 가 부른다
import { prisma } from "@/lib/db"

/** 표가 아직 없는 운영(마이그레이션 전)에서는 R2 파일이 없는 것으로 본다 */
export async function findR2Object(fileId: string): Promise<{ key: string } | null> {
  try {
    return await prisma.fileR2Object.findUnique({ where: { fileId }, select: { key: true } })
  } catch (e) {
    if ((e as { code?: string }).code === "P2021") return null
    throw e
  }
}
