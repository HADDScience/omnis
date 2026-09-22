import type { Metadata, Viewport } from "next"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DemoBanner } from "@/components/layout/demo-banner"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Omnis — HADD Science",
  description: "HADD Science 채팅 기반 업무 관리 시스템",
  /*
   * 홈 화면에 추가했을 때의 이름과 상태표시줄. 아이콘 아래에 긴 제목("Omnis — HADD Science")
   * 대신 "Omnis" 가 뜬다. 주소 표시줄 없이 뜨는 것은 manifest 의 display: standalone 이 맡는다
   * (iOS 는 16.4 부터 manifest 를 본다 — 푸시가 되는 버전과 같다).
   */
  appleWebApp: { capable: true, title: "Omnis", statusBarStyle: "default" },
}

/**
 * viewportFit: "cover" — 폴더블·노치 기기에서 safe-area-inset-* 값을 받기 위해 필요.
 * maximumScale 은 지정하지 않는다 (사용자 확대 차단은 a11y 위반, 규칙 26).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={cn("antialiased", "font-sans")}
    >
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {/*
          설치 이벤트는 페이지가 뜰 때 한 번 오고, 그때 잡지 않으면 사라진다. 설정 화면은
          그 뒤에 열리므로 React 안에서 듣기 시작하면 이미 늦다 — 하이드레이션보다 먼저 도는
          이 스크립트가 잡아 두고, lib/pwa.ts 가 꺼내 쓴다.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__omnisInstallPrompt=e})",
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <div className="flex min-h-[var(--app-vh)] flex-col">
            <DemoBanner />
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </div>
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
