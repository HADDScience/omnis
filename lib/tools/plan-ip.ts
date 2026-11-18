// 묶음 5(#248) 실행 — 지식재산권. 정의는 lib/tools/defs-ip.ts.
// 권한은 화면과 같다 — 지식재산권 화면에 들어가는 사람(caller.ip, lib/ip-data getIpAccess)만. 쓰기는 화면 API 와 같은 lib/ip-data · ip-images-server 함수.
import type { Caller } from "@/lib/omnis-mcp"
import { fetchSnapshot, removeProgress, saveAction, saveCommunication, setNextTurn, setTurnAndDue, type NextTurn } from "@/lib/ip-data"
import { listCaseImages, removeCaseImage, updateCaseImage, ImageError } from "@/lib/ip-images-server"
import { blocked, clip, has, str, type Planner, type WritePlan } from "./planned"
import type { IpMoreReadName, IpMoreWriteName } from "./defs-ip"

const NOT_MEMBER = "지식재산권 화면에 들어갈 수 있는 사람만 됩니다 — 담당자에게 권한을 요청하세요."
const TURN: Record<string, string> = { us: "우리", firm: "사무소", none: "없음" }
const ymd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

/** 상표 · 특허 건 이름 — 「TM-01 ADHEAL」 */
async function caseLabels(): Promise<Map<string, { kind: "trademark" | "patent"; label: string }>> {
  const s = await fetchSnapshot()
  const m = new Map<string, { kind: "trademark" | "patent"; label: string }>()
  for (const t of s.trademarks) m.set(t.id, { kind: "trademark", label: `${t.id} ${t.name ?? ""}`.trim() })
  for (const p of s.patents) m.set(p.id, { kind: "patent", label: `${p.id} ${p.title ?? ""}`.trim() })
  return m
}

// ─── 읽기 ───

export async function runIpMoreRead(name: IpMoreReadName, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  if (!caller.ip) return { error: NOT_MEMBER }
  const s = await fetchSnapshot()
  const target = str(args.target)
  const openOnly = args.open_only !== false
  switch (name) {
    case "ip_records": {
      const what = str(args.what)
      if (what === "communications") {
        const rows = s.communications
          .filter((c) => !target || c.links.some((l) => l.id === target) || c.subject.includes(target))
          .filter((c) => !openOnly || c.open)
          .slice(0, 50)
        if (rows.length === 0) return { text: "연락 기록이 없습니다." }
        return { text: [`연락 기록 ${rows.length}건`, ...rows.map((c) => `- id=${c.id} · ${c.date} · ${c.dir} · ${c.from} → ${c.to} · ${clip(c.subject, 80)}${c.followUp ? ` · 후속: ${clip(c.followUp, 80)}` : ""}${c.open ? " · 열림" : ""}${c.links.length ? ` · 건 ${c.links.map((l) => l.id).join(", ")}` : ""}`)].join("\n") }
      }
      if (what === "actions") {
        const rows = s.actions.filter((a) => !target || a.subject.includes(target)).filter((a) => !openOnly || a.state === "open").slice(0, 50)
        if (rows.length === 0) return { text: "미결 액션이 없습니다." }
        return { text: [`액션 ${rows.length}건`, ...rows.map((a) => `- id=${a.id} · ${a.state} · ${a.subject} · ${clip(a.todo, 100)} · 담당 ${a.owner} · ${a.priority}${a.requestedAt ? ` · ${a.requestedAt}` : ""}`)].join("\n") }
      }
      if (what === "flags") {
        const rows = s.flags.filter((f) => !target || f.entityId === target).filter((f) => !openOnly || f.state === "open").slice(0, 50)
        if (rows.length === 0) return { text: "자료 불일치 플래그가 없습니다." }
        return { text: [`플래그 ${rows.length}건`, ...rows.map((f) => `- id=${f.id} · ${f.state} · ${f.entityKind}${f.entityId ? ` ${f.entityId}` : ""} · ${clip(f.message, 140)}`)].join("\n") }
      }
      return { error: "what 은 communications · actions · flags 중 하나입니다." }
    }
  }
}

// ─── 쓰기 계획 ───

const memberGate = (title: string, caller: Caller): WritePlan | null => (caller.ip ? null : blocked(title, "지식재산권", NOT_MEMBER))

