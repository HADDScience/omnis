"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type PillVariant = "filled" | "ghost" | "danger"

export interface PillFieldProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  variant?: PillVariant
  icon?: React.ReactNode
  label: string
  value?: React.ReactNode
}

const variantClasses: Record<PillVariant, string> = {
  filled: "border bg-card text-foreground hover:border-border-strong",
  ghost:
    "border border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/70",
  danger: "border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive/50",
}

export const PillField = React.forwardRef<HTMLButtonElement, PillFieldProps>(
  ({ variant = "filled", icon, label, value, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          variantClasses[variant],
          className,
        )}
        {...props}
      >
        {icon ? <span className="inline-flex shrink-0 items-center opacity-80">{icon}</span> : null}
        <span className="shrink-0 text-muted-foreground">{label}</span>
        {value !== undefined && value !== null && value !== "" ? (
          <span className="truncate font-medium">{value}</span>
        ) : (
          <span className="text-muted-foreground/70">—</span>
        )}
      </button>
    )
  },
)
PillField.displayName = "PillField"
