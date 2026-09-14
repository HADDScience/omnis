"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { apiUrl } from "@/lib/base-path"
import type { OnboardingState } from "@/lib/schemas/onboarding"

const WelcomeTour = dynamic(() => import("./welcome-tour"), { ssr: false })
const SpotlightTour = dynamic(() => import("./spotlight-tour"), { ssr: false })
const McpDialog = dynamic(() => import("./mcp-dialog"), { ssr: false })

type Phase = "video" | "spotlight" | "app"
interface OnboardingContextValue {
  replay: () => void
  openMcp: () => void
  spotlightTarget: string | null
  setSpotlightTarget: (target: string | null) => void
  active: boolean
}
const Context = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({ children, initialState }: { children: ReactNode; initialState: OnboardingState }) {
  const [phase, setPhase] = useState<Phase>(initialState.onboardingCompletedAt ? "app" : initialState.onboardingVideoSeenAt ? "spotlight" : "video")
  const [spotlightTarget, setSpotlightTarget] = useState<string | null>(null)
  const [mcpOpen, setMcpOpen] = useState(false)
  // Serialize writes so an earlier, slow request cannot race the final completion.
  const saves = useRef(Promise.resolve())
  const persist = useCallback((next: "video" | "complete") => {
    const save = async () => {
      const res = await fetch(apiUrl("/api/onboarding"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: next }) })
      if (!res.ok) throw new Error("온보딩 이력을 저장하지 못했습니다.")
    }
    saves.current = saves.current.then(save).catch(() => {
      toast.error("안내 이력을 저장하지 못했어요. 다음 접속에 다시 표시될 수 있어요.", { action: { label: "다시 저장", onClick: () => { void save().catch(() => toast.error("저장에 실패했어요. 연결 상태를 확인해 주세요.")) } } })
    })
  }, [])
  const finishVideo = useCallback(() => { persist("video"); setPhase("spotlight") }, [persist])
  const finishTour = useCallback(() => { persist("complete"); setSpotlightTarget(null); setPhase("app") }, [persist])
  return <Context.Provider value={{ replay: () => { setMcpOpen(false); setPhase("video") }, openMcp: () => setMcpOpen(true), spotlightTarget, setSpotlightTarget, active: phase !== "app" }}>
    {children}
    {phase === "video" && <WelcomeTour onFinish={finishVideo} />}
    {phase === "spotlight" && <SpotlightTour onFinish={finishTour} />}
    {mcpOpen && <McpDialog onClose={() => setMcpOpen(false)} />}
  </Context.Provider>
}

export function useOnboarding() {
  const context = useContext(Context)
  if (!context) throw new Error("useOnboarding은 OnboardingProvider 안에서 사용해야 합니다.")
  return context
}
