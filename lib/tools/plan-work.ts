// 묶음 1(#248) 실행 — 업무 · 프로젝트 · 채팅 방 · 알림 · 주간보고. 정의는 lib/tools/defs-work.ts.
// 쓰기는 계획(WritePlan)을 세우고, run 은 화면 API 가 부르는 서버 함수를 그대로 부른다. 권한도 그 함수가 본다.
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import { listActivity } from "@/lib/activity-read"
import { readableRooms } from "@/lib/chat-feed"
import { pickByRef } from "@/lib/chat-room-pick"
import { invitePeople, leavePeopleRoom, loadPeopleRoom, openPeopleRoom, renamePeopleRoom } from "@/lib/chat-people"
import { drawerGate, listDrawerFiles, listDrawerLinks, listDrawerMembers } from "@/lib/room-drawer-server"
import { isDrawerPeriod } from "@/lib/room-drawer"
import { deletableNotifications, deleteNotifications, getNotificationPrefs, markNotificationsRead, setNotificationPrefs } from "@/lib/notification-manage"
import { deleteWeeklyReport } from "@/lib/weekly-report"
import { findOrCreateProject } from "@/lib/project-resolve"
import { mergeProjects } from "@/lib/project-merge"
import { blocked, clip, kstDate, str, type Planner, type WritePlan } from "./planned"
import type { WorkReadName, WorkWriteName } from "./defs-work"

const kstTime = (d: Date | string) => new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)
const onOff = (v: boolean) => (v ? "켜짐" : "꺼짐")

/** 정식 이름 → 사용자 ID (lib/omnis-mcp findUsers — 이 파일을 그 모듈이 들이므로 쓸 때 읽는다) */
async function usersByName(names: string[]) {
  const { findUsers } = await import("@/lib/omnis-mcp")
  return findUsers(names)
}

// ─── 읽기 ───

export async function runWorkRead(name: WorkReadName, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "list_task_products": {
      const rows = await prisma.product.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, _count: { select: { tasks: true, projects: true } } } })
      if (rows.length === 0) return { text: "업무용 제품이 없습니다." }
      return { text: [`업무용 제품 ${rows.length}개 — update_task · create_task 의 product 에 이름을 쓴다.`, ...rows.map((p) => `- ${p.name} · 업무 ${p._count.tasks} · 프로젝트 ${p._count.projects} · id=${p.id}`)].join("\n") }
    }
    case "list_activity": {
      const logs = await listActivity({ entity: str(args.entity) || undefined, entityId: str(args.entity_id) || undefined, take: Number(args.limit) || 10 })
      if (logs.length === 0) return { text: "활동 기록이 없습니다." }
      return { text: [`활동 ${logs.length}건(최근 것부터)`, ...logs.map((l) => `- ${kstTime(l.createdAt)} · ${l.user?.name ?? "시스템"} · ${l.action} · ${l.title}${l.entityId ? ` · ${l.entity} ${l.entityId}` : ""}`)].join("\n") }
    }
    case "list_room_files": {
      const ref = str(args.room)
      // 고르기는 내가 읽을 수 있는 방 안에서만 — 남의 방은 ID 를 알아도 「없음」 과 같다
      const hits = pickByRef(await readableRooms(caller.userId), ref)
      if (hits.length === 0) return { error: `「${ref}」 에 맞는 방이 없거나 볼 수 없는 방입니다. list_rooms 로 확인하세요.` }
      if (hits.length > 1) return { error: [`「${ref}」 에 맞는 방이 ${hits.length}개입니다. room 에 방 ID 를 주세요.`, ...hits.slice(0, 10).map((r) => `- ${r.title} · 방 ID ${r.id}`)].join("\n") }
      const room = hits[0]
      const gate = await drawerGate(room.id, caller.userId)
      if (!gate.ok) return { error: gate.error }
      const tab = ["photos", "files", "links", "members"].includes(str(args.tab)) ? str(args.tab) : "files"
      const period = isDrawerPeriod(str(args.period)) ? (str(args.period) as "week" | "month" | "all") : "all"
      const before = str(args.before) && !Number.isNaN(Date.parse(str(args.before))) ? str(args.before) : null
      if (tab === "members") {
        const ms = await listDrawerMembers(room.id, gate.kind)
        return { text: [`「${room.title}」 참여자 ${ms.length}명`, ...ms.map((m) => `- ${m.name}${m.position ? ` · ${m.position}` : ""}${m.external ? " · 카톡에서 옮긴 사람" : ""}`)].join("\n") }
      }
      if (tab === "links") {
        const r = await listDrawerLinks({ roomId: room.id, period, before })
        if (r.links.length === 0) return { text: `「${room.title}」 링크가 없습니다.` }
        return { text: [`「${room.title}」 링크 ${r.links.length}개`, ...r.links.map((l) => `- ${kstTime(l.createdAt)} · ${l.author.name} · ${l.url} · 글 ${l.messageId}`), r.nextBefore ? `다음: before=${r.nextBefore}` : null].filter(Boolean).join("\n") }
      }
      const r = await listDrawerFiles({ roomId: room.id, userId: caller.userId, tab: tab as "photos" | "files", period, kind: "all", before })
      const word = tab === "photos" ? "사진" : "파일"
      if (r.files.length === 0) return { text: `「${room.title}」 ${word}이 없습니다.` }
      return {
        text: [
          `「${room.title}」 ${word} ${r.files.length}개(최근 것부터) — 내용은 read_file 에 파일 ID`,
          ...r.files.map((f) => `- ${kstTime(f.createdAt)} · ${f.author.name} · ${f.name} (${Math.round(f.size / 1024)}KB) · 파일 ${f.fileId}`),
          r.nextBefore ? `다음: before=${r.nextBefore}` : null,
          r.missing?.length ? `카톡에서 옮길 때 실물을 받지 못한 ${word} ${r.missing.length}개는 빠져 있습니다.` : null,
        ].filter(Boolean).join("\n"),
      }
    }
  }
}

