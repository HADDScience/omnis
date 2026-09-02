// 지식재산권(ip 스키마) 데이터 접근.
//
// ip 스키마는 Prisma 모델로 만들지 않았다. 이 스키마의 값어치는 표가 아니라
// plpgsql 에 있고(apply_progress_entry 가 출원일·등록일을 정한다), 그걸 그대로
// 옮기려면 컬럼 이름까지 원본과 같아야 했다. Prisma 는 datasource 에 적힌 스키마만
// 들여다보므로 ip 는 Prisma 의 시야 밖이다 — 덕분에 migrate 가 이 표들을 지우려
// 들지 않는다. 대신 접근은 전부 raw SQL 이고, 그 SQL 을 이 파일 하나에 모은다.
//
// 돌려주는 모양은 ip-platform 의 앱 타입 그대로다(camelCase). 예전에는 화면 코드가
// 행을 받을 때마다 손으로 갈아 끼웠는데, 그 층을 여기로 옮기면 ip-platform 의
// lib/db.ts 는 전송 수단만 바뀌고 함수 모양은 그대로 남는다 — 화면 코드를 한 줄도
// 건드리지 않아도 된다는 뜻이고, 그것이 이 이사에서 회귀를 줄이는 가장 큰 장치다.
//
// 쓰기는 반드시 withActor 를 거친다. 트리거(touch_row, write_audit)가
// ip.current_actor() 로 "누가 고쳤는지"를 읽기 때문이다. 예전 Supabase 에서
// auth.uid() 가 하던 일을 트랜잭션 지역 설정으로 대신한다.

import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma"

export type EntityKind = "trademark" | "patent"
export type IpRole = "owner" | "editor" | "viewer"
export type NextTurn = "us" | "firm" | "none"

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

// ─── 앱 타입 (ip-platform 의 lib/types.ts 와 같은 모양) ───────────────

export interface Trademark {
  id: string
  name: string
  nameKo: string
  classes: string[]
  goods: string | null
  appNo: string | null
  regNo: string | null
  date: string | null
  filedOn: string | null
  registeredOn: string | null
  holder: string | null
  status: string
  probability: number | null
  note: string
}

export interface Patent {
  id: string
  title: string
  appNo: string | null
  regNo: string | null
  date: string | null
  filedOn: string | null
  registeredOn: string | null
  applicant: string
  status: string
  note: string
}

export interface ProgressEntry {
  id: string
  date: string
  entityKind: EntityKind
  entityId: string
  stage: string
  direction: string | null
  counterpart: string
  nextTurn: NextTurn
  dueOn: string | null
  appNo: string | null
  regNo: string | null
  probability: number | null
  name: string | null
  holder: string | null
  note: string
  source: string
  raw: string | null
  createdAt: string
}

export interface CommunicationLink {
  kind: EntityKind
  id: string
}

export interface Communication {
  id: string
  date: string
  dir: string
  from: string
  to: string
  target: string
  subject: string
  body: string
  attachments: string[]
  followUp: string
  open: boolean
  threadId: string | null
  links: CommunicationLink[]
}

export interface ActionItem {
  id: string
  target: string
  subject: string
  requestedAt: string | null
  requester: string | null
  todo: string
  owner: string
  priority: string
  note: string
  state: string
  resolution: string | null
  resolvedAt: string | null
}

export interface IntegrityFlagRow {
  id: string
  entityKind: string
  entityId: string | null
  message: string
  source: string
  state: string
  resolution: string | null
  resolvedAt: string | null
}

export interface StatusOption {
  kind: EntityKind
  value: string
  sortOrder: number
  tone: string
  isOpen: boolean
}

export interface Stage extends StatusOption {
  wantsAppNo: boolean
  wantsRegNo: boolean
  wantsProbability: boolean
  wantsDue: boolean
  selectable: boolean
}

export interface OrgMeta {
  org: string
  owner: string
  firm: {
    name: string
    attorney: string
    email: string
    tel: string
    mobile: string
    staff: string[]
  }
  note: string
}

export interface OpeningState {
  stage: string
  refDate: string | null
  name: string
  holder: string | null
  appNo: string | null
  regNo: string | null
  takenOverOn: string
  sourceNote: string
}

