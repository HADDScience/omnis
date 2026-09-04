"use client"

import { useCallback, useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Folder01Icon, File01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

interface Entry {
  name: string
  path: string
  isDir: boolean
  size: number | null
  modifiedAt: string | null
}

/** 사람이 읽는 크기. 정확한 바이트는 여기서 쓸모가 없다. */
function humanSize(n: number | null): string {
  if (n === null) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * 사내 NAS 탐색기.
 *
 * 브라우저는 NAS 에 직접 붙지 못한다 — 인증서가 자체서명이고 Basic 인증이 걸려 있으며
 * DSM 웹 UI 포트도 외부에 닫혀 있다. 그래서 옴니스가 중계한다(`/api/nas`).
 */
export function NasBrowser({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p: string) => {
    setEntries(null)
    setError(null)
    try {
      const res = await fetch(`/api/nas?path=${encodeURIComponent(p)}`)
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? "열 수 없습니다")
        return
      }
      const ct = res.headers.get("content-type") ?? ""
      if (!ct.includes("application/json")) {
        // 폴더가 아니라 파일이었다 — 새 탭에서 연다
        window.open(`/api/nas?path=${encodeURIComponent(p)}`, "_blank", "noopener")
        setEntries([])
        return
      }
      const body = await res.json()
      setEntries(body.entries ?? [])
      setPath(body.path ?? p)
    } catch {
      setError("NAS 에 연결하지 못했습니다")
    }
  }, [])

  useEffect(() => { load(initialPath) }, [initialPath, load])

  const segments = path.split("/").filter(Boolean)
  const parent = segments.length > 1 ? "/" + segments.slice(0, -1).join("/") : null

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 overflow-hidden">
      {/* 경로 — 각 단계를 눌러 위로 갈 수 있다 */}
      <nav aria-label="경로" className="flex flex-wrap items-center gap-1 text-[13px]">
        {segments.map((seg, i) => {
          const to = "/" + segments.slice(0, i + 1).join("/")
          const isLast = i === segments.length - 1
          return (
            <span key={to} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">/</span>}
              <button
                type="button"
                onClick={() => load(to)}
                disabled={isLast}
                className={isLast ? "font-medium" : "text-muted-foreground hover:text-foreground hover:underline"}
              >
                {seg}
              </button>
            </span>
          )
        })}
      </nav>

      {parent && (
        <Button variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => load(parent)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={15} aria-hidden />
          상위 폴더
        </Button>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {entries === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          비어 있는 폴더입니다.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
          {entries.map((e) => (
            <li key={e.path}>
              {e.isDir ? (
                <button
                  type="button"
                  onClick={() => load(e.path)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13.5px] hover:bg-muted"
                >
                  <HugeiconsIcon icon={Folder01Icon} size={17} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                </button>
              ) : (
                <a
                  href={`/api/nas?path=${encodeURIComponent(e.path)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-[13.5px] hover:bg-muted"
                >
                  <HugeiconsIcon icon={File01Icon} size={17} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">{humanSize(e.size)}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
