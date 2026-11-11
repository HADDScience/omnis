import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { assigneeStack } from "@/lib/task-assignees"
import { cn } from "@/lib/utils"

type Person = { id: string; name: string }

const SIZE = {
  xs: { avatar: "h-5 w-5", text: "text-[9px]", rest: "text-[10px]" },
  sm: { avatar: "h-6 w-6", text: "text-[10px]", rest: "text-[10.5px]" },
  md: { avatar: "h-8 w-8", text: "text-xs", rest: "text-xs" },
} as const

/**
 * 담당자 겹친 아바타 + 「외 n명」(2026-11-11). 목록 · 보드 · 상세가 같은 모양을 쓴다.
 * 이름은 aria-label 로 모두 읽어 준다 — 얼굴은 첫 글자뿐이라 눈으로는 구분이 안 될 수 있다.
 */
export function AssigneeStack({
  people,
  size = "sm",
  max = 3,
  className,
}: {
  people: Person[]
  size?: keyof typeof SIZE
  max?: number
  className?: string
}) {
  if (people.length === 0) return null
  const { shown, rest } = assigneeStack(people, max)
  const s = SIZE[size]
  return (
    <span
      data-assignee-stack={people.length}
      role="img"
      aria-label={`담당 ${people.map((p) => p.name).join(", ")}`}
      title={people.map((p) => p.name).join(", ")}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <span className="flex -space-x-1.5">
        {shown.map((p) => (
          <Avatar key={p.id} className={cn(s.avatar, "ring-2 ring-background")}>
            <AvatarFallback className={s.text}>{p.name.charAt(0)}</AvatarFallback>
          </Avatar>
        ))}
      </span>
      {rest > 0 && <span className={cn("ml-1 whitespace-nowrap text-muted-foreground", s.rest)}>외 {rest}명</span>}
    </span>
  )
}