export interface Snapshot {
  trademarks: Trademark[]
  patents: Patent[]
  progress: ProgressEntry[]
  communications: Communication[]
  actions: ActionItem[]
  flags: IntegrityFlagRow[]
  statusOptions: StatusOption[]
  stages: Stage[]
  meta: OrgMeta
  /** `kind:id` → 넘겨받은 시점의 값 */
  openingState: Record<string, OpeningState>
}

// ─── 변환 ───────────────────────────────────────────────────────────

/**
 * date 컬럼을 'YYYY-MM-DD' 로.
 *
 * 출원일·등록일·기한은 달력상의 날짜지 시각이 아니다. Date 그대로 JSON 에 실으면
 * 시간대에 밀려 하루가 어긋나고, 법정 기한에서는 그 하루가 전부다.
 * Postgres 의 date 는 자정 UTC 의 Date 로 오므로 UTC 기준으로 잘라야 맞다.
 */
function ymd(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return null
}

/** timestamptz 는 시각이므로 ISO 문자열 그대로 넘긴다. */
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return null
}

const str = (v: unknown, fallback = ""): string =>
  v === null || v === undefined ? fallback : String(v)

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

const nullableStr = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v)

type Row = Record<string, unknown>

const toTrademark = (r: Row): Trademark => ({
  id: str(r.id),
  name: str(r.name),
  nameKo: str(r.name_ko),
  classes: (r.classes as string[] | null) ?? [],
  goods: nullableStr(r.goods),
  appNo: nullableStr(r.app_no),
  regNo: nullableStr(r.reg_no),
  date: ymd(r.ref_date),
  filedOn: ymd(r.filed_on),
  registeredOn: ymd(r.registered_on),
  holder: nullableStr(r.holder),
  status: str(r.status),
  probability: num(r.probability),
  note: str(r.note),
})

const toPatent = (r: Row): Patent => ({
  id: str(r.id),
  title: str(r.title),
  appNo: nullableStr(r.app_no),
  regNo: nullableStr(r.reg_no),
  date: ymd(r.ref_date),
  filedOn: ymd(r.filed_on),
  registeredOn: ymd(r.registered_on),
  applicant: str(r.applicant),
  status: str(r.status),
  note: str(r.note),
})

const toProgress = (r: Row): ProgressEntry => ({
  id: str(r.id),
  date: ymd(r.occurred_on) ?? "",
  entityKind: r.entity_kind as EntityKind,
  entityId: str(r.entity_id),
  stage: str(r.stage),
  direction: nullableStr(r.direction),
  counterpart: str(r.counterpart),
  nextTurn: r.next_turn as NextTurn,
  dueOn: ymd(r.due_on),
  appNo: nullableStr(r.app_no),
  regNo: nullableStr(r.reg_no),
  probability: num(r.probability),
  name: nullableStr(r.name),
  holder: nullableStr(r.holder),
  note: str(r.note),
  source: str(r.source),
  raw: nullableStr(r.raw),
  createdAt: iso(r.created_at) ?? "",
})

const toCommunication = (r: Row): Communication => ({
  id: str(r.id),
  date: ymd(r.occurred_on) ?? "",
  dir: str(r.direction),
  from: str(r.from_name),
  to: str(r.to_name),
  target: str(r.target),
  subject: str(r.subject),
  body: str(r.body),
  attachments: (r.attachments as string[] | null) ?? [],
  followUp: str(r.follow_up),
  open: Boolean(r.is_open),
  threadId: nullableStr(r.gmail_thread_id),
  links: ((r.links as { kind: string; id: string }[] | null) ?? []).map((l) => ({
    kind: l.kind as EntityKind,
    id: l.id,
  })),
})

const toAction = (r: Row): ActionItem => ({
  id: str(r.id),
  target: str(r.target),
  subject: str(r.subject),
  requestedAt: ymd(r.requested_at),
  requester: nullableStr(r.requester),
  todo: str(r.todo),
  owner: str(r.owner_name),
  priority: str(r.priority),
  note: str(r.note),
  state: str(r.state),
  resolution: nullableStr(r.resolution),
  resolvedAt: iso(r.resolved_at),
})

const toFlag = (r: Row): IntegrityFlagRow => ({
  id: str(r.id),
  entityKind: str(r.entity_kind),
  entityId: nullableStr(r.entity_id),
  message: str(r.message),
  source: str(r.source),
  state: str(r.state),
  resolution: nullableStr(r.resolution),
  resolvedAt: iso(r.resolved_at),
})

