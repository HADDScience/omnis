"use client"

/**
 * 자료 읽기·쓰기. 이제 Supabase 가 아니라 Omnis API 를 부른다.
 *
 * 함수 모양(이름·인자·반환)은 예전 그대로다. 바뀐 것은 전송 수단뿐이라 화면
 * 코드는 한 줄도 손대지 않았다 — 이사에서 회귀를 줄이는 가장 큰 장치가 이것이다.
 *
 * 행 → 앱 타입 변환도 사라졌다. Omnis 가 처음부터 이 앱의 타입 모양으로 준다
 * (lib/ip-data.ts). 예전에는 snake_case 행을 받을 때마다 여기서 갈아 끼웠다.
 *
 * 왜 옮겼는지는 Omnis 저장소의 mydocs/troubleshootings/supabase-limits.md 에 있다.
 */

import { api } from "@/lib/ip/omnis"
import type {
  ActionItem,
  ActionState,
  Communication,
  FlagState,
  IntegrityFlagRow,
  NextTurn,
  Patent,
  ProgressEntry,
  Stage,
  StatusOption,
  Trademark,
} from "@/lib/ip/types"

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

/** 우리가 이어받은 시점의 값. 사건이 아니라 출발선이다. */
export interface OpeningState {
  stage: string
  refDate: string | null
  name: string
  holder: string | null
  appNo: string | null
  regNo: string | null
  /** 이어받은 날. 사건이 일어난 날이 아니다. */
  takenOverOn: string
  sourceNote: string
}

/**
 * 단계 정렬 순서. 종류별로 사람이 정한 차례. 없는 단계는 파이프라인 순서를 따른다.
 * overview 는 상표·특허를 섞어 보는 첫 화면(현황)의 차례다. 서버는 이 값을 jsonb 로
 * 통째 저장하므로 키를 더해도 서버를 고칠 일이 없다.
 */
export type StageOrder = Partial<
  Record<"trademark" | "patent" | "overview", string[]>
>

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
}

/** 서버가 한 번에 주는 것 전부. 화면이 쓰는 조각들로 갈라 쓴다. */
interface SnapshotResponse extends Snapshot {
  openingState: Record<string, OpeningState>
  prefs: { stageOrder: StageOrder; tutorialSeen: boolean }
  me: { userId: string; email: string; displayName: string | null; role: string }
}

/**
 * 마지막으로 받아 둔 스냅샷.
 *
 * 출발선·개인 설정은 스냅샷에 이미 실려 온다. 화면이 뜨자마자 같은 것을 또 묻지
 * 않으려고 여기에 둔다. 없으면(직접 호출된 경우) 그때 가서 받아 온다.
 */
let lastSnapshot: SnapshotResponse | null = null

/**
 * 한 판에 필요한 것 전부를 한 번에 받는다.
 *
 * 예전에는 표마다 따로 물었다. 서버가 한 번에 주므로 왕복이 여덟 번에서 한 번으로
 * 줄었고, 화면이 여러 조각을 서로 다른 시점의 값으로 그리는 일도 사라졌다.
 */
export async function fetchSnapshot(): Promise<Snapshot> {
  const data = await api<SnapshotResponse>("/snapshot")
  lastSnapshot = data
  return {
    trademarks: data.trademarks,
    patents: data.patents,
    progress: data.progress,
    communications: data.communications,
    actions: data.actions,
    flags: data.flags,
    statusOptions: data.statusOptions,
    stages: data.stages,
    meta: data.meta,
  }
}

// ---------------------------------------------------------------------------
// 저장 (수정 / 추가 / 삭제)
// ---------------------------------------------------------------------------

/**
 * 진행 기록 저장. 지식재산권 목록 반영은 DB 트리거(ip.apply_progress_entry)가 한다.
 * 클라이언트에서 두 번 쓰지 않는 이유는, 여럿이 동시에 넣을 때
 * "더 최신 기록만 단계를 덮어쓴다" 판정이 서버 한 곳에 있어야 하기 때문이다.
 */