const planCommunication: Planner = async (args, caller) => {
  const T = "지식재산권 연락 기록 남기기"
  const gate = memberGate(T, caller)
  if (gate) return gate
  const date = str(args.date)
  if (!ymd(date)) return blocked(T, "", "date 는 YYYY-MM-DD 입니다")
  const subject = str(args.subject)
  const body = str(args.body)
  if (!subject || !body) return blocked(T, "", "subject · body 가 필요합니다")
  const labels = await caseLabels()
  const linkIds = Array.isArray(args.links) ? [...new Set(args.links.map(String).map((x) => x.trim()).filter(Boolean))] : []
  const unknown = linkIds.filter((id) => !labels.has(id))
  if (unknown.length) return blocked(T, subject, `없는 건: ${unknown.join(", ")} — list_ip 로 확인하세요`)
  const c = {
    id: "", date, dir: str(args.dir), from: str(args.from), to: str(args.to), target: str(args.target), subject, body,
    attachments: [] as string[], followUp: str(args.follow_up), open: args.open === true, threadId: null,
    links: linkIds.map((id) => ({ kind: labels.get(id)!.kind, id })),
  }
  return {
    title: T, target: `${date} · ${c.dir} · ${clip(subject, 80)}`,
    changes: [
      { label: "보낸 · 받은", before: null, after: `${c.from || "?"} → ${c.to || "?"}` },
      { label: "본문", before: null, after: clip(body, 600) },
      ...(c.followUp ? [{ label: "후속", before: null, after: c.followUp }] : []),
      ...(linkIds.length ? [{ label: "건", before: null, after: linkIds.map((id) => labels.get(id)!.label).join(", ") }] : []),
    ],
    risk: "지식재산권 화면의 연락 기록에 한 줄이 생깁니다. 변경 이력에 내 이름으로 남습니다.",
    run: async () => {
      const id = await saveCommunication(caller.userId, c, true)
      return { ok: true, id, text: `남겼습니다 · id=${id}` }
    },
  }
}

const planAction: Planner = async (args, caller) => {
  const T = "지식재산권 미결 액션 남기기"
  const gate = memberGate(T, caller)
  if (gate) return gate
  const caseId = str(args.case)
  const todo = str(args.todo)
  const labels = await caseLabels()
  const c = labels.get(caseId)
  if (!c) return blocked(T, caseId || "(건 없음)", "없는 건입니다 — list_ip 의 ID 를 넣으세요")
  if (!todo) return blocked(T, c.label, "todo 가 비어 있습니다")
  const requestedAt = str(args.requested_at)
  if (requestedAt && !ymd(requestedAt)) return blocked(T, c.label, "requested_at 은 YYYY-MM-DD 입니다")
  const priority = str(args.priority) || "보통"
  return {
    title: T, target: c.label,
    changes: [
      { label: "할 일", before: null, after: todo },
      { label: "담당 · 우선", before: null, after: `${caller.name} · ${priority}` },
    ],
    risk: "지식재산권 화면의 미결 액션에 한 줄이 생깁니다.",
    run: async () => {
      // 번호는 화면과 같은 규칙(lib/ip/db nextId — A-1, A-2 …). 그 사이 생긴 번호와 겹치지 않게 실행 때 다시 센다
      const s = await fetchSnapshot()
      const nums = s.actions.map((a) => Number(a.id.replace("A-", ""))).filter((n) => Number.isFinite(n))
      const id = `A-${(nums.length ? Math.max(...nums) : 0) + 1}`
      await saveAction(caller.userId, {
        id, target: c.kind === "patent" ? "특허" : "상표", subject: c.label, requestedAt: requestedAt || null,
        requester: str(args.requester) || null, todo, owner: caller.name, priority, note: "", state: "open", resolution: null, resolvedAt: null,
      }, true)
      return { ok: true, id, text: `남겼습니다 · id=${id}` }
    },
  }
}