// ─── 조회 ───────────────────────────────────────────────────────────

/**
 * 화면 한 판에 필요한 것 전부. 자료가 백여 행뿐이라 전량을 한 번에 읽는다.
 *
 * 진행 기록의 정렬에 created_at 을 함께 쓰는 이유: 같은 날 기록이 여럿이면
 * 날짜만으로는 순서가 정해지지 않아 새로고침할 때마다 줄이 뒤바뀐다.
 */
export async function fetchSnapshot(): Promise<Snapshot> {
  const [trademarks, patents, progress, communications, actions, flags, options, meta, opening] =
    await Promise.all([
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.trademarks ORDER BY id`,
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.patents ORDER BY id`,
      prisma.$queryRaw<Row[]>`
        SELECT * FROM ip.progress_entries
         ORDER BY occurred_on DESC, created_at DESC`,
      prisma.$queryRaw<Row[]>`
        SELECT c.*,
               coalesce(
                 (SELECT json_agg(json_build_object('kind', l.entity_kind, 'id', l.entity_id))
                    FROM ip.communication_links l
                   WHERE l.communication_id = c.id),
                 '[]'::json
               ) AS links
          FROM ip.communications c
         ORDER BY c.occurred_on DESC`,
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.actions ORDER BY id`,
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.integrity_flags ORDER BY created_at`,
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.status_options ORDER BY kind, sort_order`,
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.org_meta WHERE id = 1`,
      prisma.$queryRaw<Row[]>`SELECT * FROM ip.opening_state`,
    ])

  const metaRow = meta[0]
  const openingState: Record<string, OpeningState> = {}
  for (const r of opening) {
    openingState[`${str(r.entity_kind)}:${str(r.entity_id)}`] = {
      stage: str(r.stage),
      refDate: ymd(r.ref_date),
      name: str(r.name),
      holder: nullableStr(r.holder),
      appNo: nullableStr(r.app_no),
      regNo: nullableStr(r.reg_no),
      takenOverOn: ymd(r.taken_over_on) ?? "",
      sourceNote: str(r.source_note),
    }
  }

  return {
    trademarks: trademarks.map(toTrademark),
    patents: patents.map(toPatent),
    progress: progress.map(toProgress),
    communications: communications.map(toCommunication),
    actions: actions.map(toAction),
    flags: flags.map(toFlag),
    // status_options 는 배지 색(statusOptions)과 양식의 단계 정의(stages)를 겸한다.
    statusOptions: options.map((r) => ({
      kind: r.kind as EntityKind,
      value: str(r.value),
      sortOrder: Number(r.sort_order),
      tone: str(r.tone),
      isOpen: Boolean(r.is_open),
    })),
    stages: options.map((r) => ({
      kind: r.kind as EntityKind,
      value: str(r.value),
      sortOrder: Number(r.sort_order),
      tone: str(r.tone),
      isOpen: Boolean(r.is_open),
      wantsAppNo: Boolean(r.wants_app_no),
      wantsRegNo: Boolean(r.wants_reg_no),
      wantsProbability: Boolean(r.wants_probability),
      wantsDue: Boolean(r.wants_due),
      selectable: Boolean(r.selectable),
    })),
    meta: {
      org: str(metaRow?.org, "HADD SCIENCE"),
      owner: str(metaRow?.owner_name),
      firm: (metaRow?.firm as OrgMeta["firm"]) ?? {
        name: "",
        attorney: "",
        email: "",
        tel: "",
        mobile: "",
        staff: [],
      },
      note: str(metaRow?.note),
    },
    openingState,
  }
}

