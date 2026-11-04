"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useOnboarding } from "@/components/onboarding/onboarding-provider"
import { apiUrl } from "@/lib/base-path"
import { flushUiEvents, noteUiPath, uiMetricsEnabled } from "@/lib/ui-metrics/client"
import { UI_METRICS_NOTICE } from "@/lib/ui-metrics/notice"
import { kstDayKey, SURVEY_COMMENT_MAX } from "@/lib/ui-metrics/rules"

/** 첫 화면과 앱 설치 권유(AppNudge)가 먼저 자리 잡은 뒤에 묻는다 */
const SURVEY_DELAY_MS = 4_000
const NOTICE_KEY = "omnis:ui-metrics:notice:v1"
const surveyCheckedKey = (userId: string) => `omnis:ui-survey:checked:${userId}`

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 저장하지 못하면 다음에 다시 확인한다 — 서버가 답을 알고 있어 같은 배포를 또 묻지는 않는다
  }
}

/** 입력칸에 쓰던 글이 있으면 대화창을 띄워 포커스를 뺏지 않는다 */
function isWriting(): boolean {
  const el = document.activeElement
  return (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.value.trim() !== ""
}

/**
 * 사용 기록의 화면 쪽 — 경로 알리기 · 탭 숨길 때 보내기 · 처음 한 번 안내 · 배포 다음 날 한 문항.
 *
 * 폴링이 아니다. 설문은 접속할 때와 탭으로 돌아올 때 「오늘 아직 안 물었으면」 한 번만 서버에 묻는다.
 * 설계: mydocs/plans/2026-11-04-ui-metrics.md
 */
export function UiMetrics({ userId }: { userId: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const { active: touring } = useOnboarding()
  const [target, setTarget] = useState<string | null>(null)
  const checking = useRef(false)

  useEffect(() => {
    noteUiPath(pathname)
  }, [pathname])

  useEffect(() => {
    if (!uiMetricsEnabled) return
    const onHide = () => flushUiEvents(true)
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onHide)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onHide)
    }
  }, [])

  // 처음 한 번 안내. 자동화 브라우저에서는 다른 시험의 클릭을 가리지 않게 띄우지 않는다
  useEffect(() => {
    if (!uiMetricsEnabled || touring || navigator.webdriver || readLocal(NOTICE_KEY)) return
    writeLocal(NOTICE_KEY, "1")
    toast(UI_METRICS_NOTICE.title, {
      description: UI_METRICS_NOTICE.summary,
      duration: 15_000,
      action: { label: "자세히", onClick: () => router.push("/settings") },
    })
  }, [touring, router])

  useEffect(() => {
    if (!uiMetricsEnabled || touring) return
    const key = surveyCheckedKey(userId)
    async function check() {
      if (checking.current || document.visibilityState !== "visible") return
      const today = kstDayKey(new Date())
      if (readLocal(key) === today) return
      checking.current = true
      try {
        const res = await fetch(apiUrl("/api/ui-metrics/survey")).catch(() => null)
        if (!res?.ok) return
        const { sha } = (await res.json()) as { sha: string | null }
        if (sha && (document.querySelector("[data-app-nudge]") || isWriting())) return // 다음에 돌아올 때 다시 본다
        writeLocal(key, today)
        if (sha) setTarget(sha)
      } finally {
        checking.current = false
      }
    }
    const timer = setTimeout(() => void check(), SURVEY_DELAY_MS)
    const onReturn = () => void check()
    document.addEventListener("visibilitychange", onReturn)
    window.addEventListener("focus", onReturn)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onReturn)
      window.removeEventListener("focus", onReturn)
    }
  }, [touring, userId])

  return target ? <UiSurveyDialog sha={target} onDone={() => setTarget(null)} /> : null
}

const SCORES = [1, 2, 3, 4, 5] as const

function UiSurveyDialog({ sha, onDone }: { sha: string; onDone: () => void }) {
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState("")

  function finish(answer: { score: number | null; comment?: string }) {
    void fetch(apiUrl("/api/ui-metrics/survey"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha, ...answer }),
      keepalive: true,
    }).catch(() => {})
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && finish({ score: null })}>
      <DialogContent className="max-w-sm gap-4" data-ui-survey>
        <DialogHeader>
          <DialogTitle>이번 변경 후 하던 일이 더 쉬워졌나요?</DialogTitle>
          <DialogDescription>배포마다 한 번만 묻습니다. 닫아도 됩니다. 개인 평가에 쓰지 않습니다.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="점수" className="flex flex-col gap-1.5">
          <div className="grid grid-cols-5 gap-1.5">
            {SCORES.map((n) => (
              <Button
                key={n}
                type="button"
                role="radio"
                aria-checked={score === n}
                variant={score === n ? "default" : "outline"}
                className="touch-target"
                onClick={() => setScore(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <div className="flex justify-between text-[12px] text-muted-foreground">
            <span>더 어려워졌다</span>
            <span>더 쉬워졌다</span>
          </div>
        </div>
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={SURVEY_COMMENT_MAX}
          placeholder="한 줄 의견 (선택)"
          aria-label="한 줄 의견"
          className="touch-target"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="touch-target" onClick={() => finish({ score: null })}>
            닫기
          </Button>
          <Button
            type="button"
            className="touch-target"
            disabled={score === null}
            onClick={() => finish({ score, comment: comment.trim() || undefined })}
          >
            보내기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
