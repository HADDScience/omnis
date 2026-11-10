// 푸시 받는 사람 규칙 — 순수 함수만 둔다(prisma 없음). 서버(lib/chat-push.ts · lib/push.ts · lib/calendar-notify.ts)가 부른다.
// 결정과 이유: mydocs/plans/2026-10-29-push-notifications.md 「받는 사람 규칙」. 시험: notify-rules.test.ts

// ─── 종류 · 설정 ─────────────────────────────────────────

/** 설정 화면에서 켜고 끄는 세 종류 */
export const NOTIFY_CATEGORIES = ["chat", "task", "calendar"] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]

/** 사람 한 명의 종류별 설정. 행이 없으면 전부 켜짐(null 로 넘긴다) */
export interface NotifyPrefRow {
  chatPush: boolean
  taskPush: boolean
  calendarPush: boolean
}

export const PREF_FIELD: Record<NotifyCategory, keyof NotifyPrefRow> = {
  chat: "chatPush",
  task: "taskPush",
  calendar: "calendarPush",
}

/**
 * 알림 type → 설정 종류. null 이면 설정과 상관없이 늘 푸시한다(칼럼 검토 · 홈페이지 문의 · 발행 요청 —
 * 사람 몇에게만 가는 운영 알림이라 끌 자리를 따로 두지 않는다).
 */
export function categoryOfType(type: string): NotifyCategory | null {
  if (type === "chat_mention" || type.startsWith("chat_")) return "chat"
  if (type.startsWith("task_")) return "task"
  if (type.startsWith("calendar_")) return "calendar"
  return null
}

/** 이 사람에게 이 종류의 푸시를 보내도 되는가 — 끄면 푸시만 멈추고 벨은 남는다 */
export function pushAllowed(pref: NotifyPrefRow | null | undefined, category: NotifyCategory | null): boolean {
  if (!category || !pref) return true
  return pref[PREF_FIELD[category]]
}

// ─── 쓰고 있는 기기 ──────────────────────────────────────
// mydocs/plans/2026-10-30-push-active-device.md

/** 그 기기를 마지막으로 만진 뒤 이만큼은 그 기기에서 쓰는 중으로 본다 */
export const PRESENCE_WINDOW_MS = 5 * 60_000

/** 기기 신호는 이 간격보다 자주 보내지 않는다 — 판정이 이만큼 늦을 수 있다 */
export const PRESENCE_PING_MS = 60_000

export interface PresenceRow {
  userId: string
  activeAt: Date
  endpoint: string | null
}

/**
 * 보낼 구독만 남긴다. 다른 기기에서 쓰는 중인 사람은 그 기기의 구독만 남고,
 * 그 기기가 구독하지 않았으면(endpoint 가 없거나 목록에 없으면) 하나도 남지 않는다 — 쓰는 화면의 벨에서 본다.
 * 신호가 없거나 오래된 사람은 전부 남는다.
 */
export function presenceTargets<S extends { userId: string; endpoint: string }>(
  subscriptions: S[],
  presences: PresenceRow[],
  now: Date
): S[] {
  const active = new Map<string, string | null>()
  for (const p of presences) {
    if (now.getTime() - p.activeAt.getTime() < PRESENCE_WINDOW_MS) active.set(p.userId, p.endpoint)
  }
  return subscriptions.filter((s) => !active.has(s.userId) || active.get(s.userId) === s.endpoint)
}

// ─── 채팅 ────────────────────────────────────────────────

export type ChatRoomKind = "COMPANY" | "TASK" | "DM" | "GROUP" | "OMNIS_DM"

/** 방 종류별 후보를 모으는 데 필요한 사실 — 서버가 DB 에서 채운다 */
export type ChatAudience =
  | { kind: "COMPANY"; activeUserIds: string[] }
  | {
      kind: "TASK"
      assigneeIds: string[]
      instructorId: string
      /** 그 업무방에 (지우지 않은) 글을 쓴 사람 */
      threadAuthorIds: string[]
      /** 그 업무방(task:<id>)을 즐겨찾기한 사람 */
      favoriteUserIds: string[]
    }
  | { kind: "DM" | "GROUP" | "OMNIS_DM"; memberIds: string[] }

export function chatCandidates(a: ChatAudience): string[] {
  if (a.kind === "COMPANY") return a.activeUserIds
  if (a.kind === "TASK") return [...a.assigneeIds, a.instructorId, ...a.threadAuthorIds, ...a.favoriteUserIds]
  return a.memberIds
}

