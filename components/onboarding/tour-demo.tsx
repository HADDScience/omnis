"use client"

import { useLayoutEffect, useRef, useState } from "react"
import {
  Composer,
  LiveOmnis,
  MyMessage,
  OmnisMessage,
} from "@/components/messenger/omnis-room"
import { AgentCard } from "@/components/messenger/agent-card"
import type { AgentCard as AgentCardData } from "@/lib/agent/service"
import type { LiveTool } from "@/lib/agent/client-stream"
import type { ToolUse } from "@/lib/agent/tool-trail"

/**
 * 온보딩의 옴니스 시연 — 옴니스 방(/chat/new) 대화 칸 자리에 실제 컴포넌트(말풍선 · 도구 줄 · 확인 카드 · 입력칸)로
 * 대본을 재생한다(mydocs/plans/2026-10-29-onboarding-tab-tour.md).
 *
 * 대본은 시간(ms)의 순수 함수다. 안내의 시계(useTourClock) 하나가 장면 진행과 대본을 함께 움직여 일시정지 · 숨은 탭 ·
 * 이전/다음이 그대로 듣는다. **fetch 도 API 도 부르지 않고 DB 에 아무것도 쓰지 않는다** — 상태는 전부 이 파일 안의 값이다.
 * 층 전체가 inert 라 확인 카드의 버튼 · 입력칸을 눌러도(키보드로도) 아무 일이 없다.
 */
export type DemoScript = "create-task"

/** 대본 하나의 길이 — 끝 장면을 읽을 시간까지 */
export const DEMO_LENGTH: Record<DemoScript, number> = {
  "create-task": 15000,
}

interface Frame {
  /** 입력칸에 쳐지는 중인 글 */
  draft: string
  /** 보낸 내 글 */
  sent: string | null
  /** 흘러 드는 중인 답 */
  live: { text: string; tools: LiveTool[] } | null
  /** 확인 카드 앞에 남은 옴니스 글 */
  answer: { text: string; tools: ToolUse[] } | null
  card: AgentCardData | null
  /** [확인] 을 누른 표시 */
  deciding: boolean
  /** 카드를 실행한 뒤의 옴니스 글 */
  after: string | null
}

const EMPTY: Frame = {
  draft: "",
  sent: null,
  live: null,
  answer: null,
  card: null,
  deciding: false,
  after: null,
}

/** start~end 사이에 글이 한 글자씩 — 타이핑과 스트리밍 둘 다 */
function typed(text: string, t: number, start: number, end: number) {
  if (t <= start) return ""
  if (t >= end) return text
  return text.slice(0, Math.round(((t - start) / (end - start)) * text.length))
}

/** 다음 주 금요일 — 대본의 「다음 주 금요일까지」 */
function nextWeekFriday(now: Date) {
  const day = new Date(now)
  day.setDate(day.getDate() + ((5 - day.getDay() + 7) % 7) + 7)
  return day.toLocaleDateString("sv-SE")
}

function card(
  base: Pick<AgentCardData, "id" | "toolName" | "preview">,
  status: AgentCardData["status"],
  result: string | null,
  at: string
): AgentCardData {
  return {
    ...base,
    runId: "tour-demo",
    status,
    planHash: "",
    blockedReason: null,
    result,
    createdAt: at,
    decidedAt: null,
  }
}

// ── 대본 1: 업무 만들기 ────────────────────────────────────────────────

const TASK_ASK = "다음 주 금요일까지 가벽 블라인드 설치 견적 받아줘. 담당은 사원2"
const TASK_NAME = "가벽 블라인드 설치 견적"

