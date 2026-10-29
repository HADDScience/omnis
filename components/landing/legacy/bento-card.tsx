"use client"

import type { ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"

interface BentoCardProps {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"]
  title: string
  description: string
  className?: string
  beam?: boolean
  children?: ReactNode
}

export function BentoCard({ icon, title, description, className, beam, children }: BentoCardProps) {
  return (
    <div
      className={[
        "group relative overflow-hidden rounded-xl border bg-card p-5 transition-shadow hover:shadow-lg",
        className ?? "",
      ].join(" ")}
    >
      {beam && (
        <div className="pointer-events-none absolute inset-0">
          <span className="bento-beam" />
          <style jsx>{`
            .bento-beam {
              position: absolute;
              inset: -1px;
              border-radius: inherit;
              padding: 1px;
              background: conic-gradient(
                from 0deg,
                transparent 0deg,
                color-mix(in oklch, var(--primary) 90%, transparent) 30deg,
                transparent 60deg
              );
              animation: beam-rotate 4s linear infinite;
              -webkit-mask:
                linear-gradient(#000 0 0) content-box,
                linear-gradient(#000 0 0);
              mask:
                linear-gradient(#000 0 0) content-box,
                linear-gradient(#000 0 0);
              -webkit-mask-composite: xor;
              mask-composite: exclude;
              opacity: 0;
              transition: opacity 300ms;
            }
            .group:hover .bento-beam { opacity: 1; }
            @keyframes beam-rotate {
              to { transform: rotate(360deg); }
            }
            @media (prefers-reduced-motion: reduce) {
              .bento-beam { animation: none; }
            }
          `}</style>
        </div>
      )}
      <div className="relative">
        <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <HugeiconsIcon icon={icon} size={14} />
        </div>
        <h3 className="mb-1.5 text-[15px] font-semibold">{title}</h3>
        <p className="mb-3 text-[12.5px] leading-[1.55] text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  )
}
