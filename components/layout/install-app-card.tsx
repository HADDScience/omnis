"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AndroidIcon,
  AppleIcon,
  ArrowRight01Icon,
  Download04Icon,
  LinkSquare02Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
  detectInstalled,
  getInstallPrompt,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
} from "@/lib/pwa"
import { detectBrowser, handoffUrl, type BrowserEnv, type Handoff } from "@/lib/install-handoff"

/**
 * 마이 화면 메뉴의 「앱 설치」 줄(2026-11-06, 검색 줄 자리). 누르면 설치 안내가 열린다.
 *
 * 홈 화면 아이콘으로 열었으면(standalone) 「설치됨」 이다. 1단계 버튼으로 넘어온 브라우저(`?install=continue`)는
 * 어느 화면이든 AppNudge 가 2단계를 이어서 띄운다.
 */
export function InstallAppRow() {
  const [installed, setInstalled] = useState<"standalone" | "elsewhere" | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // 기기 판정은 브라우저에서만 가능하다 — 서버 렌더와 어긋나지 않게 마운트 뒤에 채운다
    if (isStandalone()) {
      setInstalled("standalone")
      return
    }
    void detectInstalled().then((yes) => yes && setInstalled("elsewhere"))
  }, [])

  const standalone = installed === "standalone"
  return (
    <li>
      <button
        type="button"
        data-install-row
        disabled={standalone}
        onClick={() => setOpen(true)}
        className="relative flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:hover:bg-transparent"
      >
        <HugeiconsIcon icon={SmartPhone01Icon} size={16} className="text-muted-foreground" aria-hidden />
        <span className="flex-1">앱 설치</span>
        {installed ? (
          <span data-install-state className="text-[11.5px] text-muted-foreground">
            {standalone ? "설치됨" : "이 기기에 설치됨"}
          </span>
        ) : (
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="text-muted-foreground" aria-hidden />
        )}
      </button>
      <InstallGuideDialog
        open={open}
        onOpenChange={setOpen}
        onInstalled={() => setInstalled("elsewhere")}
      />
    </li>
  )
}

const TARGET_LABEL = { safari: "Safari", chrome: "Chrome" } as const

/**
 * 설치 방법 대화상자 — 마이 화면 「앱 설치」 줄과 첫 화면 권유(app-nudge.tsx)가 같이 연다.
 *
 * 1단계 · 설치가 되는 브라우저로 열기 — 인앱 브라우저 등이면 버튼 한 번으로 Safari(iOS) · Chrome(Android)에서
 *   같은 페이지를 연다(lib/install-handoff.ts). 이미 그 브라우저이거나 PC 면 건너뛴다.
 * 2단계 · 홈 화면에 추가 — 브라우저가 설치 이벤트를 줬으면 **바로 설치**, 아니면 기기별 순서(iOS 는 이것이 유일한 길이다).
 */
