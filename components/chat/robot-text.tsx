import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatSparkIcon } from "@hugeicons/core-free-icons"
import { hasRobotMark, stripRobotMark } from "@/lib/robot-mark"
import { cn } from "@/lib/utils"

/**
 * 옴니스 아이콘 — 글 줄 안에 글자 높이로. 옴니스 방의 옴니스 얼굴(omnis-room.tsx OmnisAvatar)과 같은 그림.
 * 글 앞의 🤖 표식 대신 그린다(lib/robot-mark.ts). 스크린리더에는 「옴니스」 로 읽힌다.
 */
export function OmnisInlineIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={BubbleChatSparkIcon}
      aria-label="옴니스"
      role="img"
      data-omnis-inline-icon
      className={cn("mr-[0.3em] inline-block size-[1.15em] shrink-0 align-[-0.2em] text-primary", className)}
    />
  )
}

/** 맨 앞에 🤖 가 있으면 떼고 옴니스 아이콘을 앞에 둔다. 없으면 글 그대로 */
export function RobotText({ text, iconClassName }: { text: string; iconClassName?: string }) {
  if (!hasRobotMark(text)) return <>{text}</>
  return (
    <>
      <OmnisInlineIcon className={iconClassName} />
      {stripRobotMark(text)}
    </>
  )
}
