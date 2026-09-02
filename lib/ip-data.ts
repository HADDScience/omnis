// 지식재산권(ip 스키마) 데이터 접근.
//
// ip 스키마는 Prisma 모델로 만들지 않았다. 이 스키마의 값어치는 표가 아니라
// plpgsql 에 있고(apply_progress_entry 가 출원일·등록일을 정한다), 그걸 그대로
// 옮기려면 컬럼 이름까지 원본과 같아야 했다. Prisma 는 datasource 에 적힌 스키마만
// 들여다보므로 ip 는 Prisma 의 시야 밖이다 — 덕분에 migrate 가 이 표들을 지우려
// 들지 않는다. 대신 접근은 전부 raw SQL 이고, 그 SQL 을 이 파일 하나에 모은다.
//
// 쓰기는 반드시 withActor 를 거친다. 트리거(touch_row, write_audit)가
// ip.current_actor() 로 "누가 고쳤는지"를 읽기 때문이다. 예전 Supabase 에서
// auth.uid() 가 하던 일을 트랜잭션 지역 설정으로 대신한다.

import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma"

export type EntityKind = "trademark" | "patent"
export type IpRole = "owner" | "editor" | "viewer"

// ─── 행위자 ─────────────────────────────────────────────────────────

/**
 * 한 트랜잭션 안에서 "지금 누가 쓰는지"를 심고 작업을 돌린다.
 *
 * set_config 의 세 번째 인자 true 는 **트랜잭션 지역**이라는 뜻이다. 커넥션 풀에서
 * 같은 연결을 다음 요청이 물려받아도 남의 이름이 따라가지 않는다. 이걸 false 로
 * 두면 서버리스 환경에서 감사 기록의 주인이 뒤섞인다.
 */