/** list_notifications 끝에 붙이는 지금 기기 알림 값 */
export async function notificationPrefsLine(userId: string): Promise<string> {
  const p = await getNotificationPrefs(userId)
  return `기기 알림(푸시): 채팅 ${onOff(p.chat)} · 업무 ${onOff(p.task)} · 일정 ${onOff(p.calendar)} — 바꾸려면 set_notification_prefs`
}

// ─── 쓰기 계획 ───

const planCreateProject: Planner = async (args) => {
  const name = str(args.name)
  if (!name) return blocked("프로젝트 만들기", "(이름 없음)", "name 이 비어 있습니다")
  let productId: string | null = null
  if (str(args.product)) {
    const p = await prisma.product.findUnique({ where: { name: str(args.product) }, select: { id: true } })
    if (!p) return blocked("프로젝트 만들기", name, `'${str(args.product)}' 제품이 없습니다 — list_task_products 로 확인하세요`)
    productId = p.id
  }
  const purpose = str(args.purpose) || null
  const goal = str(args.goal) || null
  return {
    title: "프로젝트 만들기",
    target: name,
    changes: [
      { label: "이름", before: null, after: name },
      ...(str(args.product) ? [{ label: "제품", before: null, after: str(args.product) }] : []),
      ...(purpose ? [{ label: "목적", before: null, after: clip(purpose) }] : []),
      ...(goal ? [{ label: "목표", before: null, after: clip(goal) }] : []),
    ],
    risk: "프로젝트 목록에 새 프로젝트가 생깁니다. 공백 · 대소문자만 다른 이름이 있으면 새로 만들지 않고 그 프로젝트를 씁니다.",
    run: async () => {
      // 화면(app/api/projects POST)과 같은 함수 — 같은 이름이면 있는 것
      const { project, reused } = await prisma.$transaction((tx) => findOrCreateProject(tx, { name, productId, purpose, goal }))
      return { ok: true, id: project.id, text: reused ? `같은 이름의 프로젝트가 있어 그것을 씁니다: ${project.name} · id=${project.id}` : `만들었습니다: ${project.name} · id=${project.id}` }
    },
  }
}