const planProgressEdit: Planner = async (args, caller) => {
  const action = str(args.action)
  const T = action === "delete" ? "진행 기록 지우기" : "진행 기록 차례 · 기한"
  const gate = memberGate(T, caller)
  if (gate) return gate
  const s = await fetchSnapshot()
  const e = s.progress.find((p) => p.id === str(args.id))
  if (!e) return blocked(T, str(args.id) || "(ID 없음)", "진행 기록을 찾지 못했습니다 — get_ip 의 진행 기록 ID 를 넣으세요")
  const target = `${e.entityId} · ${e.date} · ${e.event ?? e.stage}`
  if (action === "delete") {
    return {
      title: T, target,
      changes: [{ label: "지울 기록", before: clip(`${e.note || ""} ${e.counterpart || ""}`.trim() || "(메모 없음)", 200), after: "지움" }],
      risk: "진행 기록 한 줄이 지워지고 상태 계산에서 빠집니다. 변경 이력에는 남습니다.",
      confirmLabel: "지우기",
      run: async () => {
        await removeProgress(caller.userId, e.id)
        return { ok: true, id: e.id, text: "지웠습니다." }
      },
    }
  }
  if (action !== "turn") return blocked(T, target, "action 은 turn · delete 중 하나입니다")
  const nextTurn = (str(args.next_turn) || e.nextTurn) as NextTurn
  if (!TURN[nextTurn]) return blocked(T, target, "next_turn 은 us · firm · none 중 하나입니다")
  const dueGiven = has(args, "due_on")
  const due = str(args.due_on)
  if (dueGiven && due && !ymd(due)) return blocked(T, target, "due_on 은 YYYY-MM-DD 이거나 빈 문자열(지우기)입니다")
  const changes = [
    ...(nextTurn !== e.nextTurn ? [{ label: "차례", before: TURN[e.nextTurn], after: TURN[nextTurn] }] : []),
    ...(dueGiven && (due || null) !== e.dueOn ? [{ label: "기한", before: e.dueOn ?? "(없음)", after: due || "(지움)" }] : []),
  ]
  return {
    title: T, target, changes,
    risk: "할 일 목록(우리 차례 · 기한)이 바뀝니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 것이 없습니다" } : {}),
    run: async () => {
      if (dueGiven) await setTurnAndDue(caller.userId, e.id, nextTurn, due || null)
      else await setNextTurn(caller.userId, e.id, nextTurn)
      return { ok: true, id: e.id, text: "바꿨습니다." }
    },
  }
}

const planImageEdit: Planner = async (args, caller) => {
  const action = str(args.action)
  const T = action === "remove" ? "건에서 이미지 떼기" : "이미지 고치기"
  const gate = memberGate(T, caller)
  if (gate) return gate
  const img = (await listCaseImages()).find((i) => i.id === str(args.id))
  if (!img) return blocked(T, str(args.id) || "(ID 없음)", "이미지를 찾지 못했습니다 — get_ip 의 이미지 ID 를 넣으세요")
  const target = `${img.entityId} · ${img.name}`
  const wrap = async (f: () => Promise<unknown>, text: string) => {
    try {
      await f()
      return { ok: true as const, id: img.id, text }
    } catch (err) {
      if (err instanceof ImageError) return { ok: false as const, error: err.message }
      throw err
    }
  }
  if (action === "remove") {
    return {
      title: T, target,
      changes: [{ label: "이미지", before: `${img.memo || "(메모 없음)"}${img.isPrimary ? " · 대표" : ""}`, after: "뗌(파일은 남음)" }],
      risk: "건에서 이미지가 빠집니다. 대표였으면 남은 것 중 최근 것이 대표가 됩니다. 파일은 지우지 않습니다.",
      confirmLabel: "떼기",
      run: () => wrap(() => removeCaseImage(caller.userId, img.id), "뗐습니다."),
    }
  }
  if (action !== "update") return blocked(T, target, "action 은 update · remove 중 하나입니다")
  const patch: { memo?: string; date?: string | null; isPrimary?: boolean } = {}
  const changes = []
  if (has(args, "memo") && str(args.memo) !== img.memo) { patch.memo = str(args.memo); changes.push({ label: "메모", before: img.memo || "(없음)", after: str(args.memo) || "(비움)" }) }
  if (has(args, "date")) {
    const d = str(args.date)
    if (d && !ymd(d)) return blocked(T, target, "date 는 YYYY-MM-DD 이거나 빈 문자열입니다")
    if ((d || null) !== img.date) { patch.date = d || null; changes.push({ label: "날짜", before: img.date ?? "(없음)", after: d || "(지움)" }) }
  }
  if (args.is_primary === true && !img.isPrimary) { patch.isPrimary = true; changes.push({ label: "대표", before: "아님", after: "대표" }) }
  return {
    title: T, target, changes,
    risk: "건의 이미지 정보가 바뀝니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 것이 없습니다" } : {}),
    run: () => wrap(() => updateCaseImage(caller.userId, img.id, patch), "고쳤습니다."),
  }
}

export const IP_MORE_PLANNERS: Record<IpMoreWriteName, Planner> = {
  ip_save_communication: planCommunication,
  ip_save_action: planAction,
  ip_progress_edit: planProgressEdit,
  ip_image_edit: planImageEdit,
}
