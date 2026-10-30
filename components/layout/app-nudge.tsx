"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download04Icon, Notification03Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OmnisMark } from "@/components/brand/omnis-mark"
import { InstallGuideDialog } from "@/components/layout/install-app-card"
import { useOnboarding } from "@/components/onboarding/onboarding-provider"
import { apiUrl } from "@/lib/base-path"
import { decideNudge, nudgeLaterKey, nudgeOffKey, type NudgeStage } from "@/lib/app-nudge"
import {
  currentSubscription,
  getInstallPrompt,
  isIos,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
  pushSupported,
  subscribeToPush,
} from "@/lib/pwa"

/** 첫 화면이 다 그려진 뒤에 띄운다 — 화면이 뜨자마자 가리지 않게 */
const SHOW_DELAY_MS = 1200

function readFlag(storage: () => Storage, key: string): boolean {
  try {
    return storage().getItem(key) === "1"
  } catch {
    return false
  }
}

function writeFlag(storage: () => Storage, key: string) {
  try {
    storage().setItem(key, "1")
  } catch {
    // 저장하지 못하면 다음 접속에 다시 뜬다 — 그 이상 할 수 있는 일이 없다
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

/**
 * 앱 설치 · 기기 알림 권유(2026-10-30 작업지시자). 규칙은 lib/app-nudge.ts decideNudge.
 *
 * 브라우저 탭으로 열면 설치를, 홈 화면 아이콘으로 열면(설치 뒤) 알림을 권한다. 「더 이상 안 보기」 를 누를 때까지
 * 접속할 때마다 한 번 뜬다. 「다음에」 · 바깥 누르기 · Esc 는 이번 접속에만 닫는다.
 * 사용 안내(온보딩)가 도는 동안은 띄우지 않는다 — 안내가 끝난 뒤 다음 화면에서 뜬다.
 */
export function AppNudge() {
  const { active: touring } = useOnboarding()
  const [stage, setStage] = useState<NudgeStage | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    if (touring) return
    let alive = true
    const timer = setTimeout(async () => {
      const standalone = isStandalone()
      // 서버 · 구독 상태는 알림 권유를 판단할 때만 묻는다 — 탭에서는 설치 권유가 먼저다
      let server: { configured: boolean; publicKey: string | null } | null = null
      let subscribed = false
      if (standalone && pushSupported()) {
        server = await fetch(apiUrl("/api/push/subscriptions"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        subscribed = (await currentSubscription().catch(() => null)) !== null
      }
      if (!alive) return
      setPublicKey(server?.publicKey ?? null)
      setStage(
        decideNudge({
          standalone,
          off: { install: readFlag(local, nudgeOffKey("install")), push: readFlag(local, nudgeOffKey("push")) },
          later: { install: readFlag(session, nudgeLaterKey("install")), push: readFlag(session, nudgeLaterKey("push")) },
          pushSupported: pushSupported(),
          pushConfigured: !!server?.configured && !!server.publicKey,
          permission: typeof Notification !== "undefined" ? Notification.permission : null,
          subscribed,
          automated: navigator.webdriver === true,
        }),
      )
    }, SHOW_DELAY_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [touring])

  function later() {
    if (stage) writeFlag(session, nudgeLaterKey(stage))
    setStage(null)
  }

  function never() {
    if (stage) writeFlag(local, nudgeOffKey(stage))
    setStage(null)
  }

  return (
    <>
      <Dialog open={stage !== null} onOpenChange={(open) => !open && later()}>
        <DialogContent className="max-w-sm gap-5" data-app-nudge={stage ?? undefined}>
          {stage === "install" && (
            <InstallNudge
              onGuide={() => {
                later()
                setGuideOpen(true)
              }}
              onInstalled={() => setStage(null)}
            />
          )}
          {stage === "push" && publicKey && <PushNudge publicKey={publicKey} onDone={() => setStage(null)} />}
          <div className="-mt-1 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="touch-target text-muted-foreground" onClick={never}>
              더 이상 안 보기
            </Button>
            <Button variant="outline" size="sm" className="touch-target" onClick={later}>
              다음에
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <InstallGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}

function InstallNudge({ onGuide, onInstalled }: { onGuide: () => void; onInstalled: () => void }) {
  const [installable, setInstallable] = useState(false)
  const [ios, setIos] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setIos(isIos())
    setInstallable(getInstallPrompt() !== null)
    return onInstallPromptChange(() => setInstallable(getInstallPrompt() !== null))
  }, [])

  async function install() {
    setBusy(true)
    const accepted = await promptInstall()
    setBusy(false)
    if (accepted) {
      toast.success("설치했습니다. 홈 화면의 Omnis 아이콘으로 열어 주세요.")
      onInstalled()
      return
    }
    setInstallable(getInstallPrompt() !== null)
  }

  return (
    <>
      <DialogHeader className="items-center text-center">
        <OmnisMark className="mb-1 size-14 rounded-[14px] shadow-sm" />
        <DialogTitle>Omnis 를 앱으로 설치하세요</DialogTitle>
        <DialogDescription>
          홈 화면에 추가하면 주소창 없이 앱처럼 열리고, 업무 지시 · 채팅 소식을 기기 알림으로 받을 수 있어요.
          {ios && " 아이폰은 설치해야 알림을 받을 수 있어요."}
        </DialogDescription>
      </DialogHeader>
      {installable ? (
        <Button className="touch-target h-11 w-full" onClick={install} disabled={busy}>
          {busy ? <Spinner /> : <HugeiconsIcon icon={Download04Icon} size={16} aria-hidden />}
          바로 설치
        </Button>
      ) : (
        <Button className="touch-target h-11 w-full" onClick={onGuide}>
          <HugeiconsIcon icon={SmartPhone01Icon} size={16} aria-hidden />
          설치 방법 보기
        </Button>
      )}
    </>
  )
}

function PushNudge({ publicKey, onDone }: { publicKey: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)

  async function turnOn() {
    setBusy(true)
    const result = await subscribeToPush(publicKey)
    setBusy(false)
    if (result.ok) {
      toast.success("이 기기로 알림을 보냅니다. 받을 알림 종류는 설정 › 기기 알림에서 고를 수 있어요.")
      onDone()
      return
    }
    if (result.reason === "denied") {
      // 막으면 화면에서 다시 물을 수 없다 — 다음 접속부터 권유도 뜨지 않는다(decideNudge)
      toast.error("알림이 차단됐습니다. 켜려면 기기 설정에서 Omnis 알림을 허용으로 바꿔 주세요.")
      onDone()
      return
    }
    toast.error("알림을 켜지 못했습니다. 설정 › 기기 알림에서 다시 시도해 주세요.")
  }

  return (
    <>
      <DialogHeader className="items-center text-center">
        <span aria-hidden className="mb-1 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <HugeiconsIcon icon={Notification03Icon} size={28} />
        </span>
        <DialogTitle>알림을 켜 두세요</DialogTitle>
        <DialogDescription>
          Omnis 를 닫아 두어도 업무 지시 · 채팅 · 일정 소식을 이 기기 알림으로 받아요.
        </DialogDescription>
      </DialogHeader>
      <Button className="touch-target h-11 w-full" onClick={turnOn} disabled={busy}>
        {busy ? <Spinner /> : <HugeiconsIcon icon={Notification03Icon} size={16} aria-hidden />}
        알림 켜기
      </Button>
    </>
  )
}