export async function saveProgress(e: ProgressEntry, isNew: boolean) {
  await api("/progress", {
    method: "POST",
    body: {
      isNew,
      entry: {
        id: e.id,
        date: e.date,
        entityKind: e.entityKind,
        entityId: e.entityId,
        stage: e.stage,
        direction: e.direction,
        counterpart: e.counterpart,
        nextTurn: e.nextTurn,
        dueOn: e.dueOn,
        appNo: e.appNo,
        regNo: e.regNo,
        probability: e.probability,
        name: e.name,
        holder: e.holder,
        note: e.note,
        source: e.source,
        raw: e.raw,
      },
    },
  })
}

/**
 * 지식재산권 목록에 없는 건을 기록하면서 새로 만든다.
 *
 * 번호 매기기와 출발선 생성은 서버(ip.create_case)가 한다 — 지운 건이 있어도
 * 번호를 되쓰지 않는 규칙이 거기 있다. 그래서 existing 은 더 이상 쓰지 않지만,
 * 부르는 쪽을 고치지 않으려고 인자는 그대로 둔다.
 */
export async function createCase(
  kind: "trademark" | "patent",
  name: string,
  _existing: string[],
  stage: string
): Promise<string> {
  const { id } = await api<{ id: string }>("/cases", {
    method: "POST",
    body: { kind, name, stage },
  })
  return id
}

