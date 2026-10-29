"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useOnboarding } from "./onboarding-provider"
import { TourSurface } from "./tour-surface"
import { useTourClock } from "./use-tour-clock"
import {
  TOUR_STOPS as stops,
  clearTourResume,
  peekTourResume,
  saveTourResume,
} from "./tour-stops"
import { TourSocial } from "./tour-social"
import "./onboarding.css"

/** 장면 하나를 읽는 시간. 탭 장면은 이 시간이 지나면 다음으로 넘어간다 */
const READ_MS = 7000

type Rect = { x: number; y: number; width: number; height: number }
type Box = {
  /** 비추는 대상(테두리 · 연결선이 붙는다). 없으면 설명창만 가운데 */
  hole: Rect | null
  /** 탭 장면의 화면 본문 — 옅게 비춘다 */
  body: Rect | null
  viewportWidth: number
  viewportHeight: number
  cardX: number
  cardY: number
  cardWidth: number
  connector: string
}

/** 화면에 실제로 보이는 첫 요소 — PC 상단 nav 와 폰 하단 nav 가 같은 표식을 달고 있어 보이는 쪽을 고른다 */
function visibleNode(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((item) => {
    const rect = item.getBoundingClientRect()
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    )
  })
}

/** 요소를 감싼 스크롤 칸 · 화면과 겹치는 부분만 — 잘려 안 보이는 곳까지 비추지 않는다 */
function clippedRect(node: HTMLElement) {
  const rect = node.getBoundingClientRect()
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
  return right <= left || bottom <= top ? null : { left, top, right, bottom }
}