/** 한 건의 진행 이력. 오래된 것부터 — 이야기 순서대로 읽히게. */
export async function listProgressFor(
  kind: EntityKind,
  id: string
): Promise<ProgressEntry[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM ip.progress_entries
     WHERE entity_kind = ${kind} AND entity_id = ${id}
     ORDER BY occurred_on ASC, created_at ASC`
  return rows.map(toProgress)
}

export interface IpCase {
  kind: EntityKind
  id: string
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

/** 상표와 특허를 한 목록으로. 지식 색인과 현황 요약이 이 모양을 쓴다. */
export async function listCases(): Promise<IpCase[]> {
  const snap = await fetchSnapshot()
  return [
    ...snap.trademarks.map((t) => ({
      kind: "trademark" as const,
      id: t.id,
      name: t.name,
      nameKo: t.nameKo,
      classes: t.classes,
      goods: t.goods,
      holder: t.holder,
      status: t.status,
      appNo: t.appNo,
      regNo: t.regNo,
      refDate: t.date,
      filedOn: t.filedOn,
      registeredOn: t.registeredOn,
      probability: t.probability,
      note: t.note,
    })),
    ...snap.patents.map((p) => ({
      kind: "patent" as const,
      id: p.id,
      name: p.title,
      nameKo: null,
      classes: [],
      goods: null,
      holder: p.applicant || null,
      status: p.status,
      appNo: p.appNo,
      regNo: p.regNo,
      refDate: p.date,
      filedOn: p.filedOn,
      registeredOn: p.registeredOn,
      probability: null,
      note: p.note,
    })),
  ]
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
  (ProgressEntry & { caseName: string })[]
> {
  const rows = await prisma.$queryRaw<Row[]>`
    WITH latest AS (
      SELECT DISTINCT ON (pe.entity_kind, pe.entity_id) pe.*
        FROM ip.progress_entries pe
       WHERE pe.source <> 'edit'
       ORDER BY pe.entity_kind, pe.entity_id, pe.occurred_on DESC, pe.created_at DESC
    )
    SELECT l.*, coalesce(t.name, p.title, l.entity_id) AS case_name
      FROM latest l
      LEFT JOIN ip.trademarks t ON l.entity_kind = 'trademark' AND t.id = l.entity_id
      LEFT JOIN ip.patents    p ON l.entity_kind = 'patent'    AND p.id = l.entity_id
     WHERE l.next_turn <> 'none'
     ORDER BY l.due_on NULLS LAST, l.occurred_on DESC`
  return rows.map((r) => ({ ...toProgress(r), caseName: str(r.case_name) }))
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

// ─── 쓰기 ───────────────────────────────────────────────────────────
//
// 전부 withActor 안에서 돈다. 트리거가 행위자를 읽어야 감사 기록이 남는다.

export interface ProgressInput {
  id?: string
  date: string
  entityKind: EntityKind
  entityId: string
  stage: string
  direction: string | null
  counterpart: string
  nextTurn: NextTurn
  dueOn: string | null
  appNo: string | null
  regNo: string | null
  probability: number | null
  name: string | null
  holder: string | null
  note: string
  source: string
  raw: string | null
}

/**
 * 진행 기록 저장.
 *
 * 대장(상표·특허) 반영은 여기서 하지 않는다 — DB 트리거(ip.apply_progress_entry)의
 * 몫이다. 클라이언트에서 두 번 쓰지 않는 이유는, 여럿이 동시에 넣을 때
 * "더 최신 기록만 단계를 덮어쓴다" 판정이 서버 한 곳에 있어야 하기 때문이다.
 */
export async function saveProgress(
  userId: string,
  e: ProgressInput,
  isNew: boolean
): Promise<void> {
  await withActor(userId, async (tx) => {
    if (isNew) {
      await tx.$executeRaw`
        INSERT INTO ip.progress_entries
          (occurred_on, entity_kind, entity_id, stage, direction, counterpart,
           next_turn, due_on, app_no, reg_no, probability, name, holder, note, source, raw)
        VALUES
          (${e.date}::date, ${e.entityKind}, ${e.entityId}, ${e.stage}, ${e.direction},
           ${e.counterpart}, ${e.nextTurn}, ${e.dueOn}::date, ${e.appNo}, ${e.regNo},
           ${e.probability}, ${e.name}, ${e.holder}, ${e.note}, ${e.source}, ${e.raw})`
      return
    }
    await tx.$executeRaw`
      UPDATE ip.progress_entries SET
        occurred_on = ${e.date}::date, entity_kind = ${e.entityKind}, entity_id = ${e.entityId},
        stage = ${e.stage}, direction = ${e.direction}, counterpart = ${e.counterpart},
        next_turn = ${e.nextTurn}, due_on = ${e.dueOn}::date, app_no = ${e.appNo},
        reg_no = ${e.regNo}, probability = ${e.probability}, name = ${e.name},
        holder = ${e.holder}, note = ${e.note}, source = ${e.source}, raw = ${e.raw}
      WHERE id = ${e.id}::uuid`
  })
}

/**
 * 대장에 없는 건을 기록하면서 새로 만든다.
 * 번호 매기기와 출발선 생성은 ip.create_case 가 한다 — 지운 건이 있어도 번호를
 * 되쓰지 않는 규칙이 거기 있다.
 */
export async function createCase(
  userId: string,
  kind: EntityKind,
  name: string,
  stage: string,
  note = ""
): Promise<string> {
  return withActor(userId, async (tx) => {
    const rows = await tx.$queryRaw<{ create_case: string }[]>`
      SELECT ip.create_case(${kind}, ${name}, ${stage}, ${note}) AS create_case`
    return rows[0].create_case
  })
}

export async function removeProgress(userId: string, id: string): Promise<void> {
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`DELETE FROM ip.progress_entries WHERE id = ${id}::uuid`
  })
}

export async function setNextTurn(
  userId: string,
  id: string,
  nextTurn: NextTurn
): Promise<void> {
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`
      UPDATE ip.progress_entries SET next_turn = ${nextTurn} WHERE id = ${id}::uuid`
  })
}

/**
 * 차례와 기한만 고친다.
 *
 * 단계·번호처럼 사실을 말하는 칸은 건드리지 않는다 — 그쪽은 값 정정이나 새 기록의
 * 몫이다. 여기서 바꾸는 것은 "이 일이 아직 우리 차례인가"와 "언제까지인가"뿐이다.
 */
export async function setTurnAndDue(
  userId: string,
  id: string,
  nextTurn: NextTurn,
  dueOn: string | null
): Promise<void> {
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`
      UPDATE ip.progress_entries
         SET next_turn = ${nextTurn}, due_on = ${dueOn}::date
       WHERE id = ${id}::uuid`
  })
}

export async function saveTrademark(
  userId: string,
  t: Trademark,
  isNew: boolean
): Promise<void> {
  await withActor(userId, async (tx) => {
    if (isNew) {
      await tx.$executeRaw`
        INSERT INTO ip.trademarks
          (id, name, name_ko, classes, goods, app_no, reg_no, ref_date, filed_on,
           registered_on, holder, status, probability, note)
        VALUES
          (${t.id}, ${t.name}, ${t.nameKo}, ${t.classes}, ${t.goods}, ${t.appNo},
           ${t.regNo}, ${t.date}::date, ${t.filedOn}::date, ${t.registeredOn}::date,
           ${t.holder}, ${t.status}, ${t.probability}, ${t.note})`
      return
    }
    await tx.$executeRaw`
      UPDATE ip.trademarks SET
        name = ${t.name}, name_ko = ${t.nameKo}, classes = ${t.classes}, goods = ${t.goods},
        app_no = ${t.appNo}, reg_no = ${t.regNo}, ref_date = ${t.date}::date,
        filed_on = ${t.filedOn}::date, registered_on = ${t.registeredOn}::date,
        holder = ${t.holder}, status = ${t.status}, probability = ${t.probability},
        note = ${t.note}
      WHERE id = ${t.id}`
  })
}

export async function savePatent(
  userId: string,
  p: Patent,
  isNew: boolean
): Promise<void> {
  await withActor(userId, async (tx) => {
    if (isNew) {
      await tx.$executeRaw`
        INSERT INTO ip.patents
          (id, title, app_no, reg_no, ref_date, filed_on, registered_on, applicant, status, note)
        VALUES
          (${p.id}, ${p.title}, ${p.appNo}, ${p.regNo}, ${p.date}::date,
           ${p.filedOn}::date, ${p.registeredOn}::date, ${p.applicant}, ${p.status}, ${p.note})`
      return
    }
    await tx.$executeRaw`
      UPDATE ip.patents SET
        title = ${p.title}, app_no = ${p.appNo}, reg_no = ${p.regNo},
        ref_date = ${p.date}::date, filed_on = ${p.filedOn}::date,
        registered_on = ${p.registeredOn}::date, applicant = ${p.applicant},
        status = ${p.status}, note = ${p.note}
      WHERE id = ${p.id}`
  })
}

export async function saveCommunication(
  userId: string,
  c: Communication,
  isNew: boolean
): Promise<string> {
  return withActor(userId, async (tx) => {
    let id = c.id
    if (isNew) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ip.communications
          (occurred_on, direction, from_name, to_name, target, subject, body,
           attachments, follow_up, is_open, gmail_thread_id)
        VALUES
          (${c.date}::date, ${c.dir}, ${c.from}, ${c.to}, ${c.target}, ${c.subject},
           ${c.body}, ${c.attachments}, ${c.followUp}, ${c.open}, ${c.threadId})
        RETURNING id`
      id = rows[0].id
    } else {
      await tx.$executeRaw`
        UPDATE ip.communications SET
          occurred_on = ${c.date}::date, direction = ${c.dir}, from_name = ${c.from},
          to_name = ${c.to}, target = ${c.target}, subject = ${c.subject}, body = ${c.body},
          attachments = ${c.attachments}, follow_up = ${c.followUp}, is_open = ${c.open},
          gmail_thread_id = ${c.threadId}
        WHERE id = ${c.id}::uuid`
    }

    // 연결은 통째로 갈아끼운다 (개수가 적어 diff 할 이유가 없다).
    await tx.$executeRaw`
      DELETE FROM ip.communication_links WHERE communication_id = ${id}::uuid`
    for (const l of c.links) {
      await tx.$executeRaw`
        INSERT INTO ip.communication_links (communication_id, entity_kind, entity_id)
        VALUES (${id}::uuid, ${l.kind}, ${l.id})`
    }
    return id
  })
}

