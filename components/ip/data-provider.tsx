"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { fetchSnapshot, type OrgMeta, type Snapshot } from "@/lib/ip/db"
import type {
  ActionItem,
  Communication,
  IntegrityFlagRow,
  Patent,
  ProgressEntry,
  Stage,
  StatusOption,
  Trademark,
} from "@/lib/ip/types"

interface DataValue {
  meta: OrgMeta
  trademarks: Trademark[]
  patents: Patent[]
  /** 진행 기록 — 사용자가 채우는 유일한 양식의 결과 */
  progress: ProgressEntry[]
  communications: Communication[]
  actions: ActionItem[]
  flags: IntegrityFlagRow[]
  statusOptions: StatusOption[]
  /** 파이프라인 단계 정의. 양식의 조건부 입력칸이 여기서 온다. */
  stages: Stage[]
  /** 상태 목록에서 "진행 중"으로 분류된 값 (정체 일수 계산 대상) */
  openStatuses: (kind: "trademark" | "patent") => Set<string>
  refresh: () => Promise<void>
  /** 저장 직후 화면을 즉시 갱신할 때 쓴다 */
  reloading: boolean
}

const DataContext = createContext<DataValue | null>(null)

export function useData(): DataValue {
  const value = useContext(DataContext)
  if (!value)
    throw new Error("useData 는 DataProvider 안에서만 쓸 수 있습니다.")
  return value
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  /** 이벤트 핸들러에서 호출하는 수동 새로고침 */
  const load = useCallback(async () => {
    setReloading(true)
    try {
      setSnapshot(await fetchSnapshot())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReloading(false)
    }
  }, [])

  // 최초 적재. setState 는 전부 await 이후에 일어나 동기 연쇄 렌더를 만들지 않는다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchSnapshot()
        if (!cancelled) setSnapshot(next)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openStatuses = useCallback(
    (kind: "trademark" | "patent") =>
      new Set(
        (snapshot?.statusOptions ?? [])
          .filter((s) => s.kind === kind && s.isOpen)
          .map((s) => s.value)
      ),
    [snapshot]
  )

  const value = useMemo<DataValue | null>(
    () =>
      snapshot
        ? {
            ...snapshot,
            openStatuses,
            refresh: load,
            reloading,
          }
        : null,
    [snapshot, openStatuses, load, reloading]
  )

  if (error) {
    return (
      <div className="flex min-h-[50svh] flex-col items-center justify-center gap-3 px-4 text-[13px]">
        <p className="text-red-600 dark:text-red-400">
          데이터를 불러오지 못했습니다.
        </p>
        <p className="max-w-md text-center text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          다시 시도
        </Button>
      </div>
    )
  }

  if (!value) {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-[13px] text-muted-foreground">
        불러오는 중…
      </div>
    )
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