export async function removeProgress(id: string) {
  await api(`/progress?id=${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** 「내 차례」 목록에서 바로 넘기기 */
export async function setNextTurn(id: string, nextTurn: NextTurn) {
  await api("/progress", { method: "PATCH", body: { id, nextTurn } })
}

/**
 * 차례와 기한만 고친다.
 *
 * 「밀린 IP 업무」 상세에서 쓴다. 단계·번호처럼 사실을 말하는 칸은 건드리지
 * 않는다 — 그쪽은 값 정정(correctRecord)이나 새 기록의 몫이다. 여기서 바꾸는
 * 것은 "이 일이 아직 우리 차례인가"와 "언제까지인가"뿐이다.
 */
export async function setTurnAndDue(
  id: string,
  nextTurn: NextTurn,
  dueOn: string | null
) {
  await api("/progress", { method: "PATCH", body: { id, nextTurn, dueOn } })
}

export async function saveTrademark(t: Trademark, isNew: boolean) {
  await api("/cases", { method: "PUT", body: { kind: "trademark", isNew, trademark: t } })
}

export async function savePatent(p: Patent, isNew: boolean) {
  await api("/cases", { method: "PUT", body: { kind: "patent", isNew, patent: p } })
}

export async function saveCommunication(
  c: Communication,
  isNew: boolean
): Promise<string> {
  const { id } = await api<{ id: string }>("/communications", {
    method: "POST",
    body: { isNew, communication: c },
  })
  return id
}

export async function saveAction(a: ActionItem, isNew: boolean) {
  await api("/actions", { method: "POST", body: { isNew, action: a } })
}

export async function setActionState(
  id: string,
  state: ActionState,
  resolution: string | null
) {
  await api("/actions", { method: "PATCH", body: { id, state, resolution } })
}

export async function setFlagState(
  id: string,
  state: FlagState,
  resolution: string | null
) {
  await api("/flags", { method: "PATCH", body: { id, state, resolution } })
}

export async function addFlag(
  entityKind: IntegrityFlagRow["entityKind"],
  entityId: string | null,
  message: string
) {
  await api("/flags", { method: "POST", body: { entityKind, entityId, message } })
}

export type Entity = "trademarks" | "patents" | "communications" | "actions"

export async function remove(entity: Entity, id: string) {
  await api(`/entity?entity=${entity}&id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

/** 삭제 직전 상태를 감사 기록에서 찾아 되돌린다. */
export async function undoDelete(entity: Entity, id: string) {
  await api("/entity", { method: "POST", body: { entity, id } })
}

/** 다음 ID 제안 (TM-22, PT-11, A-9 …) */
export function nextId(prefix: string, existing: string[]): string {
  const nums = existing
    .map((id) => Number(id.replace(`${prefix}-`, "")))
    .filter((n) => Number.isFinite(n))
  const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1
  const width = prefix === "A" ? 1 : 2
  return `${prefix}-${String(next).padStart(width, "0")}`
}

// ---------------------------------------------------------------------------
// MCP 개인 토큰
// ---------------------------------------------------------------------------

/**
 * 지금 살아 있는 토큰. 최대 하나다.
 * 원문은 발급 순간 말고는 어디에도 없어서 앞자리와 사용 시각만 알 수 있다.
 */
export interface McpToken {
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

export async function currentMcpToken(): Promise<McpToken | null> {
  const { token } = await api<{ token: McpToken | null }>("/mcp-token")
  return token
}

/**
 * 토큰 재발급. 쓰던 것은 즉시 죽고 새 것 하나만 남는다.
 *
 * 원문은 이 반환값으로만 존재한다. 화면을 벗어나면 다시 볼 방법이 없어
 * (서버에는 해시만 있다) 그때는 또 재발급받아야 한다.
 */
export async function reissueMcpToken(): Promise<string> {
  const { token } = await api<{ token: string }>("/mcp-token", { method: "POST" })
  return token
}

// ---------------------------------------------------------------------------
// 개인 설정
// ---------------------------------------------------------------------------

export async function loadStageOrder(_userId: string): Promise<StageOrder> {
  if (lastSnapshot) return lastSnapshot.prefs.stageOrder
  const prefs = await api<{ stageOrder: StageOrder }>("/prefs")
  return prefs.stageOrder
}

export async function saveStageOrder(
  _userId: string,
  order: StageOrder
): Promise<void> {
  await api("/prefs", { method: "POST", body: { stageOrder: order } })
  if (lastSnapshot) lastSnapshot.prefs.stageOrder = order
}

/**
 * 첫 안내를 봤는지.
 *
 * 기기가 아니라 사람에게 붙는다 — 회사 PC 에서 닫은 안내가 노트북에서 또 뜨면
 * 안내가 아니라 방해다.
 */
export async function loadTutorialSeen(_userId: string): Promise<boolean> {
  if (lastSnapshot) return lastSnapshot.prefs.tutorialSeen
  const prefs = await api<{ tutorialSeen: boolean }>("/prefs")
  return prefs.tutorialSeen
}

export async function markTutorialSeen(_userId: string): Promise<void> {
  await api("/prefs", { method: "POST", body: { tutorialSeen: true } })
  if (lastSnapshot) lastSnapshot.prefs.tutorialSeen = true
}

// ---------------------------------------------------------------------------
// 값 정정
// ---------------------------------------------------------------------------

/**
 * IP 화면에서 고칠 수 있는 칸.
 *
 * `undefined` = 안 바꿈 · `""` = 비움 · 값 = 그 값.
 * 서버·DB 쪽도 같은 약속을 쓴다(null=안 바꿈, ''=비움) — 기록의 칸이 null 이면
 * 「안 바꿈」이라 비우기를 표현할 방법이 달리 없기 때문이다.
 */
export interface Correction {
  name?: string
  holder?: string
  appNo?: string
  regNo?: string
  /**
   * 출원일·등록일 'YYYY-MM-DD'. 단계 규칙과 무관하게 이 값이 된다 —
   * 출원번호통지서·등록증의 날짜를 적는다.
   */
  filedOn?: string
  registeredOn?: string
  /** 단계 정정. "원래부터 이 단계였다"는 뜻이라 마지막 진행일을 움직이지 않는다. */
  stage?: string
}

/**
 * 지식재산권 목록 값 정정.
 *
 * 목록을 직접 찌르지 않고 **진행 기록 한 줄로** 남긴다. 그러면 무엇이 언제 왜
 * 바뀌었는지가 이력에 남고, 목록은 여전히 기록의 결과로만 바뀐다
 * (ip.apply_progress_entry 가 최신 기록의 값을 반영한다).
 */
export async function correctRecord(
  entityKind: "trademark" | "patent",
  entityId: string,
  stage: string,
  today: string,
  patch: Correction,
  reason: string
): Promise<void> {
  await api("/corrections", {
    method: "POST",
    body: { entityKind, entityId, stage, today, patch, reason },
  })
}

// ---------------------------------------------------------------------------
// 개시 스냅샷
// ---------------------------------------------------------------------------

/** `kind:id` 로 찾을 수 있게 묶어 돌려준다. */
export async function loadOpeningState(): Promise<Map<string, OpeningState>> {
  const source = lastSnapshot ?? (await api<SnapshotResponse>("/snapshot"))
  return new Map(Object.entries(source.openingState))
}
