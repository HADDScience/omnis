"use client"

import Link from "next/link"
import type { ReactNode } from "react"

interface BorderBeamButtonProps {
  href: string
  children: ReactNode
  variant?: "primary" | "outline"
}

export function BorderBeamButton({ href, children, variant = "outline" }: BorderBeamButtonProps) {
  const isPrimary = variant === "primary"
  return (
    <Link
      href={href}
      className={[
        "group relative inline-flex items-center gap-1.5 overflow-hidden rounded-md px-4 py-2 text-[13px] font-medium transition-colors",
        isPrimary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border bg-card text-foreground hover:border-border-strong",
      ].join(" ")}
    >
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
      <span className="beam" aria-hidden />
      <style jsx>{`
        .beam {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: conic-gradient(
            from 0deg,
            transparent 0deg,
            oklch(0.95 0.1 265 / 0.9) 30deg,
            transparent 60deg
          );
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          animation: beam-rotate 3s linear infinite;
        }
        @keyframes beam-rotate {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .beam { animation: none; }
        }
      `}</style>
    </Link>
  )
}