export async function saveAction(
  userId: string,
  a: ActionItem,
  isNew: boolean
): Promise<void> {
  await withActor(userId, async (tx) => {
    if (isNew) {
      await tx.$executeRaw`
        INSERT INTO ip.actions
          (id, target, subject, requested_at, requester, todo, owner_name, priority,
           note, state, resolution, resolved_at)
        VALUES
          (${a.id}, ${a.target}, ${a.subject}, ${a.requestedAt}::date, ${a.requester},
           ${a.todo}, ${a.owner}, ${a.priority}, ${a.note}, ${a.state}, ${a.resolution},
           ${a.resolvedAt}::timestamptz)`
      return
    }
    await tx.$executeRaw`
      UPDATE ip.actions SET
        target = ${a.target}, subject = ${a.subject}, requested_at = ${a.requestedAt}::date,
        requester = ${a.requester}, todo = ${a.todo}, owner_name = ${a.owner},
        priority = ${a.priority}, note = ${a.note}, state = ${a.state},
        resolution = ${a.resolution}, resolved_at = ${a.resolvedAt}::timestamptz
      WHERE id = ${a.id}`
  })
}

export async function setActionState(
  userId: string,
  id: string,
  state: string,
  resolution: string | null
): Promise<void> {
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`
      UPDATE ip.actions SET
        state = ${state}, resolution = ${resolution},
        resolved_at = CASE WHEN ${state} = 'open' THEN NULL ELSE now() END
      WHERE id = ${id}`
  })
}

