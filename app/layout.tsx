import type { Metadata } from "next"
import { JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DemoBanner } from "@/components/layout/demo-banner"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Omnis — HADD Science",
  description: "HADD Science 채팅 기반 업무 관리 시스템",
}

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans")}
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
          <div className="flex min-h-screen flex-col">
            <DemoBanner />
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
