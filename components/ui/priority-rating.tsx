"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { StarIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

const LEVELS = ["LOW", "NORMAL", "HIGH"] as const

interface PriorityRatingProps {
  value: string
  onChange?: (value: string) => void
  size?: number
  disabled?: boolean
  className?: string
}

export function PriorityRating({
  value,
  onChange,
  size = 16,
  disabled = false,
  className,
}: PriorityRatingProps) {
  const level = LEVELS.indexOf(value as (typeof LEVELS)[number])
  const filled = level === -1 ? 2 : level + 1

  return (
    <div className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled || !onChange}
          onClick={() => onChange?.(LEVELS[star - 1])}
          className={cn(
            "transition-colors",
            onChange && !disabled
              ? "cursor-pointer hover:scale-110 active:scale-95"
              : "cursor-default",
            star <= filled
              ? "text-amber-500 dark:text-amber-400"
              : "text-muted-foreground/30"
          )}
        >
          <HugeiconsIcon
            icon={StarIcon}
            size={size}
            fill={star <= filled ? "currentColor" : "none"}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  )
}