export async function setFlagState(
  userId: string,
  id: string,
  state: string,
  resolution: string | null
): Promise<void> {
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`
      UPDATE ip.integrity_flags SET
        state = ${state}, resolution = ${resolution},
        resolved_at = CASE WHEN ${state} = 'open' THEN NULL ELSE now() END
      WHERE id = ${id}::uuid`
  })
}

export async function addFlag(
  userId: string,
  entityKind: string,
  entityId: string | null,
  message: string
): Promise<void> {
  await withActor(userId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO ip.integrity_flags (entity_kind, entity_id, message, source)
      VALUES (${entityKind}, ${entityId}, ${message}, 'manual')`
  })
}

/**
 * 지울 수 있는 표. 표 이름이 SQL 에 그대로 들어가므로 화이트리스트로만 받는다.
 * 문자열을 그대로 이어 붙이면 주입이 된다.
 */
export const DELETABLE = ["trademarks", "patents", "communications", "actions"] as const
export type DeletableEntity = (typeof DELETABLE)[number]

export function isDeletable(value: string): value is DeletableEntity {
  return (DELETABLE as readonly string[]).includes(value)
}

/** 삭제. id 타입이 표마다 달라(text/uuid) 캐스팅을 나눈다. */
export async function removeEntity(
  userId: string,
  entity: DeletableEntity,
  id: string
): Promise<void> {
  const cast = entity === "communications" ? "::uuid" : ""
  await withActor(userId, async (tx) => {
    await tx.$executeRawUnsafe(
      `DELETE FROM ip.${entity} WHERE id = $1${cast}`,
      id
    )
  })
}

/**
 * 삭제 직전 상태를 audit_log 에서 찾아 되돌린다.
 *
 * jsonb_populate_record 로 행을 통째로 복원한다. updated_by 와 kind 는 떼고
 * updated_at 은 지금으로 채운다 — 되살리는 것은 값이지 그때의 편집 흔적이 아니다.
 */
export async function undoDelete(
  userId: string,
  entity: DeletableEntity,
  id: string
): Promise<void> {
  await withActor(userId, async (tx) => {
    const rows = await tx.$queryRaw<{ before: unknown }[]>`
      SELECT before FROM ip.audit_log
       WHERE entity = ${entity} AND entity_id = ${id} AND op = 'delete'
       ORDER BY at DESC LIMIT 1`
    if (rows.length === 0 || rows[0].before === null) {
      throw new Error("되돌릴 삭제 기록을 찾지 못했습니다.")
    }
    const before = JSON.stringify(rows[0].before)
    await tx.$executeRawUnsafe(
      `INSERT INTO ip.${entity}
       SELECT * FROM jsonb_populate_record(
         null::ip.${entity},
         (($1::jsonb - 'updated_by' - 'kind') || jsonb_build_object('updated_at', now()))
       )`,
      before
    )
  })
}

/**
 * 값 정정.
 *
 * 대장을 직접 찌르지 않고 **진행 기록 한 줄로** 남긴다. 그러면 무엇이 언제 왜
 * 바뀌었는지가 이력에 남고, 대장은 여전히 기록의 결과로만 바뀐다.
 * source='edit' 이라 apply_progress_entry 가 단계는 반영하되 날짜는 움직이지 않는다.
 *
 * undefined 는 null 로(안 바꿈), 빈 문자열은 그대로(비움) 넘긴다 —
 * 이 둘의 구분이 트리거 규칙의 핵심이다.
 */
export interface Correction {
  name?: string
  holder?: string
  appNo?: string
  regNo?: string
  stage?: string
}

export async function correctRecord(
  userId: string,
  entityKind: EntityKind,
  entityId: string,
  stage: string,
  today: string,
  patch: Correction,
  reason: string
): Promise<void> {
  const changed = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
  if (changed.length === 0) return

  await saveProgress(
    userId,
    {
      date: today,
      // 단계를 안 바꾸면 지금 단계를 그대로 다시 적는다. 무해하다.
      stage: patch.stage ?? stage,
      entityKind,
      entityId,
      direction: null,
      counterpart: "",
      nextTurn: "none",
      dueOn: null,
      appNo: patch.appNo ?? null,
      regNo: patch.regNo ?? null,
      probability: null,
      name: patch.name ?? null,
      holder: patch.holder ?? null,
      note: reason.trim() || `값 정정 (${changed.join(", ")})`,
      source: "edit",
      raw: null,
    },
    true
  )
}

// ─── 개인 설정 ──────────────────────────────────────────────────────

export type StageOrder = Partial<Record<EntityKind, string[]>>

export async function loadPrefs(
  userId: string
): Promise<{ stageOrder: StageOrder; tutorialSeen: boolean }> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT stage_order, tutorial_seen_at FROM ip.member_prefs WHERE user_id = ${userId}`
  if (rows.length === 0) return { stageOrder: {}, tutorialSeen: false }
  return {
    stageOrder: (rows[0].stage_order as StageOrder) ?? {},
    tutorialSeen: Boolean(rows[0].tutorial_seen_at),
  }
}

export async function saveStageOrder(userId: string, order: StageOrder): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO ip.member_prefs (user_id, stage_order, updated_at)
    VALUES (${userId}, ${JSON.stringify(order)}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE
      SET stage_order = excluded.stage_order, updated_at = now()`
}

/**
 * 첫 안내를 봤는지. 기기가 아니라 사람에게 붙는다 —
 * 회사 PC 에서 닫은 안내가 노트북에서 또 뜨면 안내가 아니라 방해다.
 */
export async function markTutorialSeen(userId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO ip.member_prefs (user_id, tutorial_seen_at, updated_at)
    VALUES (${userId}, now(), now())
    ON CONFLICT (user_id) DO UPDATE
      SET tutorial_seen_at = now(), updated_at = now()`
}