const planMergeProjects: Planner = async (args, caller) => {
  const [sourceId, targetId] = [str(args.source), str(args.target)]
  const [source, target] = await Promise.all([sourceId, targetId].map((id) =>
    id ? prisma.project.findUnique({ where: { id }, select: { id: true, name: true, archived: true, _count: { select: { tasks: true } } } }) : null,
  ))
  const title = "프로젝트 합치기"
  if (!source || !target) return blocked(title, `${sourceId || "?"} → ${targetId || "?"}`, "프로젝트를 찾지 못했습니다 — list_projects 의 ID 를 넣으세요")
  if (source.id === target.id) return blocked(title, source.name, "같은 프로젝트끼리는 합칠 수 없습니다")
  if (source.archived) return blocked(title, source.name, "이미 보관된 프로젝트입니다")
  if (target.archived) return blocked(title, target.name, "보관된 프로젝트로는 합칠 수 없습니다")
  return {
    title,
    target: `${source.name} → ${target.name}`,
    changes: [
      { label: `「${source.name}」 업무`, before: `${source._count.tasks}건`, after: "0건(모두 옮김)" },
      { label: `「${target.name}」 업무`, before: `${target._count.tasks}건`, after: `${target._count.tasks + source._count.tasks}건` },
      { label: `「${source.name}」`, before: "진행", after: "보관" },
    ],
    risk: "업무가 옮겨지고 원본 프로젝트가 보관됩니다. 되돌리는 단추가 없습니다 — 보관을 풀어도 업무는 대상 프로젝트에 남습니다.",
    warning: "되돌릴 수 없습니다. 두 프로젝트가 정말 같은 일인지 확인하세요.",
    run: async () => {
      const r = await mergeProjects(source.id, target.id, caller.userId)
      return r.ok ? { ok: true, id: target.id, text: `합쳤습니다: ${r.sourceName} → ${r.targetName} · 업무 ${r.moved}건 옮김` } : { ok: false, error: r.error }
    },
  }
}

