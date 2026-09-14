"use client"

import { useEffect, useState } from "react"

/** One clock drives both scene content and progress; hidden tabs do not consume reading time. */
export function useTourClock(
  duration: number,
  onEnd: () => void,
  ready = true
) {
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const update = () => setHidden(document.hidden)
    update()
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])
  useEffect(() => {
    if (paused || hidden || !ready || !duration) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const delta = now - previous
      previous = now
      setElapsed((value) => Math.min(duration, value + delta))
    }, 100)
    return () => clearInterval(timer)
  }, [duration, hidden, paused, ready])
  useEffect(() => {
    if (duration && elapsed >= duration) onEnd()
  }, [duration, elapsed, onEnd])
  return {
    elapsed,
    paused,
    stopped: paused || hidden || !ready,
    toggle: () => setPaused((value) => !value),
  }
}
