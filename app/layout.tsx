import type { Metadata, Viewport } from "next"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DemoBanner } from "@/components/layout/demo-banner"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Omnis — HADD Science",
  description: "HADD Science 채팅 기반 업무 관리 시스템",
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
