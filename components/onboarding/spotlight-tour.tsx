"use client"

import { useEffect, useRef, useState } from "react"
import { useSidebar } from "@/components/ui/sidebar"
import { useRightPanel } from "@/components/layout/right-panel-context"
import { useOnboarding } from "./onboarding-provider"
import { TourSurface } from "./tour-surface"
import { useTourClock } from "./use-tour-clock"
import "./onboarding.css"

const stops = [
  {
    target: "tasks",
    title: "내 업무를 한눈에",
    copy: "업무 메뉴에서 담당 업무와 진행 상태를 확인하세요. 오늘 마감·내가 담당 필터로 필요한 업무를 찾을 수 있어요.",
    sidebar: true,
  },
  {
    target: "chat-trigger",
    title: "업무 지시는 대화에서",
    copy: "이 버튼으로 대화 패널을 열 수 있어요. 채팅에서 / 명령으로 업무를 만들거나, 새 업무 버튼을 사용하세요.",
    sidebar: false,
  },
  {
    target: "conversation",
    title: "대화와 업무를 함께",
    copy: "전체 대화에서 #으로 업무를 언급하거나 업무 스레드에 답장하세요. 파일 첨부·완료 보고·추가 지시가 업무에 이어집니다.",
    sidebar: false,
  },
  {
    target: "ai",
    title: "Omnis AI에게 물어보세요",
    copy: "업무와 회사 지식에 궁금한 점을 질문하세요. 관련 자료를 찾아 답변을 도와드려요.",
    sidebar: true,
  },
  {
    target: "resources",
    title: "회사의 자원을 활용하세요",
    copy: "고객·견적, 지식재산권, HADD DB와 보고서까지. 필요한 도구로 바로 이동할 수 있어요.",
    sidebar: true,
  },
  {
    target: "profile",
    title: "나의 설정은 여기에서",
    copy: "프로필 메뉴에서 계정 설정, AI 연결과 온보딩 튜토리얼을 찾을 수 있어요.",
    sidebar: true,
  },
  {
    target: "mcp",
    title: "나의 AI에 Omnis 연결",
    copy: "Omnis MCP 등록을 열고 쓰는 AI 도구 탭을 고르세요. 커맨드나 주소를 복사해 붙이고, Omnis 계정으로 승인하면 연결돼요.",
    sidebar: true,
  },
  {
    target: "replay",
    title: "언제든 다시 볼 수 있어요",
    copy: "온보딩 튜토리얼에서 영상과 화면 안내를 다시 볼 수 있어요. 이제 Omnis에서 첫 업무를 시작해 보세요.",
    sidebar: true,
  },
]
type Box = {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  cardX: number
  cardY: number
  connector: string
}

