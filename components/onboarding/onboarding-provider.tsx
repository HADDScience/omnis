"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { apiUrl } from "@/lib/base-path"
import type { OnboardingState } from "@/lib/schemas/onboarding"
import { peekTourResume } from "./tour-stops"

const loadingTour = () => (
  <div
    role="status"
    className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-background text-sm text-muted-foreground"
  >
    사용 안내를 준비하는 중…
  </div>
)

// 풀스크린 영상(welcome-tour.tsx)은 랜딩페이지로 옮겨 쓰려고 파일만 남기고 온보딩에서는 뗐다(2026-10-29 작업지시자).
// 안내는 실제 화면을 비추는 스포트라이트 하나다 — mydocs/plans/2026-10-29-onboarding-tab-tour.md
const SpotlightTour = dynamic(() => import("./spotlight-tour"), {
  ssr: false,
  loading: loadingTour,
})
const McpDialog = dynamic(() => import("./mcp-dialog"), { ssr: false })

type Phase = "spotlight" | "app"
/** 온보딩 안에서 열 때 — 닫기 버튼 이름과 닫힌 뒤 안내로 돌아가는 일 */
export interface McpOpenOptions {
  closeLabel?: string
  onClose?: () => void
}
interface OnboardingContextValue {
  replay: () => void
  openMcp: (options?: McpOpenOptions) => void
  spotlightTarget: string | null
  setSpotlightTarget: (target: string | null) => void
  active: boolean
}
const Context = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: OnboardingState
}) {
  // 영상만 보고 안내를 마치지 않은 사람(onboardingVideoSeenAt 만 있는 사람)도 새 안내를 처음부터 본다
  const [phase, setPhase] = useState<Phase>(
    initialState.onboardingCompletedAt ? "app" : "spotlight"
  )
  // 안내를 마친 사람이 「다시 보기」 중에 소셜 연결로 나갔다 돌아왔다 — 하던 안내를 잇는다.
  // sessionStorage 는 서버에서 못 읽어 첫 그리기 뒤에 본다
  useEffect(() => {
    if (initialState.onboardingCompletedAt && peekTourResume()) setPhase("spotlight")
  }, [initialState.onboardingCompletedAt])
  const [spotlightTarget, setSpotlightTarget] = useState<string | null>(null)
  const [mcpOpen, setMcpOpen] = useState<McpOpenOptions | null>(null)
  // Serialize writes so an earlier, slow request cannot race the final completion.
  const saves = useRef(Promise.resolve())
  const persist = useCallback((next: "complete") => {
    const save = async () => {
      const res = await fetch(apiUrl("/api/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: next }),
      })
      if (!res.ok) throw new Error("온보딩 이력을 저장하지 못했습니다.")
    }
    saves.current = saves.current.then(save).catch(() => {
      toast.error(
        "안내 이력을 저장하지 못했어요. 다음 접속에 다시 표시될 수 있어요.",
        {
          action: {
            label: "다시 저장",
            onClick: () => {
              void save().catch(() =>
                toast.error("저장에 실패했어요. 연결 상태를 확인해 주세요.")
              )
            },
          },
        }
      )
    })
  }, [])
  const finishTour = useCallback(() => {
    persist("complete")
    setSpotlightTarget(null)
    setPhase("app")
  }, [persist])
  return (
    <Context.Provider
      value={{
        replay: () => {
          setMcpOpen(null)
          setPhase("spotlight")
        },
        // 메뉴의 onClick 이 이벤트를 넘겨도 옵션으로 읽히지 않게 필요한 칸만 꺼낸다.
        openMcp: (options) =>
          setMcpOpen({ closeLabel: options?.closeLabel, onClose: options?.onClose }),
        spotlightTarget,
        setSpotlightTarget,
        active: phase !== "app",
      }}
    >
      {children}
      {phase === "spotlight" && <SpotlightTour onFinish={finishTour} />}
      {mcpOpen && (
        <McpDialog
          closeLabel={mcpOpen.closeLabel}
          onClose={() => {
            const back = mcpOpen.onClose
            setMcpOpen(null)
            back?.()
          }}
        />
      )}
    </Context.Provider>
  )
}

export function useOnboarding() {
  const context = useContext(Context)
  if (!context)
    throw new Error(
      "useOnboarding은 OnboardingProvider 안에서 사용해야 합니다."
    )
  return context
}
