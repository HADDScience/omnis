"use client"

import { useEffect, useRef } from "react"

export function HeroVideo({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (mql.matches && ref.current) {
      ref.current.pause()
    }
  }, [])

  return (
    <>
      <video
        ref={ref}
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/40 to-background" />
    </>
  )
}
