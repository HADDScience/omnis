"use client"

// 제자리 편집 한 칸 — 국가과제 「우리 결정」 펼침과 인증 · 가점 펼침이 같이 쓴다.
// 누르면 그 칸이 입력이 되고, Enter · 칸 벗어남이면 저장, Esc 면 취소. 상태 흐름은 lib/inline-field.ts.
import {
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import { send } from "@/components/grants/send"
import {
  beginEdit,
  cancelEdit,
  commitEdit,
  editDraft,
  initField,
  keyAction,
  noteFromError,
  saveFailed,
  saveSucceeded,
  server,
  shownValue,
  sameValue,
  type Equals,
  type FieldState,
} from "@/lib/inline-field"
import { cn } from "@/lib/utils"

export interface EditorProps<T> {
  id: string
  draft: T
  setDraft: (v: T) => void
  /** 지금 입력(또는 준 값)을 저장 — 바뀐 게 없으면 보기로 돌아간다 */
  commit: (v?: T) => void
  cancel: () => void
  /** 입력 요소에 펼친다 — 자동 포커스 · 칸 벗어나면 저장 · Enter/Esc */
  bind: (opts?: { multiline?: boolean }) => {
    id: string
    autoFocus: true
    onBlur: (e: FocusEvent<HTMLElement>) => void
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  }
}

/** 고칠 수 있는 칸의 겉모양 — hover · focus 때만 테두리와 배경이 살짝 */
export const FIELD_SURFACE =
  "-mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent px-1.5 py-1 text-left transition-colors outline-none hover:border-[var(--glass-edge)] hover:bg-foreground/[0.04] focus-visible:border-ring/60 focus-visible:bg-foreground/[0.04]"

export function InlineField<T>({
  label,
  value,
  equals = sameValue,
  display,
  editor,
  save,
  after,
}: {
  label: string
  value: T
  equals?: Equals<T>
  /** 보기 — 비었으면 「—」 */
  display: (v: T) => ReactNode
  editor: (p: EditorProps<T>) => ReactNode
  /** 서버에 보낸다 — 실패하면 던진다(SendError.status 409 = 그새 바뀜) */
  save: (next: T, prev: T) => Promise<void>
  /** 값 옆에 붙는 것(예: 업무 열기 링크) */
  after?: ReactNode
}) {
  const uid = useId()
  const id = `f${uid}`
  const srv = server(value)
  const [s, setS] = useState<FieldState<T>>(() => initField(value))
  // 칸 벗어남(blur)이 Esc · Enter 뒤에 한 번 더 오는 것을 걸러내려고 지금 상태를 따로 쥔다
  const live = useRef(s)
  const set = (next: FieldState<T>) => {
    live.current = next
    setS(next)
  }
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function commit(v?: T) {
    const { state, send: out } = commitEdit(live.current, srv, equals, v ?? live.current.draft)
    set(state)
    if (!out) return
    save(out.next, out.prev).then(
      () => {
        set(saveSucceeded(live.current))
        clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(
          () => set({ ...live.current, saved: false }),
          1800
        )
      },
      (err) => set(saveFailed(live.current, noteFromError(err)))
    )
  }
  const cancel = () => set(cancelEdit(live.current))

  const bind: EditorProps<T>["bind"] = (opts) => ({
    id,
    autoFocus: true,
    onBlur: () => {
      if (live.current.mode === "edit") commit()
    },
    onKeyDown: (e) => {
      const act = keyAction(e.key, {
        shift: e.shiftKey,
        multiline: opts?.multiline,
        composing: e.nativeEvent.isComposing,
      })
      if (!act) return
      e.preventDefault()
      e.stopPropagation()
      if (act === "cancel") cancel()
      else commit()
    },
  })

  const shown = shownValue(s, srv)
  const body = display(shown)
  return (
    <div className="contents">
      <dt className="pt-1 text-muted-foreground" id={`${id}-label`}>
        {s.mode === "edit" ? <label htmlFor={id}>{label}</label> : label}
      </dt>
      <dd className="min-w-0">
        {s.mode === "edit" ? (
          <EditorSlot
            render={editor}
            id={id}
            draft={s.draft}
            setDraft={(v: T) => set(editDraft(live.current, v))}
            commit={commit}
            cancel={cancel}
            bind={bind}
          />
        ) : (
          <div className="flex min-w-0 items-start gap-1">
            <button
              type="button"
              aria-labelledby={`${id}-label ${id}-value`}
              aria-busy={s.mode === "saving" || undefined}
              disabled={s.mode === "saving"}
              onClick={() => set(beginEdit(live.current, srv))}
              className={cn(
                FIELD_SURFACE,
                "min-w-0 flex-1 cursor-pointer break-words whitespace-pre-line disabled:cursor-wait",
                s.mode === "saving" && "opacity-70"
              )}
            >
              <span id={`${id}-value`}>
                {body ?? <span className="text-muted-foreground">—</span>}
              </span>
            </button>
            {after}
          </div>
        )}
        <FieldStatus s={s} />
      </dd>
    </div>
  )
}

/** 입력 칸 그리기 — 핸들러는 이벤트 때만 상태를 읽는다 */
function EditorSlot<T>({
  render,
  ...p
}: EditorProps<T> & { render: (p: EditorProps<T>) => ReactNode }) {
  return render(p)
}

function FieldStatus<T>({ s }: { s: FieldState<T> }) {
  return (
    <span role="status" aria-live="polite" className="block text-[11px] leading-4">
      {s.mode === "saving" ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Spinner className="size-3" />
          저장 중
        </span>
      ) : s.note ? (
        <span
          className={
            s.note.kind === "conflict"
              ? "text-amber-700 dark:text-amber-300"
              : "text-destructive"
          }
        >
          {s.note.kind === "conflict"
            ? `${s.note.message} — 새 값으로 바꿨습니다`
            : `저장하지 못했습니다 · ${s.note.message}`}
        </span>
      ) : s.saved ? (
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-3" aria-hidden />
          저장됨
        </span>
      ) : null}
    </span>
  )
}

/**
 * 칸 하나를 PATCH 로 보내는 함수를 만든다 — 고치기 전에 본 값을 expect 로 붙여, 그새 바뀌었으면 서버가 409.
 * 성공 · 충돌 둘 다 화면을 새로 읽는다(충돌이면 새 값으로 바뀐다).
 */
export function useFieldSaver(path: string) {
  const router = useRouter()
  return <T,>(key: string, wire: (v: T) => unknown = (v) => v) =>
    async (next: T, prev: T) => {
      try {
        await send(path, "PATCH", {
          [key]: wire(next),
          expect: { [key]: wire(prev) },
        })
        router.refresh()
      } catch (err) {
        if ((err as { status?: number }).status === 409) router.refresh()
        throw err
      }
    }
}
