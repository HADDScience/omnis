"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export interface PanelTaskContext {
  id: string
  name: string
  /** 이 업무의 스레드·이력 메시지. 서버에서 이미 읽어 온 것을 그대로 넘긴다. */
  messages: {
    id: string
    content: string
    createdAt: string
    author: { id: string; name: string }
    isTaskInstruction: boolean
    kind?: string
  }[]
}

interface RightPanelValue {
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
  /** 지금 보고 있는 업무. 업무 상세 페이지가 등록하고, 떠나면 지운다. */
  task: PanelTaskContext | null
  setTask: (t: PanelTaskContext | null) => void
}

const Ctx = createContext<RightPanelValue | null>(null)
const OPEN_KEY = "omnis:right-panel-open"

export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [task, setTask] = useState<PanelTaskContext | null>(null)

  useEffect(() => {
    try {
      setOpenState(window.localStorage.getItem(OPEN_KEY) === "1")
    } catch {
      // 저장소를 못 읽으면 닫힌 채로 시작한다
    }
  }, [])

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    try {
      window.localStorage.setItem(OPEN_KEY, v ? "1" : "0")
    } catch {
      // 저장 실패는 이번 세션에만 영향이 있다
    }
  }, [])

  const value = useMemo<RightPanelValue>(
    () => ({ open, setOpen, toggle: () => setOpen(!open), task, setTask }),
    [open, setOpen, task]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRightPanel(): RightPanelValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useRightPanel 은 RightPanelProvider 안에서만 쓸 수 있다")
  return v
}

/**
 * 화면이 자기 업무를 패널에 등록한다. 그리는 것은 없다.
 *
 * 이걸 두면 업무 상세에서 패널을 열었을 때 전체 채팅이 아니라 **그 업무 스레드**가
 * 먼저 보인다. 업무를 보다가 채팅을 열었는데 남의 대화가 뜨면 매번 찾아 들어가야 한다.
 */
export function RegisterPanelTask(props: PanelTaskContext) {
  const { setTask } = useRightPanel()
  const { id, name, messages } = props
  useEffect(() => {
    setTask({ id, name, messages })
    return () => setTask(null)
  }, [id, name, messages, setTask])
  return null
}
