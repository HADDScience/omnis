"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PencilEdit02Icon,
  BubbleChatSparkIcon,
  UserGroupIcon,
  PlayIcon,
  PauseIcon,
  Refresh01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import { OmnisMark } from "@/components/brand/omnis-mark"
import { ShineBorder } from "@/components/magicui/shine-border"
import { AgentCard } from "@/components/messenger/agent-card"
import {
  Composer,
  LiveOmnis,
  MyMessage,
  OmnisMessage,
  OmnisWelcome,
} from "@/components/messenger/omnis-room"
import { RoomHeader } from "@/components/messenger/room-header"
import { RoomRowPreview } from "@/components/messenger/room-list"
import type { AgentCard as Card } from "@/lib/agent/service"
import type { LiveTool } from "@/lib/agent/client-stream"
import type { ToolUse } from "@/lib/agent/tool-trail"
import type { RoomListItem } from "@/lib/chat-rooms"

const chapters = [
  {
    at: 0,
    title: "새 대화 열기",
    thought: "A 사원에게 고객사 제안서 작성을 맡겨야겠어.",
  },
  { at: 6500, title: "업무 지시", thought: "대화로 업무를 맡깁니다." },
  {
    at: 15500,
    title: "추가 정보 전달",
    thought: "모호한 부분은 되묻고, 필요한 맥락을 채웁니다.",
  },
  {
    at: 26000,
    title: "확인하고 업무 생성",
    thought: "담당자와 내용을 확인한 뒤 업무를 만듭니다.",
  },
  {
    at: 36000,
    title: "A 사원의 화면",
    thought: "음… 나 오늘 무슨 일 해야 되지?",
  },
  {
    at: 47000,
    title: "우선순위에서 실행으로",
    thought: "그럼 가장 먼저 해야 하는 업무부터 같이 시작하자.",
  },
  {
    at: 59000,
    title: "도구를 연결해 초안까지",
    thought: "회사 맥락과 도구를 연결해 결과물을 만듭니다.",
  },
]
const END = 74000
/** 시연 글의 시각 — 화면에는 「오후 2:02」 처럼 시각만 보인다 */
const SAID_AT = "2026-10-30T05:02:00Z"
/** 목록 줄의 시각 — 오늘이 아닌 날로 두어 서버(UTC)와 브라우저가 같은 「10월 28일」 을 그린다 */
const LIST_AT = "2026-10-28T03:00:00Z"
const COMPANY_ROOM: RoomListItem = {
  id: "film-company",
  key: "room:film-company",
  kind: "COMPANY",
  name: "전사",
  lastAt: LIST_AT,
  preview: "함께 일하는 공간",
  unread: 0,
  favorite: false,
  muted: false,
}
function omnisRoom(employee: boolean): RoomListItem {
  return {
    id: "film-omnis",
    key: "room:film-omnis",
    kind: "OMNIS_DM",
    name: employee ? "오늘 할 일" : "새빛바이오 제안서 업무 지시",
    lastAt: LIST_AT,
    preview: employee
      ? "오늘 할 일과 제안서 초안"
      : "새빛바이오 제안서 업무 지시",
    unread: 0,
    favorite: false,
    muted: false,
  }
}
/**
 * 초안을 쓰며 쓰는 도구 — 옴니스에 실제로 있는 도구만(lib/agent/client-stream.ts TOOL_LABEL). 이름표도 실제 화면과 같게 나온다
 */
