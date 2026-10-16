// 업무 변경 이력(TaskEvent) 쓰기 — 업무를 바꾸는 길마다 여기를 지난다.
//
// 값이 실제로 바뀐 것만 남긴다. 화면은 상태를 안 바꿔도 PATCH 에 status 를 실어 보내기 때문에
// 그대로 다 적으면 「상태 변경」이 부풀어 KPI 가 거짓말을 한다. 설계: mydocs/plans/2026-10-16-kpi-metrics.md
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import type { TaskEventField, TaskEventVia } from "@/lib/schemas/task-event"

type Db = Prisma.TransactionClient | typeof prisma

export interface TaskChange {
  field: TaskEventField
  before: unknown
  after: unknown
}

/** 비교와 저장에 쓰는 모양 — 날짜는 ISO 문자열, 담당자 목록은 정렬해 순서만 다른 것을 같게 본다. */
function normalize(field: TaskEventField, v: unknown): Prisma.InputJsonValue | null {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v.toISOString()
  if (field === "assignees" && Array.isArray(v)) return [...v].map(String).sort()
  return v as Prisma.InputJsonValue
}

/** 키 순서와 무관한 문자열 — DB 에서 읽은 값(JSONB 는 키를 정렬한다)과 코드가 만든 값을 같은 잣대로 잰다. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return JSON.stringify(v)
}

/** 바뀐 것만 골라 한 번에 넣는다. 넣은 줄 수를 돌려준다. */
export async function recordTaskEvents(
  taskId: string,
  actorId: string | null,
  via: TaskEventVia,
  changes: TaskChange[],
  db: Db = prisma
): Promise<number> {
  const rows = changes
    .map((c) => ({ field: c.field, before: normalize(c.field, c.before), after: normalize(c.field, c.after) }))
    .filter((c) => stable(c.before) !== stable(c.after))
    .map((c) => ({
      taskId,
      actorId,
      via,
      field: c.field,
      // Json? 칸에 null 을 그대로 주면 Prisma 가 거부한다 — 빼 두면 NULL 로 들어간다
      before: c.before ?? undefined,
      after: c.after ?? undefined,
    }))
  if (rows.length === 0) return 0
  await db.taskEvent.createMany({ data: rows })
  return rows.length
}
