"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { useShortcut } from "@/hooks/use-shortcuts"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()
  useShortcut("toggleTheme", () => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
  return null
}

export { ThemeProvider }