export function InstallGuideDialog({
  open,
  onOpenChange,
  onInstalled,
  continued = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled?: () => void
  /** 1단계 버튼으로 넘어온 브라우저에서 열렸다 — 2단계부터 보인다 */
  continued?: boolean
}) {
  const [env, setEnv] = useState<BrowserEnv | null>(null)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [installable, setInstallable] = useState(false)

  useEffect(() => {
    const found = detectBrowser(navigator.userAgent, navigator.maxTouchPoints)
    setEnv(found)
    setHandoff(handoffUrl(window.location.href, found))
    setInstallable(getInstallPrompt() !== null)
    return onInstallPromptChange(() => setInstallable(getInstallPrompt() !== null))
  }, [])

  async function install() {
    const accepted = await promptInstall()
    if (accepted) {
      toast.success("설치했습니다. 홈 화면의 Omnis 아이콘으로 열어 주세요.")
      onOpenChange(false)
      onInstalled?.()
    }
    setInstallable(getInstallPrompt() !== null)
  }

  const ios = env?.os === "ios"
  // 넘어온 뒤에도 아직 설치되는 브라우저가 아니면(스킴이 다른 브라우저를 열었다) 1단계를 다시 보인다
  const showStep1 = handoff !== null && !(continued && env?.canInstallHere)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-install-guide className="max-h-[calc(var(--app-vh,100dvh)-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Omnis 앱 설치</DialogTitle>
          <DialogDescription>
            {continued && !showStep1
              ? "이어서 홈 화면에 추가하면 끝입니다."
              : "휴대폰 홈 화면에 Omnis 아이콘을 만들어 앱처럼 씁니다."}
          </DialogDescription>
        </DialogHeader>

        {showStep1 && handoff && (
          <section data-install-step="1" className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <StepTitle n={1}>{TARGET_LABEL[handoff.target]}에서 열기</StepTitle>
            <p className="text-sm text-muted-foreground">
              {env?.inApp ? "앱 안의 브라우저에서는 홈 화면에 추가할 수 없습니다. " : ""}
              버튼을 누르면 {TARGET_LABEL[handoff.target]}에서 이 페이지가 열리고, 다음 단계가 이어서 뜹니다.
            </p>
            {/* 스킴 이동은 누름에서 바로 해야 한다(비동기 뒤에 부르면 막힌다는 보고) — 그래서 링크다 */}
            <a href={handoff.href} data-install-handoff={handoff.target} className={cn(buttonVariants(), "touch-target h-10 w-full")}>
              <HugeiconsIcon icon={LinkSquare02Icon} size={15} aria-hidden />
              {TARGET_LABEL[handoff.target]}에서 열기
            </a>
            <p className="text-xs text-muted-foreground">
              안 열리면 오른쪽 위 메뉴의 「다른 브라우저로 열기」 를 누릅니다.
            </p>
          </section>
        )}

        <section data-install-step="2" className="flex flex-col gap-2">
          <StepTitle n={showStep1 ? 2 : null}>홈 화면에 추가</StepTitle>
          {installable && (
            <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm">이 브라우저에서는 버튼 하나로 바로 설치됩니다.</p>
              <Button className="touch-target h-10 w-full" onClick={install}>
                <HugeiconsIcon icon={Download04Icon} size={15} aria-hidden />
                바로 설치
              </Button>
            </div>
          )}

          <Tabs key={ios ? "ios" : "android"} defaultValue={ios ? "ios" : "android"}>
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
        </section>

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
  )
}

function StepTitle({ n, children }: { n: number | null; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      {n !== null && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">{n}단계</span>}
      {children}
    </h3>
  )
}

/** 안드로이드 탭. 다른 탭과 보여주는 순서가 달라 따로 둔다 (ux-rules 25). Chrome 에서 여는 것은 1단계다 */
function AndroidSteps() {
  return (
    <ol className="flex flex-col gap-3 pt-2 text-sm">
      <GuideStep n={1}>
        Chrome 오른쪽 위 더보기 <MoreVerticalGlyph /> 를 누릅니다.
      </GuideStep>
      <GuideStep n={2}>
        <b>&ldquo;홈 화면에 추가&rdquo;</b> 또는 <b>&ldquo;앱 설치&rdquo;</b> 를 누릅니다.
      </GuideStep>
      <GuideStep n={3}>
        <b>&ldquo;설치&rdquo;</b> 를 누릅니다.
      </GuideStep>
      <p className="text-xs text-muted-foreground">
        삼성 인터넷은 아래 메뉴 <MenuGlyph /> › 현재 페이지 추가 › 홈 화면 입니다.
      </p>
    </ol>
  )
}

/** iPhone 탭. iOS 는 설치를 코드로 띄울 수 없어 이 순서가 유일한 길이다. Safari 에서 여는 것은 1단계다 */
function IosSteps() {
  return (
    <ol className="flex flex-col gap-3 pt-2 text-sm">
      <GuideStep n={1}>
        Safari 주소창 옆 더보기 <MoreHorizontalGlyph /> 를 누른 뒤 공유 <ShareGlyph /> 를 누릅니다.
        <span className="block text-xs text-muted-foreground">
          화면 아래에 공유 <ShareGlyph /> 가 바로 보이면 그것을 누릅니다.
        </span>
      </GuideStep>
      <GuideStep n={2}>
        목록을 내려 <b>&ldquo;홈 화면에 추가&rdquo;</b> <AddSquareGlyph /> 를 누릅니다.
        <span className="block text-xs text-muted-foreground">
          안 보이면 더 보기 <MoreHorizontalGlyph /> 를 눌러 찾습니다.
        </span>
      </GuideStep>
      <GuideStep n={3}>
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
