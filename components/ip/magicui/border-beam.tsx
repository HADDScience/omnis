import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

/**
 * Magic UI 의 BorderBeam — 테두리를 한 바퀴 도는 빛.
 *
 * 원본은 motion(framer-motion)으로 움직이지만 여기서는 CSS 만 쓴다. 이 앱은
 * GitHub Pages 정적 배포라 번들이 곧 첫 화면의 무게이고, 버튼 하나를 빛나게
 * 하려고 애니메이션 런타임을 통째로 들일 이유가 없다. 움직임 자체는
 * `offset-path` 위를 도는 사각형이라 원본과 같은 방식이다.
 *
 * 쓰는 쪽은 `relative` 인 요소 안에 그냥 넣으면 된다. 테두리 굵기·모서리는
 * 부모에게서 상속받는다(`border-radius: inherit`).
 *
 * 실제 그리기는 `app/globals.css` 의 `.hadd-border-beam` 에 있다. 마스크와
 * `offset-path` 는 Tailwind 임의값으로 적으면 대괄호가 겹쳐 읽기 어렵고,
 * 지원하지 않는 브라우저를 위한 `@supports` 도 유틸리티로는 쓸 수 없다.
 */
export function BorderBeam({
  className,
  /** 도는 빛의 크기(px) */
  size = 56,
  /** 한 바퀴 도는 데 걸리는 시간(초) */
  duration = 6,
  /** 시작 위치를 어긋내는 값(초). 여러 개를 겹칠 때 쓴다. */
  delay = 0,
  colorFrom = "var(--color-indigo-500)",
  colorTo = "var(--color-pink-500)",
  borderWidth = 1.5,
}: {
  className?: string
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  borderWidth?: number
}) {
  return (
    <span
      aria-hidden
      className={cn("hadd-border-beam", className)}
      style={
        {
          "--beam-size": size,
          "--beam-duration": `${duration}s`,
          // 음수 지연이라 기다리지 않고 이미 그 지점부터 돈다.
          "--beam-delay": `-${delay}s`,
          "--beam-from": colorFrom,
          "--beam-to": colorTo,
          "--beam-border": borderWidth,
        } as CSSProperties
      }
    />
  )
}
