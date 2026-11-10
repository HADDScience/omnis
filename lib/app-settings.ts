// 운영 설정(AppSetting) 읽기 · 쓰기 — 재배포 없이 관리자 화면에서 바꾼다. 키별 모양은 쓰는 쪽 lib 에 있다.
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"

export async function readSetting(key: string): Promise<unknown> {
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } })
  return row?.value ?? null
}

export async function writeSetting(key: string, value: unknown, updatedById: string | null): Promise<void> {
  const v = value as Prisma.InputJsonValue
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: v, updatedById }, update: { value: v, updatedById } })
}

/** 한 번만 남기는 표시 — 처음이면 true. 같은 키가 이미 있으면 false(동시에 둘이 와도 하나만 true) */
export async function claimOnce(key: string, value: unknown): Promise<boolean> {
  const r = await prisma.appSetting.createMany({ data: [{ key, value: value as Prisma.InputJsonValue }], skipDuplicates: true })
  return r.count === 1
}
