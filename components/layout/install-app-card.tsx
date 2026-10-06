"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AndroidIcon,
  AppleIcon,
  Cancel01Icon,
  Download04Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OmnisMark } from "@/components/brand/omnis-mark"
import {
  getInstallPrompt,
  isIos,
  isStandalone,
  onInstallPromptChange,
} from "@/lib/pwa"

const DISMISS_KEY = "omnis:install-card-dismissed"

/**
 * 사이드바 아래의 앱 설치 안내.
 *
 * 브라우저가 설치 이벤트(`beforeinstallprompt`)를 줬으면 **바로 설치** 버튼이 뜬다 —
 * 안드로이드 크롬·PC 크롬/엣지가 여기 해당한다. iOS 는 그 이벤트가 없어 코드로 설치를 띄울
 * 수 없으므로(lib/pwa.ts) 사람이 따라 할 순서를 그림과 함께 보인다.
 *
 * 홈 화면 아이콘으로 열린 상태면 이미 설치한 것이라 그리지 않는다. 닫으면 이 브라우저에서는
 * 다시 뜨지 않는다 — 설정 › 기기 알림 1단계에서 같은 설치를 할 수 있다.
 */
export function InstallAppCard() {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [ios, setIos] = useState(false)
  const [installable, setInstallable] = useState(false)

  useEffect(() => {
    // 기기 판정은 브라우저에서만 가능하다 — 서버 렌더와 어긋나지 않게 마운트 뒤에 채운다.
    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1"
    } catch {}
    setVisible(!isStandalone() && !dismissed)
    setIos(isIos())
    setInstallable(getInstallPrompt() !== null)
    return onInstallPromptChange(() => setInstallable(getInstallPrompt() !== null))
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1")
    } catch {}
    setVisible(false)
  }

  async function install() {
    const prompt = getInstallPrompt()
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === "accepted") {
      toast.success("설치했습니다. 홈 화면의 Omnis 아이콘으로 열어 주세요.")
      setVisible(false)
      setOpen(false)
    }
    setInstallable(getInstallPrompt() !== null)
  }

  if (!visible) return null

  return (
    <>
      <div className="relative mx-2 mb-2 mt-auto rounded-lg border border-border bg-muted/40 p-3">
        <button
          type="button"
          onClick={dismiss}
          aria-label="앱 설치 안내 닫기"
          className="touch-target absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
        </button>
        <div className="pr-6 text-[12.5px] font-semibold">Omnis 앱 설치</div>
        <p className="mt-1 text-[11.5px] leading-[1.45] text-muted-foreground">
          홈 화면에 추가하면 주소창 없이 앱처럼 열리고, 휴대폰으로 업무 알림을 받을 수 있습니다.
        </p>
        <Button
          size="sm"
          className="touch-target mt-2.5 h-8 w-full text-[12px]"
          onClick={() => setOpen(true)}
        >
          <HugeiconsIcon icon={SmartPhone01Icon} size={14} aria-hidden />
          설치 방법 보기
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(var(--app-vh,100dvh)-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Omnis 앱 설치</DialogTitle>
            <DialogDescription>
              휴대폰 홈 화면에 Omnis 아이콘을 만들어 앱처럼 씁니다.
            </DialogDescription>
          </DialogHeader>

          {installable && (
            <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm">이 브라우저에서는 버튼 하나로 바로 설치됩니다.</p>
              <Button className="touch-target h-10 w-full" onClick={install}>
                <HugeiconsIcon icon={Download04Icon} size={15} aria-hidden />
                바로 설치
              </Button>
            </div>
          )}

          <Tabs defaultValue={ios ? "ios" : "android"}>
            <TabsList className="w-full">
              <TabsTrigger value="android" className="touch-target">
                <HugeiconsIcon icon={AndroidIcon} size={14} aria-hidden />
                Android
              </TabsTrigger>
              <TabsTrigger value="ios" className="touch-target">
                <HugeiconsIcon icon={AppleIcon} size={14} aria-hidden />
                iPhone
              </TabsTrigger>
            </TabsList>
            <TabsContent value="android">
              <AndroidSteps />
            </TabsContent>
            <TabsContent value="ios">
              <IosSteps />
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <OmnisMark className="size-12 rounded-[12px] shadow-sm" />
              <span className="text-[10.5px]">Omnis</span>
            </div>
            <p className="text-sm">
              홈 화면에 이 아이콘이 생겼는지 확인해 주세요. 앞으로는 이 아이콘을 눌러 Omnis 를 엽니다.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 안드로이드 탭. 다른 탭과 보여주는 순서가 달라 따로 둔다 (ux-rules 25). */
function AndroidSteps() {
  return (
    <ol className="flex flex-col gap-3 pt-2 text-sm">
      <GuideStep n={1}>
        <b>크롬</b>으로 이 페이지를 엽니다.
      </GuideStep>
      <GuideStep n={2}>
        오른쪽 위 더보기 <MoreVerticalGlyph /> 를 누릅니다.
      </GuideStep>
      <GuideStep n={3}>
        <b>&ldquo;홈 화면에 추가&rdquo;</b> 또는 <b>&ldquo;앱 설치&rdquo;</b> 를 누릅니다.
      </GuideStep>
      <GuideStep n={4}>
        <b>&ldquo;설치&rdquo;</b> 를 누릅니다.
      </GuideStep>
      <p className="text-xs text-muted-foreground">
        삼성 인터넷은 아래 메뉴 <MenuGlyph /> › 현재 페이지 추가 › 홈 화면 입니다.
      </p>
    </ol>
  )
}

/** iPhone 탭. iOS 는 설치를 코드로 띄울 수 없어 이 순서가 유일한 길이다. */
function IosSteps() {
  return (
    <ol className="flex flex-col gap-3 pt-2 text-sm">
      <GuideStep n={1}>
        <b>사파리</b>로 이 페이지를 엽니다.
      </GuideStep>
      <GuideStep n={2}>
        주소창 옆 더보기 <MoreHorizontalGlyph /> 를 누른 뒤 공유 <ShareGlyph /> 를 누릅니다.
        <span className="block text-xs text-muted-foreground">
          화면 아래에 공유 <ShareGlyph /> 가 바로 보이면 그것을 누릅니다.
        </span>
      </GuideStep>
      <GuideStep n={3}>
        목록을 내려 <b>&ldquo;홈 화면에 추가&rdquo;</b> <AddSquareGlyph /> 를 누릅니다.
        <span className="block text-xs text-muted-foreground">
          안 보이면 더 보기 <MoreHorizontalGlyph /> 를 눌러 찾습니다.
        </span>
      </GuideStep>
      <GuideStep n={4}>
        오른쪽 위 <b>&ldquo;추가&rdquo;</b> 를 누릅니다.
      </GuideStep>
    </ol>
  )
}

function GuideStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
        aria-hidden
      >
        {n}
      </span>
      <span className="min-w-0 pt-0.5 leading-[1.6]">{children}</span>
    </li>
  )
}

