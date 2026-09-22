"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { apiUrl } from "@/lib/base-path"
import {
  currentSubscription,
  getInstallPrompt,
  isIos,
  isStandalone,
  onInstallPromptChange,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pwa"

interface ServerState {
  configured: boolean
  publicKey: string | null
  deviceCount: number
}

/**
 * 기기 알림 — 탭을 닫아도 알림이 오게 하는 자리.
 *
 * 설치와 권한을 **두 단계로 갈라 놓은 이유**는 iOS 때문이다. iOS 는 홈 화면에 추가한
 * PWA 안에서만 푸시를 주고(16.4+), 탭에는 `Notification` 이 아예 없다. 게다가 iOS 에는
 * `beforeinstallprompt` 가 없어 설치를 코드로 띄울 수 없다 — 사람이 공유 시트를 직접 연다.
 * 그래서 "알림 켜기" 한 버튼으로는 아이폰 사용자를 끝까지 데려갈 수 없다.
 *
 * 안드로이드·PC 는 탭에서도 푸시가 오므로 1단계는 권장일 뿐이다. 그 차이를 문구로 말한다.
 */
export function PushNotifications() {
  const [ready, setReady] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [ios, setIos] = useState(false)
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [installable, setInstallable] = useState(false)
  const [server, setServer] = useState<ServerState | null>(null)
  const [busy, setBusy] = useState<"subscribe" | "unsubscribe" | "test" | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)

  const loadServer = useCallback(() => {
    fetch(apiUrl("/api/push/subscriptions"))
      .then((r) => (r.ok ? r.json() : null))
      .then(setServer)
      .catch(() => setServer(null))
  }, [])

  useEffect(() => {
    // 기기 판정은 브라우저에서만 가능하다 — 서버 렌더와 어긋나지 않게 마운트 뒤에 채운다.
    setStandalone(isStandalone())
    setIos(isIos())
    setSupported(pushSupported())
    setPermission(typeof Notification !== "undefined" ? Notification.permission : null)
    setInstallable(getInstallPrompt() !== null)
    void currentSubscription().then((s) => setSubscribed(s !== null))
    loadServer()
    setReady(true)

    return onInstallPromptChange(() => setInstallable(getInstallPrompt() !== null))
  }, [loadServer])

  async function install() {
    const prompt = getInstallPrompt()
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === "accepted") toast.success("홈 화면에 추가했습니다. 그 아이콘으로 열어 주세요.")
    setInstallable(getInstallPrompt() !== null)
  }

  async function turnOn() {
    if (!server?.publicKey) return
    setBusy("subscribe")
    const result = await subscribeToPush(server.publicKey)
    setBusy(null)
    setPermission(typeof Notification !== "undefined" ? Notification.permission : null)

    if (result.ok) {
      setSubscribed(true)
      loadServer()
      toast.success("이 기기로 알림을 보냅니다.")
      return
    }
    if (result.reason === "denied") {
      toast.error("알림이 차단됐습니다. 브라우저의 사이트 설정에서 허용으로 바꿔 주세요.")
      return
    }
    toast.error("알림을 켜지 못했습니다.")
  }

  async function turnOff() {
    setBusy("unsubscribe")
    const ok = await unsubscribeFromPush()
    setBusy(null)
    if (!ok) {
      toast.error("알림을 끄지 못했습니다.")
      return
    }
    setSubscribed(false)
    loadServer()
    toast.success("이 기기에서 알림을 껐습니다.")
  }

  async function sendTest() {
    setBusy("test")
    const res = await fetch(apiUrl("/api/push/test"), { method: "POST" })
    setBusy(null)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "시험 알림을 보내지 못했습니다.")
      return
    }
    toast.success("보냈습니다. 잠시 뒤 기기 알림을 확인해 주세요.")
  }

  if (!ready || server === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기기 알림</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <Skeleton className="h-[72px] w-full rounded-lg" />
          <Skeleton className="h-[72px] w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  // 아이폰은 홈 화면에 추가하기 전에는 알림을 켤 방법이 없다. 그 사실이 화면 문구를 가른다.
  const iosNeedsInstall = ios && !standalone
  const canSubscribe = supported && server.configured && !iosNeedsInstall

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">기기 알림</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Omnis 를 닫아 두어도 업무 지시와 완료 확인이 이 기기의 알림으로 옵니다.
          기기마다 따로 켜야 합니다 — 휴대폰에서 켜도 노트북은 켜지지 않습니다.
        </p>

        {!server.configured && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            서버에 푸시 키가 설정되지 않아 지금은 켤 수 없습니다. 관리자에게 알려 주세요.
          </p>
        )}

        <ol className="flex flex-col gap-2.5">
          <Step
            index={1}
            title="홈 화면에 추가"
            done={standalone}
            description={
              standalone
                ? "홈 화면 아이콘으로 열려 있습니다."
                : ios
                  ? "아이폰은 홈 화면에 추가해야만 알림을 받을 수 있습니다."
                  : "추가해 두면 앱처럼 바로 열립니다. 이 기기에서는 선택 사항입니다."
            }
          >
            {standalone ? null : ios ? (
              <Button
                variant="outline"
                className="touch-target h-11 w-full shrink-0 sm:w-auto"
                onClick={() => setGuideOpen(true)}
              >
                <HugeiconsIcon icon={SmartPhone01Icon} size={15} aria-hidden />
                추가하는 법 보기
              </Button>
            ) : installable ? (
              <Button className="touch-target h-11 w-full shrink-0 sm:w-auto" onClick={install}>
                홈 화면에 추가
              </Button>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">
                브라우저 메뉴의 &ldquo;앱 설치&rdquo;를 쓰세요
              </span>
            )}
          </Step>

          <Step
            index={2}
            title="알림 켜기"
            done={subscribed}
            description={
              !supported
                ? "이 브라우저는 웹 푸시를 지원하지 않습니다."
                : iosNeedsInstall
                  ? "1단계를 먼저 마쳐 주세요."
                  : permission === "denied"
                    ? "브라우저에서 알림이 차단돼 있습니다. 사이트 설정에서 허용으로 바꾼 뒤 다시 눌러 주세요."
                    : subscribed
                      ? `이 기기로 알림이 갑니다. 받는 기기 ${server.deviceCount}대.`
                      : "누르면 브라우저가 알림 권한을 묻습니다."
            }
          >
            {subscribed ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  className="touch-target h-11 flex-1 sm:flex-none"
                  disabled={busy !== null}
                  onClick={sendTest}
                >
                  시험 알림
                </Button>
                <Button
                  variant="ghost"
                  className="touch-target h-11 flex-1 text-destructive hover:text-destructive sm:flex-none"
                  disabled={busy !== null}
                  onClick={turnOff}
                >
                  끄기
                </Button>
              </div>
            ) : (
              <Button
                className="touch-target h-11 w-full shrink-0 sm:w-auto"
                disabled={!canSubscribe || busy !== null}
                onClick={turnOn}
              >
                알림 켜기
              </Button>
            )}
          </Step>
        </ol>
      </CardContent>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>아이폰에서 홈 화면에 추가하기</DialogTitle>
            <DialogDescription>
              사파리에서만 됩니다. 크롬으로 보고 있다면 사파리로 이 주소를 다시 열어 주세요.
            </DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex items-start gap-3">
              <StepDot>1</StepDot>
              <span className="flex flex-wrap items-center gap-1.5">
                화면 아래의 공유 버튼
                <ShareGlyph />을 누릅니다.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <StepDot>2</StepDot>
              <span>목록을 내려 &ldquo;홈 화면에 추가&rdquo;를 누릅니다.</span>
            </li>
            <li className="flex items-start gap-3">
              <StepDot>3</StepDot>
              <span>홈 화면에 생긴 Omnis 아이콘으로 다시 연 뒤, 이 설정에서 2단계를 켭니다.</span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function Step({
  index,
  title,
  description,
  done,
  children,
}: {
  index: number
  title: string
  description: string
  done: boolean
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {done ? (
          <span className="flex size-6 shrink-0 items-center justify-center text-primary">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} aria-hidden />
          </span>
        ) : (
          <StepDot>{index}</StepDot>
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </li>
  )
}

function StepDot({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      aria-hidden
    >
      {children}
    </span>
  )
}

/** iOS 공유 버튼 글리프 — 화면에서 찾아야 하는 모양이라 이름 대신 그림으로 보인다. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block size-5 shrink-0 align-text-bottom text-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="공유 버튼"
    >
      <path d="M12 3v11" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17" />
    </svg>
  )
}
