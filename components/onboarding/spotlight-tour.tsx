"use client"

import { useEffect, useRef, useState } from "react"
import { useSidebar } from "@/components/ui/sidebar"
import { useRightPanel } from "@/components/layout/right-panel-context"
import { useOnboarding } from "./onboarding-provider"
import { TourSurface } from "./tour-surface"
import { useTourClock } from "./use-tour-clock"
import "./onboarding.css"

const stops = [
  { target: "tasks", title: "내 업무를 한눈에", copy: "업무 메뉴에서 담당 업무와 진행 상태를 확인하세요. 오늘 마감·내가 담당 필터로 필요한 업무를 찾을 수 있어요.", sidebar: true },
  { target: "chat-trigger", title: "업무 지시는 대화에서", copy: "이 버튼으로 대화 패널을 열 수 있어요. 채팅에서 / 명령으로 업무를 만들거나, 새 업무 버튼을 사용하세요.", sidebar: false },
  { target: "conversation", title: "대화와 업무를 함께", copy: "전체 대화에서 #으로 업무를 언급하거나 업무 스레드에 답장하세요. 파일 첨부·완료 보고·추가 지시가 업무에 이어집니다.", sidebar: false },
  { target: "ai", title: "Omnis AI에게 물어보세요", copy: "업무와 회사 지식에 궁금한 점을 질문하세요. 관련 자료를 찾아 답변을 도와드려요.", sidebar: true },
  { target: "resources", title: "회사의 자원을 활용하세요", copy: "고객·견적, 지식재산권, HADD DB와 보고서까지. 필요한 도구로 바로 이동할 수 있어요.", sidebar: true },
  { target: "profile", title: "나의 설정은 여기에서", copy: "프로필 메뉴에서 계정 설정, AI 연결과 온보딩 튜토리얼을 찾을 수 있어요.", sidebar: true },
  { target: "mcp", title: "나의 AI에 Omnis 연결", copy: "Omnis MCP 등록을 열고 서버 주소를 복사하세요. 사용하는 AI 앱의 커넥터 설정에서 연결을 마무리해 주세요.", sidebar: true },
  { target: "replay", title: "언제든 다시 볼 수 있어요", copy: "온보딩 튜토리얼에서 영상과 화면 안내를 다시 볼 수 있어요. 이제 Omnis에서 첫 업무를 시작해 보세요.", sidebar: true },
]
type Box = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number }

function Stop({ index, onAdvance, onFinish }: { index: number; onAdvance: () => void; onFinish: () => void }) {
  const stop = stops[index]
  const panel = useRightPanel()
  const sidebar = useSidebar()
  const { setSpotlightTarget } = useOnboarding()
  const latest = useRef({ panel, sidebar })
  useEffect(() => { latest.current = { panel, sidebar } }, [panel, sidebar])
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
      const selector = stop.target === "conversation" ? '[data-onboarding="conversation"]' : `[data-onboarding="${stop.target}"]`
      const node = [...document.querySelectorAll<HTMLElement>(selector)].find(item => {
        const rect = item.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight
      })
      if (!node) { setBox(null); return }
      const outer = surface.getBoundingClientRect()
      const scale = outer.width / surface.clientWidth || 1
      const rect = node.getBoundingClientRect()
      const x = Math.max(8, (rect.left - outer.left) / scale - 5)
      const y = Math.max(8, (rect.top - outer.top) / scale - 5)
      setBox({ x, y, width: Math.max(0, Math.min(rect.width / scale + 10, surface.clientWidth - x - 8)), height: Math.max(0, Math.min(rect.height / scale + 10, surface.clientHeight - y - 8)), viewportWidth: surface.clientWidth, viewportHeight: surface.clientHeight })
    }
    measure()
    const interval = window.setInterval(measure, 100)
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, [stop, sidebar.isMobile, setSpotlightTarget])
  const cardWidth = box ? Math.min(330, box.viewportWidth - 32) : 330
  const cardStyle = !box ? undefined : box.viewportWidth >= 768 && box.x + box.width + cardWidth + 35 < box.viewportWidth
    ? { left: box.x + box.width + 20, top: Math.min(Math.max(16, box.y), Math.max(16, box.viewportHeight - 270)), width: cardWidth }
    : box.viewportWidth >= 768 && box.x > cardWidth + 35
      ? { left: box.x - cardWidth - 20, top: Math.min(Math.max(16, box.y), Math.max(16, box.viewportHeight - 270)), width: cardWidth }
      : { left: 16, width: cardWidth, ...(box.y + box.height / 2 > box.viewportHeight / 2 ? { top: 16 } : { bottom: 16 }) }
  const conversationIsAi = stop.target === "conversation" && typeof document !== "undefined" && document.querySelector('[data-onboarding="conversation"] [title="Omnis AI"][aria-pressed="true"]')
  return <>
    <svg className="spotlight-shade" width="100%" height="100%" aria-hidden="true">
      <defs><mask id="omnis-spotlight-hole"><rect width="100%" height="100%" fill="white" />{box && <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="10" fill="black" />}</mask></defs>
      <rect width="100%" height="100%" fill="black" fillOpacity=".62" mask="url(#omnis-spotlight-hole)" />
      {box && <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="10" fill="none" stroke="var(--primary)" strokeWidth="2" />}
    </svg>
    <section className="spotlight-card" style={cardStyle} data-tour-stop={stop.target}>
      <span className="intro-eyebrow">OMNIS GUIDE · {index + 1} / {stops.length}</span>
      <h2>{stop.title}</h2><p>{conversationIsAi ? "지금은 Omnis AI 탭이 열려 있어요. 전체 탭으로 전환하면 업무 언급·파일 첨부·완료 보고를 할 수 있어요. 작성 중인 내용은 그대로 보존합니다." : stop.copy}</p>
      {!box && settled && <p className="spotlight-fallback">현재 화면에서는 이 영역이 접혀 있거나 표시되지 않아요. 메뉴를 열어 확인할 수 있어요.</p>}
      <div className="intro-progress"><span><i style={{ transform: `scaleX(${clock.elapsed / 7000})` }} /></span></div>
      <div className="spotlight-controls"><button onClick={clock.toggle}>{clock.paused ? "재생" : "일시정지"}</button><button onClick={onFinish}>{index === stops.length - 1 ? "안내 마치기" : "안내 건너뛰기"}</button></div>
      <span role="status" className="sr-only">{stop.title}</span>
    </section>
  </>
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
  return <TourSurface label="Omnis 화면 안내" onEscape={onFinish} className="spotlight-surface"><Stop key={index} index={index} onAdvance={() => index === stops.length - 1 ? onFinish() : setIndex(value => value + 1)} onFinish={onFinish} /></TourSurface>
}
