"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { DEMO_END, DEMO_LENGTH, TourDemo, type DemoScript } from "@/components/onboarding/tour-demo"
import { useTourClock } from "@/components/onboarding/use-tour-clock"
import { useMediaQuery } from "@/hooks/use-media-query"

/**
 * 온보딩의 옴니스 시연(tour-demo.tsx)을 랜딩에서 재생한다 — 실제 말풍선 · 도구 줄 · 확인 카드 · 입력칸 컴포넌트,
 * 대본은 시간의 순수 함수(frameAt). **모델도 API 도 부르지 않는다**(시연 쪽 주석 그대로).
 *
 * 온보딩은 안내의 시계가 대본을 움직였는데, 랜딩에는 안내가 없다. 그래서 같은 시계(useTourClock)를
 * 「화면에 보이는 동안만」 돌린다 — 스크롤로 들어오면 재생, 벗어나면 멈춤, 숨은 탭은 시간을 쓰지 않는다.
 * 자동 반복 · 일시정지 · 타임라인은 두지 않고(계획서), 끝나면 「다시 보기」 하나만 둔다.
 * 시연 컴포넌트는 로그인 컨텍스트(useOnboarding · 채팅 사용자)를 쓰지 않아 비로그인 랜딩에서 그대로 쓴다.
 * 모션 감소 설정이면 대본이 끝난 장면(DEMO_END)을 바로 보인다.
 */
export function DemoStage({ script, title, summary }: { script: DemoScript; title: string; summary: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [inView, setInView] = useState(false)
  const [round, setRound] = useState(0)
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)")

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    measure()
    // 반 이상 보여야 시작한다 — 위쪽 끝만 걸친 채로 대본이 지나가 버리지 않게
    const seen = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.5 })
    seen.observe(el)
    return () => {
      resize.disconnect()
      seen.disconnect()
    }
  }, [])

  return (
    <figure className="lv2-demo" aria-label={title}>
      <div className="lv2-demo-bar" aria-hidden="true">
        <span className="lv2-demo-dots">
          <i />
          <i />
          <i />
        </span>
        <span>옴니스 · 새 대화</span>
        <span className="lv2-demo-tag">예시</span>
      </div>
      <div ref={box} className="lv2-demo-room">
        {size && (
          <Playback
            key={round}
            script={script}
            size={size}
            playing={inView}
            reduced={reduced}
            onReplay={() => setRound((n) => n + 1)}
          />
        )}
      </div>
      {/* 시연 층은 inert 라 읽히지 않는다 — 무엇이 지나가는지 글로 남긴다 */}
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}

function Playback({
  script,
  size,
  playing,
  reduced,
  onReplay,
}: {
  script: DemoScript
  size: { width: number; height: number }
  playing: boolean
  reduced: boolean
  onReplay: () => void
}) {
  const [ended, setEnded] = useState(false)
  const onEnd = useCallback(() => setEnded(true), [])
  const clock = useTourClock(DEMO_LENGTH[script], onEnd, playing && !reduced)
  const elapsed = reduced ? DEMO_END[script] : clock.elapsed
  return (
    <>
      <TourDemo script={script} elapsed={elapsed} rect={{ x: 0, y: 0, ...size }} />
      {ended && !reduced && (
        <button type="button" className="lv2-demo-replay" onClick={onReplay}>
          <span aria-hidden="true">↻</span> 다시 보기
        </button>
      )}
    </>
  )
}