function liveTools(elapsed: number): LiveTool[] {
  return [
    {
      id: "task",
      name: "get_task",
      state: "done",
      result: "새빛바이오 제안서 · 담당 A 사원 · 금요일 마감",
    },
    {
      id: "search",
      name: "search_knowledge",
      state: elapsed < 62000 ? "running" : "done",
      result:
        elapsed >= 62000
          ? "새빛바이오 상담 이력 · 분석 서비스 소개"
          : undefined,
    },
    { id: "context", name: "get_context", state: "running" },
  ]
}
const DONE_TOOLS: ToolUse[] = [
  {
    id: "task",
    name: "get_task",
    input: "task: 새빛바이오 제안서",
    result: "새빛바이오 제안서 · 담당 A 사원 · 금요일 마감",
    state: "done",
  },
  {
    id: "search",
    name: "search_knowledge",
    input: "새빛바이오 상담",
    result: "새빛바이오 상담 이력 · 분석 서비스 소개",
    state: "done",
  },
  {
    id: "context",
    name: "get_context",
    input: "새빛바이오",
    result: "견적 · 일정 기록 3건",
    state: "done",
  },
]
/** 설정 화면 MCP 등록 단추의 무지개와 같은 색 */
const RAINBOW = [
  "#ff3d81",
  "#ff8a00",
  "#ffd60a",
  "#34d399",
  "#38bdf8",
  "#a855f7",
]
const messages = [
  {
    at: 10500,
    side: "user",
    text: "A 사원에게 고객사 제안서 작성 업무 지시해줘.",
  },
  {
    at: 12500,
    side: "ai",
    text: "어느 고객사를 위한 제안서인가요? 제출 기한과 제안 범위도 알려주세요.",
  },
  {
    at: 20500,
    side: "user",
    text: "새빛바이오에 보낼 분석 서비스 제안서야. 금요일까지, 기존 상담 내용과 서비스 소개를 반영해줘.",
  },
  {
    at: 23000,
    side: "ai",
    text: "상담 이력과 서비스 자료를 확인했습니다. 아래 내용으로 A 사원에게 업무를 만들겠습니다. 확인해 주세요.",
  },
  {
    at: 32500,
    side: "ai",
    text: "업무를 생성했습니다. A 사원에게 배정했고, 관련 자료와 금요일 마감을 연결했습니다.",
    kind: "created",
  },
  {
    at: 40500,
    side: "user",
    text: "오늘 내가 해야 할 일 알려줘. 무엇부터 하면 좋을까?",
    employee: true,
  },
  {
    at: 43000,
    side: "ai",
    text: "새빛바이오 제안서 초안을 먼저 준비하세요. 금요일 제출 전에 팀 검토가 필요합니다. 초안이 있어야 견적 검토도 시작할 수 있어요.",
    kind: "priorities",
    employee: true,
  },
  {
    at: 52000,
    side: "user",
    text: "그럼 새빛바이오 제안서 초안 작성부터 같이 시작하자.",
    employee: true,
  },
  {
    at: 54500,
    side: "ai",
    text: "상담 요청과 서비스 정보를 확인하고, 공개 자료를 검색한 뒤 문서 도구로 초안을 작성하겠습니다.",
    employee: true,
  },
  {
    at: 60000,
    side: "ai",
    text: "회사 정보와 연결된 도구를 활용하고 있어요.",
    kind: "tools",
    employee: true,
  },
  {
    at: 66000,
    side: "ai",
    text: "제안서 초안이 준비됐습니다. 상담 범위와 서비스 구성을 반영했습니다. 견적과 최종 일정은 검토해 주세요.",
    kind: "draft",
    employee: true,
  },
]
const typing = [
  { start: 6500, end: 10500, text: messages[0].text },
  { start: 15500, end: 20500, text: messages[2].text },
  { start: 37500, end: 40500, text: messages[5].text },
  { start: 47500, end: 52000, text: messages[7].text },
]