function Stop({
  index,
  onAdvance,
  onFinish,
  onPrevious,
}: {
  index: number
  onAdvance: () => void
  onFinish: () => void
  onPrevious: () => void
}) {
  const stop = stops[index]
  const panel = useRightPanel()
  const sidebar = useSidebar()
  const { setSpotlightTarget } = useOnboarding()
  const latest = useRef({ panel, sidebar })
  useEffect(() => {
    latest.current = { panel, sidebar }
  }, [panel, sidebar])
  const card = useRef<HTMLElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [settled, setSettled] = useState(false)
  const clock = useTourClock(7000, onAdvance, settled)
  useEffect(() => {
    const { panel: p, sidebar: s } = latest.current
    setSpotlightTarget(stop.target)
    if (s.isMobile) s.setOpenMobile(stop.sidebar)
    else if (stop.sidebar) s.setOpen(true)
    // Do not switch the current panel tab: that would discard an unsent message.
    if (stop.target === "conversation" && !p.open) p.setOpen(true)
    const timeout = window.setTimeout(() => setSettled(true), 1000)
    const measure = () => {
      const surface = document.querySelector<HTMLElement>(".spotlight-surface")
      if (!surface) return
      const selector =
        stop.target === "conversation"
          ? '[data-onboarding="conversation"] textarea, [data-onboarding="conversation"] [aria-label="옴니스에게 보낼 질문"]'
          : `[data-onboarding="${stop.target}"]`
      const node = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (item) => {
          const rect = item.getBoundingClientRect()
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
          )
        }
      )
      if (!node) {
        setBox(null)
        return
      }
      const outer = surface.getBoundingClientRect()
      const scale = outer.width / surface.clientWidth || 1
      const rect = node.getBoundingClientRect()
      // Intersect the real control with its scroll containers before adding the halo.
      let left = Math.max(0, rect.left)
      let top = Math.max(0, rect.top)
      let right = Math.min(window.innerWidth, rect.right)
      let bottom = Math.min(window.innerHeight, rect.bottom)
      for (
        let parent = node.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
      }
      if (right <= left || bottom <= top) {
        setBox(null)
        return
      }
      const vw = surface.clientWidth
      const vh = surface.clientHeight
      const x = Math.max(4, (left - outer.left) / scale - 5)
      const y = Math.max(4, (top - outer.top) / scale - 5)
      const width = Math.min((right - outer.left) / scale + 5, vw - 4) - x
      const height = Math.min((bottom - outer.top) / scale + 5, vh - 4) - y
      const cw = Math.min(330, vw - 32)
      const ch = Math.min(card.current?.offsetHeight ?? 300, vh - 32)
      const clampX = (value: number) =>
        Math.max(16, Math.min(value, vw - cw - 16))
      const clampY = (value: number) =>
        Math.max(16, Math.min(value, vh - ch - 16))
      const gap = 20
      let cardX: number
      let cardY: number
      let connector = ""
      if (x + width + gap + cw <= vw - 16 || x - gap - cw >= 16) {
        const toRight = x + width + gap + cw <= vw - 16
        cardX = toRight ? x + width + gap : x - gap - cw
        cardY = clampY(y + height / 2 - ch / 2)
        const anchorY = Math.max(
          cardY + 20,
          Math.min(y + height / 2, cardY + ch - 20)
        )
        const fromX = toRight ? x + width : x
        const toX = toRight ? cardX : cardX + cw
        connector = `M ${fromX} ${y + height / 2} C ${(fromX + toX) / 2} ${y + height / 2}, ${(fromX + toX) / 2} ${anchorY}, ${toX} ${anchorY}`
      } else {
        cardX = clampX(x + width / 2 - cw / 2)
        const belowFits = y + height + gap + ch <= vh - 16
        const aboveFits = y - gap - ch >= 16
        const below = belowFits || (!aboveFits && y + height / 2 < vh / 2)
        cardY = clampY(below ? y + height + gap : y - gap - ch)
        if (belowFits || aboveFits) {
          const anchorX = Math.max(
            cardX + 20,
            Math.min(x + width / 2, cardX + cw - 20)
          )
          const fromY = below ? y + height : y
          const toY = below ? cardY : cardY + ch
          connector = `M ${x + width / 2} ${fromY} C ${x + width / 2} ${(fromY + toY) / 2}, ${anchorX} ${(fromY + toY) / 2}, ${anchorX} ${toY}`
        }
      }
      const next = {
        x,
        y,
        width,
        height,
        viewportWidth: vw,
        viewportHeight: vh,
        cardX,
        cardY,
        connector,
      }
      setBox((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof Box] === next[key as keyof Box]
        )
          ? previous
          : next
      )
    }
    // Follow menu transitions and scrolling in the same frame, without a 100ms trailing hole.
    let frame = 0
    const track = () => {
      measure()
      frame = requestAnimationFrame(track)
    }
    frame = requestAnimationFrame(track)
    return () => {
      clearTimeout(timeout)
      cancelAnimationFrame(frame)
    }
  }, [stop, sidebar.isMobile, setSpotlightTarget])
  const cardStyle = box
    ? {
        left: box.cardX,
        top: box.cardY,
        width: Math.min(330, box.viewportWidth - 32),
      }
    : undefined
  const conversationIsAi =
    stop.target === "conversation" &&
    typeof document !== "undefined" &&
    document.querySelector(
      '[data-onboarding="conversation"] [title="Omnis AI"][aria-pressed="true"]'
    )
  return (
    <>
      <svg
        className="spotlight-shade"
        width="100%"
        height="100%"
        aria-hidden="true"
      >
        <defs>
          <mask id="omnis-spotlight-hole">
            <rect width="100%" height="100%" fill="white" />
            {box && (
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="black"
          fillOpacity=".56"
          mask="url(#omnis-spotlight-hole)"
        />
        {box && (
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx="10"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
          />
        )}
        {box?.connector && (
          <path
            d={box.connector}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity=".85"
          />
        )}
      </svg>
      <section
        ref={card}
        className="spotlight-card"
        style={cardStyle}
        data-tour-stop={stop.target}
      >
        <span className="intro-eyebrow">
          OMNIS GUIDE · {index + 1} / {stops.length}
        </span>
        <h2>{stop.title}</h2>
        <p>
          {conversationIsAi
            ? "지금은 Omnis AI 탭이 열려 있어요. 전체 탭으로 전환하면 업무 언급·파일 첨부·완료 보고를 할 수 있어요. 작성 중인 내용은 그대로 보존합니다."
            : stop.copy}
        </p>
        {!box && settled && (
          <p className="spotlight-fallback">
            현재 화면에서는 이 영역이 접혀 있거나 표시되지 않아요. 메뉴를 열어
            확인할 수 있어요.
          </p>
        )}
        <div className="intro-progress">
          <span>
            <i style={{ transform: `scaleX(${clock.elapsed / 7000})` }} />
          </span>
        </div>
        <div className="spotlight-playback">
          <button onClick={clock.toggle}>
            {clock.paused ? "▷ 재생" : "Ⅱ 일시정지"}
          </button>
          <span>
            {clock.paused
              ? "일시정지 중"
              : `자동 진행 · ${Math.max(1, Math.ceil((7000 - clock.elapsed) / 1000))}초`}
          </span>
        </div>
        <div className="spotlight-controls">
          <button
            disabled={index === 0}
            onClick={onPrevious}
            aria-label="이전 안내"
          >
            ← 이전
          </button>
          <button onClick={onFinish}>안내 건너뛰기</button>
          <button className="spotlight-next" onClick={onAdvance}>
            {index === stops.length - 1 ? "안내 마치기" : "다음 →"}
          </button>
        </div>
        <span role="status" className="sr-only">
          {stop.title}
        </span>
      </section>
    </>
  )
}

export default function SpotlightTour({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0)
  const sidebar = useSidebar()
  const panel = useRightPanel()
  const { setSpotlightTarget } = useOnboarding()
  const original = useRef({ sidebar, panel })
  useEffect(() => {
    const snapshot = original.current
    return () => {
      snapshot.sidebar.setOpen(snapshot.sidebar.open)
      snapshot.sidebar.setOpenMobile(snapshot.sidebar.openMobile)
      snapshot.panel.setOpen(snapshot.panel.open)
      setSpotlightTarget(null)
    }
  }, [setSpotlightTarget])
  return (
    <TourSurface
      label="Omnis 화면 안내"
      onEscape={onFinish}
      className="spotlight-surface"
    >
      <Stop
        key={index}
        index={index}
        onAdvance={() =>
          index === stops.length - 1
            ? onFinish()
            : setIndex(index + 1)
        }
        onFinish={onFinish}
        onPrevious={() => setIndex(Math.max(0, index - 1))}
      />
    </TourSurface>
  )
}
