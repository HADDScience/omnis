"use client"

import type { ReactNode } from "react"

export function AuroraText({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="aurora-text">{children}</span>
      <style jsx>{`
        .aurora-text {
          background: linear-gradient(
            120deg,
            oklch(0.72 0.18 265),
            oklch(0.78 0.2 320),
            oklch(0.82 0.18 220),
            oklch(0.72 0.18 265)
          );
          background-size: 300% 300%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: aurora 8s ease-in-out infinite;
          display: inline-block;
        }
        @keyframes aurora {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aurora-text { animation: none; }
        }
      `}</style>
    </>
  )
}
