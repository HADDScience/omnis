"use client"

import { useEffect, useRef } from "react"
import { DemoBanner } from "@/components/layout/demo-banner"
import { NoticeBanner } from "@/components/layout/notice-banner"

/**
 * 화면 맨 위의 띠들(점검 공지 · 데모 안내)을 한 덩어리로 두고 그 높이를 --demo-banner-height 에 쓴다.
 * 이름은 데모 시절 그대로지만 뜻은 「맨 위 띠의 높이」다 — 떠 있는 nav · 오른쪽 패널 · 셸 높이가
 * 모두 이 값만큼 내려가므로, 공지 띠가 유리 nav 를 덮지 않는다.
 */
export function TopBanners() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty("--demo-banner-height", `${el.getBoundingClientRect().height}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
      root.style.setProperty("--demo-banner-height", "0px")
    }
  }, [])

  return (
    <div ref={ref} className="sticky top-0" style={{ zIndex: "var(--z-banner)" }}>
      <NoticeBanner />
      <DemoBanner />
    </div>
  )
}