/**
 * 채팅 글 하나의 푸시 받는 사람. 빼는 순서: 글쓴이 · 시스템 계정 · 방을 끈 사람 · 채팅 알림을 끈 사람 ·
 * 같은 글로 멘션 알림을 받는 사람. 시스템 계정이 쓴 글이면 아무도 받지 않는다(🤖 재구성 줄 · 완료 확인 대기 줄).
 * 비활성 사용자(떠난 사람)는 빼고, 같은 사람은 한 번만.
 */
export function chatRecipients(input: {
  audience: ChatAudience
  authorId: string
  systemUserId: string
  /** 로그인할 수 있는 사람 — 업무 담당자 · 참여자 중 떠난 사람을 거른다 */
  activeUserIds: Iterable<string>
  mutedUserIds?: Iterable<string>
  chatOffUserIds?: Iterable<string>
  /** 같은 글로 chat_mention(벨 + 푸시)을 받는 사람 */
  mentionedUserIds?: Iterable<string>
}): string[] {
  if (input.authorId === input.systemUserId) return []
  const active = new Set(input.activeUserIds)
  const drop = new Set([
    input.authorId,
    input.systemUserId,
    ...(input.mutedUserIds ?? []),
    ...(input.chatOffUserIds ?? []),
    ...(input.mentionedUserIds ?? []),
  ])
  const out: string[] = []
  for (const id of chatCandidates(input.audience)) {
    if (drop.has(id) || !active.has(id) || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/** 푸시 본문 앞부분 길이 */
export const CHAT_PREVIEW_MAX = 60

/** 본문 한 줄 — 줄바꿈 · 연속 공백을 접고 앞 몇십 자. 업무 생성 카드 표식은 사람 말로 */
export function chatPreview(content: string, max = CHAT_PREVIEW_MAX): string {
  if (content.startsWith("__TASK_CREATED__")) return "업무가 생성되었습니다"
  const flat = content.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 방 주소 — 메신저 경로. 알림을 누르면 여기로, service worker 는 이 주소를 보고 있으면 띄우지 않는다 */
export function chatRoomPath(room: { kind: ChatRoomKind; id: string }): string {
  return room.kind === "TASK" ? `/chat/task/${room.id}` : `/chat/${room.id}`
}

/** 방 키 — lib/chat-list.ts roomKeyOf 와 같다(브라우저 모듈을 서버 규칙에 끌어오지 않으려고 따로 둔다) */
export function chatRoomKey(room: { kind: ChatRoomKind; id: string }): string {
  return room.kind === "TASK" ? `task:${room.id}` : `room:${room.id}`
}

export interface ChatPushPayload {
  title: string
  body: string
  url: string
  roomPath: string
  tag: string
  renotify: true
}

/**
 * 채팅 푸시 한 건. 제목은 방(1:1 은 보낸 사람), 본문은 「보낸 사람: 앞 몇십 자」.
 * tag 는 방마다 하나 — 같은 방의 새 글이 앞 알림을 덮고(renotify 로 다시 울린다) 잠금화면에 쌓이지 않는다.
 */
export function chatPushPayload(input: {
  room: { kind: ChatRoomKind; id: string; name: string }
  authorName: string
  content: string
}): ChatPushPayload {
  const { room } = input
  const preview = chatPreview(input.content)
  const path = chatRoomPath(room)
  const title = room.kind === "DM" ? input.authorName : room.kind === "TASK" ? `# ${room.name}` : room.name
  const body = room.kind === "DM" ? preview : `${input.authorName}: ${preview}`
  return { title, body, url: path, roomPath: path, tag: `omnis:chat:${chatRoomKey(room)}`, renotify: true }
}

// ─── 옴니스 답 ───────────────────────────────────────────

export type AgentPushKind = "answer" | "approval" | "limit"

/** 옴니스 1:1 의 답 · 확인 카드 푸시. 제목은 대화 이름, 본문은 답 앞부분 또는 「확인이 필요해요」 */
export function agentPushPayload(input: { roomId: string; roomName: string; kind: AgentPushKind; text?: string }): ChatPushPayload {
  const path = `/chat/${input.roomId}`
  const title = `옴니스 · ${input.roomName || "새 대화"}`
  const body =
    input.kind === "approval"
      ? "확인이 필요해요 — 옴니스가 바꾸려는 내용을 보고 [확인] 을 눌러 주세요"
      : input.text
        ? chatPreview(input.text.replace(/\*\*|__|`|^#{1,6}\s+|\|/gm, ""), 80)
        : input.kind === "limit"
          ? "이번 답은 한도에 닿아 멈췄어요"
          : "답이 왔어요"
  return { title, body, url: path, roomPath: path, tag: `omnis:chat:room:${input.roomId}`, renotify: true }
}

// ─── 업무 지정 ───────────────────────────────────────────

/**
 * 새로 담당자가 된 사람 — 알림을 받을 사람. 다음 담당자에서 중복을 걷고 이미 담당이던 사람 · 지정한 사람 자신 ·
 * 시스템 계정을 뺀다. 생성은 previous 를 비워 부른다. 모든 지정 경로(화면 · /업무 · MCP · 에이전트)가 이 함수를 지난다.
 */
export function assignmentTargets(input: {
  previous: readonly string[]
  next: readonly string[]
  actorId: string
  systemUserId: string
}): string[] {
  const before = new Set(input.previous)
  const out: string[] = []
  for (const id of input.next) {
    if (!id || before.has(id) || id === input.actorId || id === input.systemUserId || out.includes(id)) continue
    out.push(id)
  }
  return out
}

// ─── 일정 ────────────────────────────────────────────────

export interface NewCalendarEvent {
  id: string
  recurrenceId: string
  summary: string
  startAt: Date
  endAt: Date
  isAllDay: boolean
  rrule: string | null
  recurUntil: Date | null
  status: string | null
  organizer: string | null
}

/**
 * 이번 동기화에서 새로 생긴 행 중 알릴 일정. 그 캘린더의 첫 동기화면 하나도 알리지 않는다(기존 일정 대량 유입).
 * 마스터만(예외 회차 · RECURRENCE-ID 는 뺀다), 취소된 것 · 이미 끝난 것은 뺀다. 시작 시각 순.
 */
export function calendarEventsToNotify(input: { firstSync: boolean; created: NewCalendarEvent[]; now: Date }): NewCalendarEvent[] {
  if (input.firstSync) return []
  const now = input.now.getTime()
  return input.created
    .filter((e) => e.recurrenceId === "")
    .filter((e) => (e.status ?? "").toUpperCase() !== "CANCELLED")
    .filter((e) => (e.rrule ? e.recurUntil === null || e.recurUntil.getTime() > now : e.endAt.getTime() > now))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export type CalendarAudience = "ALL" | "ADMIN"

/** 이 캘린더를 볼 수 있는 사람(옴니스 캘린더 화면과 같은 기준) 중 그 일정의 주최자를 뺀 사람 */
export function calendarRecipients(input: {
  audience: CalendarAudience
  users: { id: string; role: string; email: string | null }[]
  organizer: string | null
  systemUserId: string
}): string[] {
  const organizer = input.organizer?.replace(/^mailto:/i, "").trim().toLowerCase() || null
  return input.users
    .filter((u) => u.id !== input.systemUserId)
    .filter((u) => input.audience === "ALL" || u.role === "ADMIN")
    .filter((u) => !organizer || (u.email ?? "").trim().toLowerCase() !== organizer)
    .map((u) => u.id)
}

/** 한 캘린더에서 한 주기에 이만큼 이상 들어오면 한 건씩이 아니라 「새 일정 N건」 하나로 */
export const CALENDAR_BULK_AT = 4

/** 서울 날짜 키 YYYY-MM-DD — 캘린더 화면의 ?day= 와 같은 꼴 */
export function seoulDayKey(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)
}

function whenLabel(e: NewCalendarEvent): string {
  const date = e.startAt.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" })
  if (e.isAllDay) return `${date} 종일`
  const time = e.startAt.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" })
  return `${date} ${time}`
}

export interface CalendarNotice {
  /** 벨 행의 entityId — `YYYY-MM-DD:<일정 id>`. 누르면 캘린더의 그 날짜(lib/schemas/notification.ts notificationHref) */
  entityId: string
  title: string
  content: string
  /** 주최자를 빼야 하는 일정(묶음이면 null) */
  organizer: string | null
}

/** 알릴 일정 → 벨 · 푸시 한 줄씩. 4건 이상이면 하나로 묶는다 */
export function calendarNotices(calendarName: string, events: NewCalendarEvent[]): CalendarNotice[] {
  if (events.length === 0) return []
  if (events.length >= CALENDAR_BULK_AT) {
    const first = events[0]
    const names = events.slice(0, 3).map((e) => e.summary || "(제목 없음)")
    return [
      {
        entityId: `${seoulDayKey(first.startAt)}:${first.id}`,
        title: `새 일정 ${events.length}건 · ${calendarName}`,
        content: `${names.join(", ")}${events.length > 3 ? ` 외 ${events.length - 3}건` : ""}`,
        organizer: null,
      },
    ]
  }
  return events.map((e) => ({
    entityId: `${seoulDayKey(e.startAt)}:${e.id}`,
    title: `새 일정: ${e.summary || "(제목 없음)"}`,
    content: `${calendarName} · ${whenLabel(e)}${e.rrule ? " · 반복" : ""}`,
    organizer: e.organizer,
  }))
}