const planManageRoom: Planner = async (args, caller) => {
  const action = str(args.action)
  const names = Array.isArray(args.members) ? args.members.map(String).map((x) => x.trim()).filter(Boolean) : []
  if (action === "open") {
    if (names.length === 0) return blocked("대화방 열기", "(사람 없음)", "members 에 정식 이름을 1명 이상 주세요 — list_members")
    const { ids, missing } = await usersByName(names)
    if (missing.length) return blocked("대화방 열기", names.join(", "), `모르거나 재직 중이 아닌 이름: ${missing.join(", ")} — list_members 로 확인하세요`)
    const others = ids.filter((id) => id !== caller.userId)
    if (others.length === 0) return blocked("대화방 열기", names.join(", "), "나 말고 1명 이상이 필요합니다 — 「나와의 대화」 는 post_message room=\"me\"")
    const group = others.length > 1
    const roomName = str(args.name)
    return {
      title: group ? "단톡방 만들기" : "1:1 대화 열기",
      target: names.join(", "),
      changes: [
        { label: "참여자", before: null, after: [caller.name, ...names.filter((n) => n !== caller.name)].join(", ") },
        ...(group && roomName ? [{ label: "방 이름", before: null, after: roomName }] : []),
      ],
      risk: group ? "새 단톡방이 생깁니다. 참여자 모두의 방 목록에 보입니다." : "그 사람과의 1:1 이 있으면 그 방을, 없으면 새로 엽니다.",
      run: async () => {
        const r = await openPeopleRoom({ id: caller.userId, name: caller.name }, { userIds: ids, name: roomName || undefined })
        return r.ok ? { ok: true, id: r.value.roomId, text: `${r.value.existing ? "있는 방을 열었습니다" : "만들었습니다"} · 방 ID ${r.value.roomId} — 글은 post_message room 에 이 ID` } : { ok: false, error: r.error }
      },
    }
  }
  if (!["rename", "invite", "leave"].includes(action)) return blocked("대화방", "", "action 은 open · rename · invite · leave 중 하나입니다")
  const room = str(args.room) ? await loadPeopleRoom(str(args.room), caller.userId) : null
  const TITLE: Record<string, string> = { rename: "단톡방 이름 바꾸기", invite: "단톡방에 초대", leave: "단톡방 나가기" }
  if (!room) return blocked(TITLE[action], str(args.room) || "(방 없음)", "방을 찾을 수 없거나 내가 참여자가 아닌 방입니다 — list_rooms 의 방 ID 를 넣으세요")
  if (room.kind !== "GROUP") return blocked(TITLE[action], room.title, "1:1 대화는 이름 · 초대 · 나가기가 없습니다")
  if (action === "rename") {
    const name = str(args.name)
    if (!name) return blocked(TITLE.rename, room.title, "name 이 비어 있습니다")
    return {
      title: TITLE.rename, target: room.title,
      changes: [{ label: "방 이름", before: room.name || room.title, after: name }],
      risk: "참여자 모두의 방 목록에서 이름이 바뀝니다.",
      run: async () => {
        const r = await renamePeopleRoom(room.id, caller.userId, name)
        return r.ok ? { ok: true, id: room.id, text: `이름을 바꿨습니다: ${name}` } : { ok: false, error: r.error }
      },
    }
  }
  if (action === "invite") {
    if (names.length === 0) return blocked(TITLE.invite, room.title, "members 에 초대할 정식 이름을 주세요")
    const { ids, missing } = await usersByName(names)
    if (missing.length) return blocked(TITLE.invite, room.title, `모르거나 재직 중이 아닌 이름: ${missing.join(", ")}`)
    const fresh = ids.filter((id) => !room.members.some((m) => m.id === id))
    const freshNames = (await prisma.user.findMany({ where: { id: { in: fresh } }, select: { name: true } })).map((u) => u.name)
    return {
      title: TITLE.invite, target: room.title,
      changes: [{ label: "참여자", before: room.members.map((m) => m.name).join(", "), after: [...room.members.map((m) => m.name), ...freshNames].join(", ") }],
      risk: "초대받은 사람은 이 방의 지난 글까지 모두 볼 수 있습니다. 이 방에서 연 옴니스 세션도 함께 보입니다.",
      ...(fresh.length === 0 ? { problem: "모두 이미 참여자입니다" } : {}),
      run: async () => {
        const r = await invitePeople(room.id, caller.userId, fresh)
        return r.ok ? { ok: true, id: room.id, text: `${r.value.added}명을 초대했습니다.` } : { ok: false, error: r.error }
      },
    }
  }
  return {
    title: TITLE.leave, target: room.title,
    changes: [{ label: "나", before: "참여자", after: "나감" }],
    risk: "이 방과 글이 내 목록 · 검색에서 사라집니다. 다시 들어가려면 남은 참여자가 초대해야 합니다.",
    confirmLabel: "나가기",
    run: async () => {
      const r = await leavePeopleRoom(room.id, caller.userId)
      return r.ok ? { ok: true, id: room.id, text: `「${room.title}」 에서 나왔습니다.` } : { ok: false, error: r.error }
    },
  }
}

const planManageNotifications: Planner = async (args, caller) => {
  const action = str(args.action)
  if (!["read", "delete"].includes(action)) return blocked("알림", "", "action 은 read · delete 중 하나입니다")
  type Target = { id: string } | { all: true }
  const target: Target | null = args.all === true ? { all: true } : str(args.notification) ? { id: str(args.notification) } : null
  const title = action === "read" ? "알림 읽음" : "알림 지우기"
  if (!target) return blocked(title, "", "notification(알림 ID) 또는 all=true 를 주세요 — list_notifications")
  if (action === "read") {
    const rows = await prisma.notification.findMany({ where: { userId: caller.userId, read: false, ...("id" in target ? { id: target.id } : {}) }, select: { title: true } })
    if ("id" in target && rows.length === 0) {
      const exists = await prisma.notification.findFirst({ where: { id: target.id, userId: caller.userId }, select: { id: true } })
      if (!exists) return blocked(title, target.id, "내게 온 알림 중에 없습니다 — list_notifications 로 확인하세요")
    }
    return {
      title, target: "id" in target ? rows[0]?.title ?? "(이미 읽음)" : "내 알림 전부",
      changes: [{ label: "안 읽은 알림", before: `${rows.length}건`, after: "0건" }],
      risk: "벨의 안 읽음 표시가 사라집니다. 알림은 남습니다.",
      run: async () => {
        const r = await markNotificationsRead(caller.userId, target)
        return r.ok ? { ok: true, text: `읽음으로 했습니다(${r.count}건).` } : { ok: false, error: r.error }
      },
    }
  }
  const rows = await deletableNotifications(caller.userId, target)
  if ("id" in target && rows.length === 0) {
    const exists = await prisma.notification.findFirst({ where: { id: target.id, userId: caller.userId }, select: { id: true } })
    return blocked(title, target.id, exists ? "응답이 필요한 알림은 지울 수 없습니다 — respond_notification 으로 응답하세요" : "내게 온 알림 중에 없습니다 — list_notifications 로 확인하세요")
  }
  return {
    title, target: "id" in target ? rows[0].title : `내 알림 ${rows.length}건(응답 대기 알림은 남김)`,
    changes: rows.slice(0, 20).map((n) => ({ label: kstDate(n.createdAt), before: n.title, after: "지움" })),
    risk: "지운 알림은 되돌릴 수 없습니다. 수락 · 완료 확인을 기다리는 알림은 지우지 않습니다.",
    confirmLabel: "지우기",
    ...(rows.length === 0 ? { problem: "지울 알림이 없습니다" } : {}),
    run: async () => {
      const r = await deleteNotifications(caller.userId, target)
      return r.ok ? { ok: true, text: `지웠습니다(${r.count}건).` } : { ok: false, error: r.error }
    },
  }
}