function Stop({
  index,
  from,
  onAdvance,
  onFinish,
  onPrevious,
}: {
  index: number
  /** 안내를 시작한 화면 — 소셜 연결로 나갔다 돌아온 뒤에도 끝나면 이리로 */
  from: string
  onAdvance: () => void
  onFinish: () => void
  onPrevious: () => void
}) {
  const stop = stops[index]
  const router = useRouter()
  const pathname = usePathname()
  const { setSpotlightTarget } = useOnboarding()
  const card = useRef<HTMLElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [settled, setSettled] = useState(false)
  // 간편 로그인은 고르는 장면이라 저절로 넘기지 않는다(시계 0 = 멈춤)
  const duration = stop.social ? 0 : READ_MS
  const clock = useTourClock(duration, onAdvance, settled)
  // 장면의 화면으로 옮겨 간다. 이미 그 화면이면 그대로 둔다(다시 읽으면 쓰던 글 · 스크롤이 사라진다)
  useEffect(() => {
    if (stop.route && pathname !== stop.route) router.push(stop.route)
    // 들어갈 때 한 번만 — 옮겨 간 뒤 pathname 이 바뀌어도 다시 밀지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop])
  useEffect(() => {
    setSpotlightTarget(stop.target ?? null)
    const timeout = window.setTimeout(() => setSettled(true), 1000)
    const measure = () => {
      const surface = document.querySelector<HTMLElement>(".spotlight-surface")
      if (!surface) return
      const outer = surface.getBoundingClientRect()
      const scale = outer.width / surface.clientWidth || 1
      const vw = surface.clientWidth
      const vh = surface.clientHeight
      const local = (r: { left: number; top: number; right: number; bottom: number }, pad = 0): Rect => {
        const x = Math.max(4, (r.left - outer.left) / scale - pad)
        const y = Math.max(4, (r.top - outer.top) / scale - pad)
        return {
          x,
          y,
          width: Math.min((r.right - outer.left) / scale + pad, vw - 4) - x,
          height: Math.min((r.bottom - outer.top) / scale + pad, vh - 4) - y,
        }
      }
      const node = stop.target ? visibleNode(`[data-onboarding="${stop.target}"]`) : undefined
      const clip = node ? clippedRect(node) : null
      const hole = clip ? local(clip, 5) : null
      // 화면 본문 — 떠 있는 nav 밑으로 비워 둔 여백(padding)은 빼고 잰다
      let body: Rect | null = null
      const main = stop.body ? visibleNode("[data-main-scroll]") : undefined
      const mainClip = main ? clippedRect(main) : null
      if (main && mainClip) {
        const style = getComputedStyle(main)
        body = local({
          ...mainClip,
          top: mainClip.top + parseFloat(style.paddingTop || "0"),
          bottom: mainClip.bottom - parseFloat(style.paddingBottom || "0"),
        })
        if (body.width <= 0 || body.height <= 0) body = null
      }
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
      if (stop.target && !hole) {
        // 대상을 아직 못 찾았다(화면을 옮겨 가는 중이거나 접혀 있다) — 지난 자리에 둔다
        setBox((previous) => (previous ? { ...previous, hole: null, body } : null))
        return
      }
      if (!hole) {
        cardX = (vw - cw) / 2
        cardY = clampY((vh - ch) / 2)
      } else {
        const { x, y, width, height } = hole
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
      }
      const next: Box = {
        hole,
        body,
        viewportWidth: vw,
        viewportHeight: vh,
        cardX,
        cardY,
        cardWidth: cw,
        connector,
      }
      setBox((previous) =>
        previous && JSON.stringify(previous) === JSON.stringify(next)
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
  }, [stop, setSpotlightTarget])
  const cardStyle = box
    ? { left: box.cardX, top: box.cardY, width: box.cardWidth }
    : undefined
  const last = index === stops.length - 1
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
            {/* 본문은 옅게 — 무엇이 있는지 보이되 비추는 탭보다 앞에 나서지 않는다 */}
            {box?.body && (
              <rect
                data-spotlight-body
                x={box.body.x}
                y={box.body.y}
                width={box.body.width}
                height={box.body.height}
                rx="14"
                fill="black"
                fillOpacity=".6"
              />
            )}
            {box?.hole && (
              <rect
                x={box.hole.x}
                y={box.hole.y}
                width={box.hole.width}
                height={box.hole.height}
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
        {box?.hole && (
          <rect
            x={box.hole.x}
            y={box.hole.y}
            width={box.hole.width}
            height={box.hole.height}
            rx="10"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
          />
        )}
        {box?.hole && box.connector && (
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
        data-tour-stop={stop.id}
      >
        <span className="intro-eyebrow">
          OMNIS GUIDE · {index + 1} / {stops.length}
        </span>
        <h2>{stop.title}</h2>
        <p>{stop.copy}</p>
        {stop.social && (
          <TourSocial
            onLeave={() => saveTourResume({ stop: index + 1, from })}
          />
        )}
        {stop.target && !box?.hole && settled && (
          <p className="spotlight-fallback">
            현재 화면에서는 이 영역이 접혀 있거나 표시되지 않아요. 메뉴를 열어
            확인할 수 있어요.
          </p>
        )}
        {duration > 0 && (
          <>
            <div className="intro-progress">
              <span>
                <i style={{ transform: `scaleX(${clock.elapsed / duration})` }} />
              </span>
            </div>
            <div className="spotlight-playback">
              <button onClick={clock.toggle}>
                {clock.paused ? "▷ 재생" : "Ⅱ 일시정지"}
              </button>
              <span>
                {clock.paused
                  ? "일시정지 중"
                  : `자동 진행 · ${Math.max(1, Math.ceil((duration - clock.elapsed) / 1000))}초`}
              </span>
            </div>
          </>
        )}
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
            {last ? "안내 마치기" : stop.social ? "나중에" : "다음 →"}
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
  const router = useRouter()
  const pathname = usePathname()
  // 소셜 연결에서 돌아왔으면 적어 둔 장면부터(이 컴포넌트는 브라우저에서만 그린다 — ssr: false)
  const [resume] = useState(peekTourResume)
  useEffect(() => clearTourResume(), [])
  const [index, setIndex] = useState(resume?.stop ?? 0)
  const { setSpotlightTarget } = useOnboarding()
  // 안내는 장면마다 화면을 옮겨 다닌다. 끝나면 안내를 시작한 화면으로 돌려보낸다
  const [from] = useState(resume?.from ?? pathname)
  const latest = useRef(pathname)
  useEffect(() => {
    latest.current = pathname
  }, [pathname])
  useEffect(() => () => setSpotlightTarget(null), [setSpotlightTarget])
  const finish = () => {
    onFinish()
    if (latest.current !== from) router.push(from)
  }
  return (
    <TourSurface
      label="Omnis 화면 안내"
      onEscape={finish}
      className="spotlight-surface"
    >
      <Stop
        key={index}
        index={index}
        from={from}
        onAdvance={() =>
          index === stops.length - 1 ? finish() : setIndex(index + 1)
        }
        onFinish={finish}
        onPrevious={() => setIndex(Math.max(0, index - 1))}
      />
    </TourSurface>
  )
}
