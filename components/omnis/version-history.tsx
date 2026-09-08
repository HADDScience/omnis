"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  TimeQuarterPassIcon,
  EyeIcon,
  BackwardIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { apiUrl } from "@/lib/base-path"
import { useMediaQuery } from "@/hooks/use-media-query"

interface VersionEntry {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
}

interface VersionHistoryProps {
  cardId: string
}

export function VersionHistory({ cardId }: VersionHistoryProps) {
  const [history, setHistory] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [viewing, setViewing] = useState<{ hash: string; content: string } | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const router = useRouter()

  // 좁은 화면에서는 기본 접힘 — 사용자가 토글하면 그 선택을 따른다
  const isLgUp = useMediaQuery("(min-width: 1024px)")
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const isOpen = expanded ?? isLgUp

  useEffect(() => {
    fetch(apiUrl(`/api/omnis/${cardId}/versions`))
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? "버전 기록을 불러오지 못했습니다")
        return data
      })
      .then((d) => setHistory(Array.isArray(d.history) ? d.history : []))
      .catch((err) => {
        console.error("[version-history] load failed", { cardId, err })
        toast.error(err instanceof Error ? err.message : "버전 기록을 불러오지 못했습니다")
      })
      .finally(() => setLoading(false))
  }, [cardId])

  async function viewVersion(hash: string) {
    const res = await fetch(apiUrl(`/api/omnis/${cardId}/versions/${hash}`))
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error ?? "버전 내용을 불러오지 못했습니다")
      return
    }
    setViewing({ hash, content: data.content ?? "" })
  }

  async function doRestore(hash: string) {
    if (!confirm(`이 버전(${hash.slice(0, 7)})으로 복원할까요? 새 커밋이 추가됩니다.`)) return
    setRestoring(hash)
    const res = await fetch(apiUrl(`/api/omnis/${cardId}/restore`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hash }),
    })
    setRestoring(null)
    if (res.ok) {
      toast.success("복원 완료")
      router.refresh()
    } else {
      const data = await res.json().catch(() => null)
      toast.error(data?.error ?? "복원 실패")
    }
  }

  return (
    // lg 이상: 우측 고정 레일 / 그 아래: 본문 하단에 붙는 접힘 섹션.
    // 320px 에서 320px 레일을 붙이면 본문이 사라진다 (규칙 16 모바일 단일 컬럼).
    <aside className="flex w-full shrink-0 flex-col border-t bg-card lg:h-full lg:w-80 lg:border-l lg:border-t-0 xl:w-96">
      <button
        type="button"
        onClick={() => setExpanded(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 border-b px-4 py-3 text-left transition-colors hover:bg-muted/40 lg:pointer-events-none lg:hover:bg-transparent"
      >
        <HugeiconsIcon icon={TimeQuarterPassIcon} size={14} className="text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">버전 히스토리</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{history.length}</span>
        <HugeiconsIcon
          icon={isOpen ? ArrowUp01Icon : ArrowDown01Icon}
          size={14}
          className="text-muted-foreground lg:hidden"
          aria-hidden
        />
      </button>
      <div className={`${isOpen ? "flex" : "hidden"} max-h-[60svh] flex-1 flex-col overflow-auto lg:flex lg:max-h-none`}>
        {loading ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">불러오는 중...</div>
        ) : history.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">버전 기록 없음</div>
        ) : (
          <ul className="flex flex-col">
            {history.map((v, i) => (
              <li key={v.hash} className="group border-b last:border-b-0">
                <div className="flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-muted/40">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-[9px]">{v.author.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {v.shortHash}
                      </span>
                      <span className="text-[11.5px] font-medium">{v.author}</span>
                      {i === 0 && (
                        <span className="rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-semibold text-primary">
                          현재
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-foreground">{v.message}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{v.date}</div>
                    <div className="mt-1.5 hidden gap-1 group-hover:flex">
                      <button
                        type="button"
                        onClick={() => viewVersion(v.hash)}
                        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted"
                      >
                        <HugeiconsIcon icon={EyeIcon} size={10} /> 보기
                      </button>
                      {i !== 0 && (
                        <button
                          type="button"
                          onClick={() => doRestore(v.hash)}
                          disabled={restoring === v.hash}
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:opacity-50"
                        >
                          <HugeiconsIcon icon={BackwardIcon} size={10} />{" "}
                          {restoring === v.hash ? "복원 중" : "복원"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={!!viewing}
        onOpenChange={(o) => {
          if (!o) setViewing(null)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              버전 보기 · <span className="font-mono text-[12px]">{viewing?.hash.slice(0, 7)}</span>
            </DialogTitle>
            <DialogDescription>읽기 전용 · 복원하려면 해당 버전의 &quot;복원&quot; 버튼 사용</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-[12px] whitespace-pre-wrap">
            {viewing?.content}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