function createTask(t: number, at: string, deadline: string): Frame {
  const members: LiveTool = {
    id: "members",
    name: "list_members",
    state: t < 5200 ? "running" : "done",
    input: "",
    result: t < 5200 ? undefined : "구성원 7명",
  }
  const propose: LiveTool = {
    id: "propose",
    name: "create_task",
    state: "approval",
    input: `name: ${TASK_NAME} · assignees: 사원2 · deadline: ${deadline}`,
    result: "확인 카드",
  }
  const proposal = {
    id: "tour-create-task",
    toolName: "create_task",
    preview: {
      title: "새 업무 만들기",
      target: TASK_NAME,
      changes: [
        { label: "업무 이름", before: null, after: TASK_NAME },
        { label: "담당", before: null, after: "사원2" },
        { label: "마감", before: null, after: deadline },
        {
          label: "체크리스트",
          before: null,
          after: "· 업체 3곳에 견적 요청\n· 견적 비교\n· 설치 일정 잡기",
        },
      ],
      // 실제 카드와 같은 문구(lib/agent/tools.ts buildPreview create_task)
      risk: "업무가 생기고 담당자에게 수락 알림이 갑니다. 전사방에 지시 원문과 업무 카드가 내 이름으로 올라갑니다.",
    },
  }
  if (t < 3700) return { ...EMPTY, draft: typed(TASK_ASK, t, 500, 3300) }
  const sent = { ...EMPTY, sent: TASK_ASK }
  if (t < 6400) {
    const tools = t < 4300 ? [] : t < 5500 ? [members] : [members, propose]
    return { ...sent, live: { text: "", tools } }
  }
  const answer = {
    text: `**${TASK_NAME}** 업무를 사원2 님 담당으로 만들까요? 아래 카드를 확인해 주세요.`,
    tools: [members, propose].map((tool) => ({
      id: tool.id,
      name: tool.name,
      state: tool.state as ToolUse["state"],
      input: tool.input ?? "",
      result: tool.result ?? "",
    })),
  }
  if (t < 9700)
    return {
      ...sent,
      answer,
      card: card(proposal, "PENDING", null, at),
      deciding: t >= 9000,
    }
  const done = `**${TASK_NAME}** 업무를 만들었어요. 사원2 님에게 수락 알림이 갔어요.`
  if (t < 11400)
    return {
      ...sent,
      answer,
      card: card(proposal, "APPROVED", null, at),
      live: { text: typed(done, t, 9900, 11200), tools: [] },
    }
  return {
    ...sent,
    answer,
    card: card(proposal, "EXECUTED", `업무를 만들었습니다 — ${TASK_NAME}`, at),
    after: done,
  }
}

/** 대본이 다 끝난 시각 — 모션 감소 설정이면 여기를 바로 보인다 */
export const DEMO_END: Record<DemoScript, number> = {
  "create-task": 11400,
}

function frameAt(script: DemoScript, t: number, at: string, deadline: string) {
  switch (script) {
    case "create-task":
      return createTask(t, at, deadline)
  }
}

export function TourDemo({
  script,
  elapsed,
  rect,
}: {
  script: DemoScript
  elapsed: number
  rect: { x: number; y: number; width: number; height: number }
}) {
  const [at] = useState(() => new Date().toISOString())
  const [deadline] = useState(() => nextWeekFriday(new Date()))
  const frame = frameAt(script, elapsed, at, deadline)
  const list = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const busy = frame.live !== null || frame.deciding
  // 새 글 · 흘러 드는 답을 따라 맨 아래로(실제 방과 같은 움직임)
  const shape = JSON.stringify(frame).length
  useLayoutEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shape, rect.height])
  return (
    <div
      className="tour-demo"
      data-tour-demo={script}
      inert
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-3 py-4 sm:px-6">
          <div className="flex flex-col">
            {frame.sent && <MyMessage content={frame.sent} iso={at} fresh />}
            {frame.answer && (
              <OmnisMessage
                message={{
                  id: "tour-answer",
                  content: frame.answer.text,
                  createdAt: at,
                  fromOmnis: true,
                  sources: [],
                }}
                fresh
                tools={frame.answer.tools}
              />
            )}
            {frame.card && (
              <AgentCard
                card={frame.card}
                deciding={frame.deciding ? "approve" : null}
                disabled={false}
                // 시연 — 눌린 표시만 대본이 그린다. 누가 눌러도 아무 일이 없다
                onDecide={() => {}}
              />
            )}
            {frame.after && (
              <OmnisMessage
                message={{
                  id: "tour-after",
                  content: frame.after,
                  createdAt: at,
                  fromOmnis: true,
                  sources: [],
                }}
                fresh
                tools={[]}
              />
            )}
            {frame.live && (
              <LiveOmnis text={frame.live.text} tools={frame.live.tools} />
            )}
          </div>
        </div>
      </div>
      <Composer
        textareaRef={textarea}
        value={frame.draft}
        onChange={() => {}}
        onSend={() => {}}
        busy={busy}
        autoFocus={false}
        waitingCard={frame.card?.status === "PENDING"}
      />
    </div>
  )
}