/*
 * 아래 글리프는 화면에서 **찾아야 하는 모양**이라 이름 대신 그림으로 보인다.
 * 글자 사이에 끼므로 한 줄 높이에 맞춘 작은 테두리 칩으로 감싼다.
 */
function Glyph({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="mx-0.5 inline-flex size-[22px] items-center justify-center rounded-md border border-border bg-background align-[-6px] text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </span>
  )
}

/** iOS 공유 버튼 — 네모에서 위로 나가는 화살표. */
function ShareGlyph() {
  return (
    <Glyph label="공유 버튼">
      <path d="M12 3v11" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17" />
    </Glyph>
  )
}

/** iOS 더보기 — 가로 점 세 개. */
function MoreHorizontalGlyph() {
  return (
    <Glyph label="더보기 버튼">
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** 크롬 더보기 — 세로 점 세 개. */
function MoreVerticalGlyph() {
  return (
    <Glyph label="더보기 버튼">
      <circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** iOS 「홈 화면에 추가」 — 둥근 네모 안의 더하기. */
function AddSquareGlyph() {
  return (
    <Glyph label="홈 화면에 추가 아이콘">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Glyph>
  )
}

/** 삼성 인터넷 메뉴 — 가로줄 세 개. */
function MenuGlyph() {
  return (
    <Glyph label="메뉴 버튼">
      <path d="M5 7h14M5 12h14M5 17h14" />
    </Glyph>
  )
}
