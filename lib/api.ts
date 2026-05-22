import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"

export function apiError(status: number, message: string, details?: unknown) {
  console.error("[api:error]", { status, message, details })
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(details === undefined ? {} : { details }),
    },
    { status }
  )
}

export async function parseJson<T = Record<string, unknown>>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch (err) {
    console.error("[api:parse-json]", err)
    return null
  }
}

export async function writeActivity(input: {
  userId?: string | null
  action: string
  entity: string
  entityId?: string | null
  title: string
  metadata?: Prisma.InputJsonValue
}) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        title: input.title,
        metadata: input.metadata,
      },
    })
  } catch (err) {
    console.error("[activity-log] write failed", { input, err })
  }
}