export function WorkflowFilm() {
  const track = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(0)
  const root = useRef<HTMLElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const confirm = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const [controlsVisible, setControlsVisible] = useState(false)
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showControls = () => {
    setControlsVisible(true)
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 2000)
  }
  useEffect(
    () => () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current)
    },
    []
  )
  const windowRef = useRef<HTMLDivElement>(null)
  const fab = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const composerBox = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    let lastWheel = 0,
      consumed = false,
      busyUntil = 0
    const wheel = (event: WheelEvent) => {
      const el = track.current
      if (
        !el ||
        event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return
      const rect = el.getBoundingClientRect()
      if (rect.top > 77 || rect.bottom <= window.innerHeight) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastWheel > 220) consumed = false
      lastWheel = now
      if (consumed || now < busyUntil || Math.abs(event.deltaY) < 2) return
      consumed = true
      busyUntil = now + 850
      window.scrollBy({
        top: Math.sign(event.deltaY) * Math.min(150, window.innerHeight * 0.16),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      })
    }
    window.addEventListener("wheel", wheel, { passive: false, capture: true })
    return () => window.removeEventListener("wheel", wheel, true)
  }, [])
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = track.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        setExpanded(
          Math.max(
            0,
            Math.min(1, (76 - rect.top) / (window.innerHeight * 0.65))
          )
        )
      })
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])
  useEffect(() => {
    // 시연 화면이 절반 넘게 밀려 나가면 멈춘다 — 다음 섹션을 읽는 동안 뒤에서 대본이 지나가지 않게
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio >= 0.6),
      { threshold: [0, 0.6, 1] }
    )
    if (root.current) observer.observe(root.current)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      setPlaying(false)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    // 다 펼쳐질 때까지 기다리면 스크롤하는 동안 빈 화면만 보인다 — 화면이 대부분 찼을 때 시작
    if (!visible || !playing || cancelled || expanded < 0.6) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now(),
        delta = now - previous
      if (!document.hidden) setElapsed((value) => Math.min(END, value + delta))
      previous = now
    }, 60)
    return () => clearInterval(timer)
  }, [visible, playing, cancelled, expanded])
  const employee = elapsed >= 36000
  const index = chapters.findLastIndex((item) => elapsed >= item.at)
  const chapter = chapters[Math.max(index, 0)]
  const activeTyping = typing.find(
    (item) => elapsed >= item.start && elapsed < item.end
  )
  const draft = activeTyping
    ? activeTyping.text.slice(
        0,
        Math.floor(
          ((elapsed - activeTyping.start) /
            (activeTyping.end - activeTyping.start)) *
            activeTyping.text.length
        )
      )
    : ""
  const shown = messages.filter(
    (item) => elapsed >= item.at && !!item.employee === employee
  )
  const cardVisible = !employee && elapsed >= 26000
  // 보낸 글에 아직 옴니스가 답하지 않았다 — 입력칸이 「옴니스가 답하는 중…」 이 된다
  const busy = shown.at(-1)?.side === "user"
  const cardStatus = cancelled
    ? "REJECTED"
    : elapsed >= 32000
      ? "EXECUTED"
      : elapsed >= 30500
        ? "APPROVED"
        : "PENDING"
  const card: Card = {
    id: "landing-demo",
    runId: "landing-demo",
    toolName: "task_create",
    status: cardStatus,
    preview: {
      title: "업무 생성",
      target: "새빛바이오 분석 서비스 제안서 작성",
      changes: [
        { label: "담당자", before: null, after: "A 사원" },
        { label: "마감", before: null, after: "금요일" },
        {
          label: "업무 내용",
          before: null,
          after: "상담 이력 확인 → 서비스·일정 구성 → 제안서 초안 작성",
        },
      ],
      risk: "A 사원에게 업무가 배정됩니다.",
    },
    planHash: "demo",
    blockedReason: null,
    result:
      cardStatus === "EXECUTED"
        ? "업무 생성 완료 · A 사원에게 배정했습니다."
        : null,
    createdAt: "2026-10-30T00:00:00Z",
    decidedAt: null,
  }
  const scrollKey = `${employee}-${shown.length}-${cardStatus}-${cardVisible}`
  useEffect(() => {
    const el = conversation.current
    if (el)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      })
  }, [scrollKey])
  const clickingSend = typing.some(
    (item) => elapsed >= item.end - 500 && elapsed < item.end + 450
  )
  const clickingConfirm = elapsed >= 29600 && elapsed < 31200
  // 카메라 — 지시를 치는 동안은 입력칸을 크게 잡고, 보내면 방 전체로 물러난다(2026-10-30 작업지시자, Antigravity 영상의 느낌)
  const closeUp = typing.some(
    (item) => elapsed >= item.start - 400 && elapsed < item.end + 300
  )
  // 확인 카드가 뜬 뒤부터는 창에 빛과 무지개 테두리를 두른다
  const glowing = elapsed >= 26000 && !cancelled
  const body = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState({ origin: "50% 100%", dy: 0 })
  // 카메라의 중심을 입력칸 앞쪽에 두고, 확대한 입력칸이 보이는 창의 가운데쯤 오도록 끌어올린다.
  // 폰에서는 방 목록이 없어 자리가 달라 실제 위치를 잰다(확대 중에도 맞도록 변형의 영향이 없는 offset 으로)
  useEffect(() => {
    const measure = () => {
      const composer = composerBox.current
      const el = body.current
      if (!composer || !el) return
      let x = composer.offsetLeft,
        y = composer.offsetTop + composer.offsetHeight / 2
      for (
        let n = composer.offsetParent as HTMLElement | null;
        n && n !== el && el.contains(n);
        n = n.offsetParent as HTMLElement | null
      ) {
        x += n.offsetLeft
        y += n.offsetTop
      }
      const win = windowRef.current?.getBoundingClientRect()
      let dy = 0
      if (win) {
        const top = Math.max(win.top, 76),
          bottom = Math.min(win.bottom, window.innerHeight)
        dy = (top + bottom) / 2 - (win.top + el.offsetTop + y)
      }
      setCamera({
        origin: `${Math.round(x)}px ${Math.round(y)}px`,
        dy: Math.round(Math.min(0, dy)),
      })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [expanded])
  const opening = elapsed < 5000
  const cursorTarget = opening
    ? elapsed < 2300
      ? "fab"
      : "menu"
    : clickingConfirm
      ? "confirm"
      : "send"
  useEffect(() => {
    const target =
      cursorTarget === "fab"
        ? fab.current
        : cursorTarget === "menu"
          ? menu.current
          : cursorTarget === "confirm"
            ? confirm.current?.querySelector("button:last-child")
            : composerBox.current?.querySelector("button")
    const box = windowRef.current?.getBoundingClientRect(),
      rect = target?.getBoundingClientRect()
    if (box && rect)
      setCursor({
        x: ((rect.left + rect.width * 0.6 - box.left) / box.width) * 100,
        y: ((rect.top + rect.height * 0.6 - box.top) / box.height) * 100,
      })
  }, [cursorTarget, elapsed, cardVisible])
  const seek = (at: number) => {
    setCancelled(false)
    setElapsed(at)
  }
  const newChat = () => {
    seek(employee ? 36000 : 0)
    setPlaying(true)
  }
  return (
    <div
      className="film-scroll-track"
      ref={track}
      style={{ "--film-expand": expanded } as CSSProperties}
    >
      <section
        className="workflow-film"
        id="film"
        ref={root}
        aria-label="업무 흐름 가상 시연"
      >
        <div className="film-heading">
          <h2>지시에서 결과까지.</h2>
          <p>실제 업무 확인 카드와 도구 기록 UI를 사용한 가상 데이터 시연</p>
        </div>
        <div className="film-thought">
          <span>{employee ? "A 사원" : "업무 지시자"}</span>
          <p>“{chapter.thought}”</p>
        </div>
        <div
          className={`product-window continuous-film ${controlsVisible ? "controls-visible" : ""} ${closeUp ? "film-close-up" : ""} ${glowing ? "film-glowing" : ""}`}
          ref={windowRef}
          // 메신저 안과 같은 크기 — 실제 컴포넌트가 이 표시 아래에서 키운 크기(in-data-[messenger])를 쓴다
          data-messenger
          onPointerMove={showControls}
          onPointerDown={showControls}
          onPointerLeave={() => setControlsVisible(false)}
        >
          <div className="window-bar">
            <div aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span>Omnis — {employee ? "A 사원" : "업무 지시자"}</span>
            <small>시연</small>
          </div>
          <div className="film-app-title">
            채팅 <span>HADD Science</span>
          </div>
          <div
            className="product-body"
            ref={body}
            style={
              {
                transformOrigin: camera.origin,
                "--cam-dy": `${camera.dy}px`,
              } as CSSProperties
            }
          >
            <aside className="film-room-list">
              {/* 실제 채팅 목록과 같은 줄(RoomRowPreview) — 메뉴 · 밀기 · 링크만 없다 */}
              <div inert>
                <RoomRowPreview room={omnisRoom(employee)} active />
                <RoomRowPreview room={COMPANY_ROOM} />
              </div>
              <Button
                ref={fab}
                className="film-fab"
                aria-label="시연 새 대화"
                onClick={newChat}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} size={22} aria-hidden />
              </Button>
              {elapsed >= 2300 && elapsed < 5000 && (
                <div className="film-new-menu">
                  <Button ref={menu} onClick={() => seek(5000)}>
                    <HugeiconsIcon
                      icon={BubbleChatSparkIcon}
                      size={16}
                      aria-hidden
                    />{" "}
                    옴니스와 대화<small>회사 일을 묻고 업무를 맡겨요</small>
                  </Button>
                  <span>
                    <HugeiconsIcon icon={UserGroupIcon} size={16} aria-hidden />{" "}
                    사람과 대화
                  </span>
                </div>
              )}
            </aside>
            <div className="product-chat">
              <div className="film-aura" aria-hidden="true" />
              {/* 대화 칸은 실제 옴니스 방의 컴포넌트 그대로 — 머리(RoomHeader) · 첫 화면(OmnisWelcome) · 말풍선(MyMessage) ·
                  옴니스 글(OmnisMessage · LiveOmnis) · 확인 카드(AgentCard) · 입력칸(Composer). 시연 층이라 누를 수 없다(inert) */}
              {/* RoomHeader 는 방 이름을 h1 으로 그린다 — 랜딩의 h1(히어로)과 겹치지 않게 읽기 트리에서 뺀다 */}
              <div inert aria-hidden="true">
                <RoomHeader
                  title={
                    shown.length
                      ? employee
                        ? "오늘 할 일"
                        : "새빛바이오 제안서 업무 지시"
                      : "새 대화"
                  }
                  subtitle={
                    shown.length
                      ? "옴니스와 1:1 · 앞의 대화를 이어서 답합니다"
                      : "옴니스와 1:1 · 첫 글을 보내면 대화방이 생깁니다"
                  }
                />
              </div>
              <div className="demo-conversation" ref={conversation}>
                <div className="mx-auto flex w-full max-w-[760px] flex-col px-3 py-4 in-data-[messenger]:px-4 in-data-[messenger]:py-5 sm:px-6">
                  {!shown.length && (
                    <div inert>
                      <OmnisWelcome onPick={() => {}} />
                    </div>
                  )}
                  {shown.map((item) => (
                    <div key={item.at} data-film-message={item.at}>
                      {item.side === "user" ? (
                        <MyMessage content={item.text} iso={SAID_AT} fresh />
                      ) : item.kind === "tools" && elapsed < 65000 ? (
                        <LiveOmnis text="" tools={liveTools(elapsed)} />
                      ) : (
                        <OmnisMessage
                          message={{
                            id: `film-${item.at}`,
                            content: item.text,
                            createdAt: SAID_AT,
                            fromOmnis: true,
                            sources: [],
                          }}
                          fresh
                          tools={item.kind === "tools" ? DONE_TOOLS : []}
                        />
                      )}
                      {item.at === 23000 && cardVisible && (
                        <div ref={confirm} className="film-real-card">
                          <AgentCard
                            card={card}
                            deciding={
                              cardStatus === "APPROVED" ? "approve" : null
                            }
                            disabled={false}
                            onDecide={(decision) => {
                              if (decision === "approve") seek(30500)
                              else {
                                setCancelled(true)
                                setPlaying(false)
                              }
                            }}
                          />
                        </div>
                      )}
                      {item.kind === "created" && (
                        <div className="film-extra film-created">
                          <span>✓ 업무 생성 완료</span>
                          <b>새빛바이오 분석 서비스 제안서 작성</b>
                          <small>담당 A 사원 · 금요일 마감 · 진행 전</small>
                        </div>
                      )}
                      {item.kind === "priorities" && (
                        <div className="film-extra demo-priorities">
                          <p>
                            <b>01</b> 제안서 초안 <em>최우선 · 팀 검토 선행</em>
                          </p>
                          <p>
                            <b>02</b> 견적 검토 <em>초안 완료 후</em>
                          </p>
                          <p>
                            <b>03</b> 주간 진행 상황 정리 <em>이번 주</em>
                          </p>
                        </div>
                      )}
                      {item.kind === "draft" && (
                        <div className="film-extra demo-document">
                          <small>제안서 초안</small>
                          <h4>
                            새빛바이오
                            <br />
                            분석 서비스 제안서
                          </h4>
                          <p>01 제안 배경 — 상담 요청과 분석 목적</p>
                          <p>02 서비스 범위 — 분석 항목 및 산출물</p>
                          <p>03 진행 일정 — 사전 협의 · 분석 · 결과 검토</p>
                          <div>
                            참고: 사내 상담 이력 · 서비스 소개 · 공개 웹 자료
                            <br />
                            검토 필요: 견적 · 최종 일정 · 출처 원문
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div ref={composerBox} inert>
                <Composer
                  textareaRef={textarea}
                  value={draft}
                  onChange={() => {}}
                  onSend={() => {}}
                  busy={busy}
                  autoFocus={false}
                  waitingCard={cardVisible && cardStatus === "PENDING"}
                />
              </div>
              <small className="demo-caption">
                가상 데이터 시연 · 실제 업무나 문서는 생성되지 않습니다.
              </small>
            </div>
          </div>
          <div
            className={`film-cursor ${opening || clickingSend || clickingConfirm ? "cursor-visible" : ""} ${clickingSend || clickingConfirm || (elapsed > 1700 && elapsed < 2600) || (elapsed > 4300 && elapsed < 5000) ? "cursor-click" : ""}`}
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 30">
              <path d="M2 2v23l6-6 5 9 4-2-5-9h9Z" />
            </svg>
            <span>
              {clickingConfirm ? "확인" : opening ? "새 대화" : "보내기"}
            </span>
          </div>
          {employee && elapsed < 37500 && (
            <div className="film-person-transition">
              <OmnisMark className="size-14 rounded-2xl" />
              <h3>A 사원의 화면으로</h3>
              <p>업무가 담당자에게 연결됐습니다.</p>
            </div>
          )}
          <ShineBorder
            className="film-shine"
            shineColor={RAINBOW}
            borderWidth={2}
            duration={9}
          />
          <div
            className="film-player-overlay"
            role="group"
            aria-label="시연 재생 컨트롤"
          >
            <div className="film-controls">
              <Button
                onClick={() => {
                  if (elapsed >= END || cancelled) seek(0)
                  setPlaying(elapsed >= END || cancelled || !playing)
                }}
              >
                <HugeiconsIcon
                  icon={
                    elapsed >= END || cancelled
                      ? Refresh01Icon
                      : playing
                        ? PauseIcon
                        : PlayIcon
                  }
                  size={18}
                  aria-hidden
                />
                {elapsed >= END || cancelled
                  ? "다시 보기"
                  : playing
                    ? "일시정지"
                    : "재생"}
              </Button>
              <span className="film-chapter">
                {String(index + 1).padStart(2, "0")} / 07 <b>{chapter.title}</b>
              </span>
              <a href="#effects" onClick={() => setPlaying(false)}>
                시연 건너뛰기{" "}
                <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