export async function withActor<T>(
  userId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`
    return work(tx)
  })
}

// ─── 권한 ───────────────────────────────────────────────────────────

export interface IpMembership {
  userId: string
  email: string
  displayName: string | null
  role: IpRole
}

/**
 * 이 사람이 지식재산권 자료에 들어올 수 있는가.
 *
 * 예전에는 RLS 가 판단했다. 지금은 여기서 판단한다 — Prisma 는 DB 소유자로
 * 접속하므로 RLS 를 켜 둬도 어차피 통과한다. 있는 척하는 방어막을 두느니
 * 판단하는 자리를 한 군데로 못박는 편이 낫다. 모든 라우트가 이 함수를 지난다.
 */
export async function getMembership(userId: string): Promise<IpMembership | null> {
  const rows = await prisma.$queryRaw<
    { user_id: string; email: string; display_name: string | null; role: IpRole }[]
  >`SELECT user_id, email, display_name, role FROM ip.members WHERE user_id = ${userId}`
  if (rows.length === 0) return null
  const r = rows[0]
  return { userId: r.user_id, email: r.email, displayName: r.display_name, role: r.role }
}

export function canWrite(m: IpMembership | null): boolean {
  return m !== null && m.role !== "viewer"
}

// ─── 읽기 ───────────────────────────────────────────────────────────

export interface IpCase {
  kind: EntityKind
  id: string
  /** 상표는 name, 특허는 title */
  name: string
  nameKo: string | null
  classes: string[]
  goods: string | null
  holder: string | null
  status: string
  appNo: string | null
  regNo: string | null
  refDate: string | null
  filedOn: string | null
  registeredOn: string | null
  probability: number | null
  note: string
}

export interface IpProgress {
  id: string
  entityKind: EntityKind
  entityId: string
  occurredOn: string
  stage: string
  direction: string | null
  counterpart: string
  nextTurn: "us" | "firm" | "none"
  dueOn: string | null
  note: string
  source: string
}

/** date 컬럼을 'YYYY-MM-DD' 로. 시간대에 밀려 하루가 어긋나면 안 되는 값들이다. */
function ymd(value: Date | string | null): string | null {
  if (value === null) return null
  if (typeof value === "string") return value.slice(0, 10)
  // node-postgres 는 date 를 자정 UTC 의 Date 로 준다. toISOString 이 안전하다.
  return value.toISOString().slice(0, 10)
}

/** 상표와 특허를 한 목록으로. 화면과 지식 색인이 둘 다 이 모양을 쓴다. */
export async function listCases(): Promise<IpCase[]> {
  const trademarks = await prisma.$queryRaw<Record<string, never>[]>`
    SELECT id, name, name_ko, classes, goods, holder, status, app_no, reg_no,
           ref_date, filed_on, registered_on, probability, note
      FROM ip.trademarks ORDER BY id`
  const patents = await prisma.$queryRaw<Record<string, never>[]>`
    SELECT id, title AS name, applicant AS holder, status, app_no, reg_no,
           ref_date, filed_on, registered_on, note
      FROM ip.patents ORDER BY id`

  const asCase = (r: Record<string, unknown>, kind: EntityKind): IpCase => ({
    kind,
    id: String(r.id),
    name: String(r.name ?? ""),
    nameKo: (r.name_ko as string | undefined) ?? null,
    classes: (r.classes as string[] | undefined) ?? [],
    goods: (r.goods as string | undefined) ?? null,
    holder: (r.holder as string | null | undefined) ?? null,
    status: String(r.status ?? ""),
    appNo: (r.app_no as string | null | undefined) ?? null,
    regNo: (r.reg_no as string | null | undefined) ?? null,
    refDate: ymd((r.ref_date as Date | null) ?? null),
    filedOn: ymd((r.filed_on as Date | null) ?? null),
    registeredOn: ymd((r.registered_on as Date | null) ?? null),
    probability: (r.probability as number | null | undefined) ?? null,
    note: String(r.note ?? ""),
  })

  return [
    ...trademarks.map((r) => asCase(r, "trademark")),
    ...patents.map((r) => asCase(r, "patent")),
  ]
}

/** 한 건의 진행 이력. 오래된 것부터 — 이야기 순서대로 읽히게. */
export async function listProgressFor(
  kind: EntityKind,
  id: string
): Promise<IpProgress[]> {
  const rows = await prisma.$queryRaw<Record<string, never>[]>`
    SELECT id, entity_kind, entity_id, occurred_on, stage, direction,
           counterpart, next_turn, due_on, note, source
      FROM ip.progress_entries
     WHERE entity_kind = ${kind} AND entity_id = ${id}
     ORDER BY occurred_on ASC, created_at ASC`
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    entityKind: r.entity_kind as EntityKind,
    entityId: String(r.entity_id),
    occurredOn: ymd(r.occurred_on as Date) ?? "",
    stage: String(r.stage ?? ""),
    direction: (r.direction as string | null | undefined) ?? null,
    counterpart: String(r.counterpart ?? ""),
    nextTurn: r.next_turn as IpProgress["nextTurn"],
    dueOn: ymd((r.due_on as Date | null) ?? null),
    note: String(r.note ?? ""),
    source: String(r.source ?? ""),
  }))
}

/**
 * 아직 차례가 남아 있는 일. "밀린 IP 업무" 질문이 이걸 본다.
 *
 * 건마다 **가장 최근 기록 하나**만 본다. 옛 기록의 「회신 필요」는 이미 지나간
 * 상태다 — 이력을 통째로 세면 한 건이 거쳐 온 단계 수만큼 중복으로 잡힌다.
 *
 * 값 정정(source='edit')은 최신 판정에서 아예 뺀다. 정정은 누구 차례인지에 대해
 * 아무 말도 하지 않으므로, 그것을 최신으로 치면 정정 한 번에 밀린 일이 목록에서
 * 사라진다. (ip-platform 의 todo-view·site-nav 와 같은 규칙이다.)
 */
export async function listOpenTurns(): Promise<
  (IpProgress & { caseName: string })[]
> {
  const rows = await prisma.$queryRaw<Record<string, never>[]>`
    WITH latest AS (
      SELECT DISTINCT ON (pe.entity_kind, pe.entity_id) pe.*
        FROM ip.progress_entries pe
       WHERE pe.source <> 'edit'
       ORDER BY pe.entity_kind, pe.entity_id, pe.occurred_on DESC, pe.created_at DESC
    )
    SELECT l.id, l.entity_kind, l.entity_id, l.occurred_on, l.stage,
           l.direction, l.counterpart, l.next_turn, l.due_on, l.note, l.source,
           coalesce(t.name, p.title, l.entity_id) AS case_name
      FROM latest l
      LEFT JOIN ip.trademarks t ON l.entity_kind = 'trademark' AND t.id = l.entity_id
      LEFT JOIN ip.patents    p ON l.entity_kind = 'patent'    AND p.id = l.entity_id
     WHERE l.next_turn <> 'none'
     ORDER BY l.due_on NULLS LAST, l.occurred_on DESC`
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    entityKind: r.entity_kind as EntityKind,
    entityId: String(r.entity_id),
    occurredOn: ymd(r.occurred_on as Date) ?? "",
    stage: String(r.stage ?? ""),
    direction: (r.direction as string | null | undefined) ?? null,
    counterpart: String(r.counterpart ?? ""),
    nextTurn: r.next_turn as IpProgress["nextTurn"],
    dueOn: ymd((r.due_on as Date | null) ?? null),
    note: String(r.note ?? ""),
    source: String(r.source ?? ""),
    caseName: String(r.case_name ?? ""),
  }))
}

/** 지식 색인이 쓰는 식별자. "trademark:TM-01" 처럼 종류와 번호를 함께 담는다. */
export function caseKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`
}

export function parseCaseKey(key: string): { kind: EntityKind; id: string } | null {
  const [kind, ...rest] = key.split(":")
  if (kind !== "trademark" && kind !== "patent") return null
  const id = rest.join(":")
  return id ? { kind, id } : null
}