const planNotificationPrefs: Planner = async (args, caller) => {
  const now = await getNotificationPrefs(caller.userId)
  const input: { chat?: boolean; task?: boolean; calendar?: boolean } = {}
  for (const k of ["chat", "task", "calendar"] as const) if (typeof args[k] === "boolean") input[k] = args[k] as boolean
  const LABEL = { chat: "채팅 푸시", task: "업무 푸시", calendar: "일정 푸시" }
  const changes = (Object.keys(input) as (keyof typeof input)[]).map((k) => ({ label: LABEL[k], before: onOff(now[k]), after: onOff(input[k]!) }))
  return {
    title: "기기 알림 바꾸기", target: `${caller.name}의 기기`,
    changes,
    risk: "끈 종류는 이 계정의 모든 기기에서 푸시가 멈춥니다. 벨 알림은 그대로 쌓입니다.",
    ...(changes.length === 0 ? { problem: "chat · task · calendar 중 하나 이상을 true/false 로 주세요" } : {}),
    run: async () => {
      const p = await setNotificationPrefs(caller.userId, input)
      return { ok: true, text: `바꿨습니다 — 채팅 ${onOff(p.chat)} · 업무 ${onOff(p.task)} · 일정 ${onOff(p.calendar)}` }
    },
  }
}

const planDeleteWeeklyReport: Planner = async (args, caller) => {
  const id = str(args.report)
  // 남의 보고서는 없는 것과 같다(화면과 같은 ownerId 조건)
  const r = id ? await prisma.weeklyReport.findFirst({ where: { id, ownerId: caller.userId }, select: { id: true, weekStart: true, status: true, content: true } }) : null
  if (!r) return blocked("주간보고 지우기", id || "(ID 없음)", "내 주간보고 중에 없습니다 — list_weekly_reports 의 ID 를 넣으세요")
  const md = ((r.content ?? {}) as { markdown?: string }).markdown ?? ""
  return {
    title: "주간보고 지우기", target: `${kstDate(r.weekStart)} 주 · ${r.status}`,
    changes: [{ label: "지울 보고서", before: md ? clip(md.replace(/\s+/g, " "), 200) : "(본문 없음)", after: "지움" }],
    risk: "보고서와 그 본문이 지워집니다. 되돌릴 수 없습니다 — 다시 만들면 업무 목록은 다시 세지만 사람이 쓴 본문은 돌아오지 않습니다.",
    confirmLabel: "지우기",
    run: async () => {
      const d = await deleteWeeklyReport(caller.userId, r.id)
      return "error" in d ? { ok: false, error: d.error } : { ok: true, id: r.id, text: "지웠습니다." }
    },
  }
}

export const WORK_PLANNERS: Record<WorkWriteName, Planner> = {
  create_project: planCreateProject,
  merge_projects: planMergeProjects,
  manage_room: planManageRoom,
  manage_notifications: planManageNotifications,
  set_notification_prefs: planNotificationPrefs,
  delete_weekly_report: planDeleteWeeklyReport,
}

export type { WritePlan }
