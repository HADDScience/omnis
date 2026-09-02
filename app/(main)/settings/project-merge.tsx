"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { HugeiconsIcon } from "@hugeicons/react"
import { InboxIcon, Search01Icon } from "@hugeicons/core-free-icons"

/**
 * 받침에 따라 조사를 고른다. 프로젝트명이 값으로 들어가므로 고정 조사를 쓰면
 * "웹사이트 관리으로"처럼 어긋난다.
 * 'ㄹ' 받침은 "으로"가 아니라 "로"를 쓴다(서울로).
 */
function josa(word: string, kind: "로" | "는"): string {
  const last = word.trim().at(-1)
  const code = last ? last.charCodeAt(0) : 0
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  const jong = isHangul ? (code - 0xac00) % 28 : 0
  if (kind === "로") return !isHangul || jong === 0 || jong === 8 ? "로" : "으로"
  return !isHangul || jong === 0 ? "는" : "은"
}

export interface MergeableProject {
  id: string
  name: string
  productName: string | null
  taskCount: number
}

/**
 * 프로젝트 병합 — 기계가 못 합치는 것을 사람이 합치는 자리.
 *
 * 이름 정규화는 공백·대소문자만 흡수한다. "홈페이지 관리"와 "웹사이트 관리"는
 * 사람만 같은 것으로 판단할 수 있고, 실측상 프로젝트명의 71%가 그런 경우다
 * (인수인계 §5-B-4). 자동화 대신 판단할 화면을 준다.
 */
export function ProjectMerge({ projects }: { projects: MergeableProject[] }) {
  const router = useRouter()
  const [source, setSource] = useState<MergeableProject | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [merging, setMerging] = useState(false)

  const candidates = useMemo(() => {
    if (!source) return []
    const q = query.trim().toLowerCase()
    return projects
      .filter((p) => p.id !== source.id)
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
  }, [projects, source, query])

  const target = candidates.find((p) => p.id === targetId) ?? null

  function openMerge(p: MergeableProject) {
    setSource(p)
    setTargetId(null)
    setQuery("")
  }

  function closeMerge() {
    setSource(null)
    setTargetId(null)
    setQuery("")
  }

  async function merge() {
    if (!source || !targetId) return
    setMerging(true)
    try {
      const res = await fetch("/api/projects/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, targetId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "병합에 실패했습니다")
        return
      }
      toast.success(
        `'${data.sourceName}' → '${data.targetName}' 병합 완료 · 업무 ${data.moved}건 이동`
      )
      closeMerge()
      router.refresh()
    } catch {
      toast.error("병합에 실패했습니다")
    } finally {
      setMerging(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">프로젝트 정리</CardTitle>
          <CardDescription className="text-xs">
            이름이 달라 자동으로는 합쳐지지 않는 프로젝트를 직접 합칩니다. 원본은 지워지지 않고
            보관되며, 업무만 대상 프로젝트로 옮겨집니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <Empty className="gap-2 rounded-md border p-6">
              <EmptyHeader className="gap-1">
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={InboxIcon} size={20} aria-hidden />
                </EmptyMedia>
                <EmptyTitle className="text-sm">프로젝트가 없습니다</EmptyTitle>
                <EmptyDescription className="text-xs">
                  업무를 만들면서 프로젝트가 생기면 여기에 표시됩니다.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {projects.map((p) => (
                <li key={p.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                  {p.productName && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {p.productName}
                    </Badge>
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    업무 {p.taskCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => openMerge(p)}
                  >
                    합치기
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={source !== null} onOpenChange={(o) => !o && closeMerge()}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>{source ? `'${source.name}' 합치기` : "프로젝트 합치기"}</DialogTitle>
            <DialogDescription className="text-xs">
              이 프로젝트의 업무를 옮겨 받을 프로젝트를 고르세요.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="프로젝트 검색"
              className="h-9 pl-8 text-[13px]"
              aria-label="합칠 대상 프로젝트 검색"
            />
          </div>

          <ScrollArea className="max-h-56 overflow-auto rounded-md border">
            {candidates.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                {query ? "검색 결과가 없습니다" : "합칠 수 있는 다른 프로젝트가 없습니다"}
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setTargetId(p.id)}
                      aria-pressed={targetId === p.id}
                      className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                        targetId === p.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        업무 {p.taskCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>

          {source && target && (
            <p className="rounded-md bg-muted px-3 py-2 text-[12px] leading-relaxed">
              업무 <span className="font-medium tabular-nums">{source.taskCount}건</span>이{" "}
              <span className="font-medium">{target.name}</span>
              {josa(target.name, "로")} 옮겨지고,{" "}
              <span className="font-medium">{source.name}</span>
              {josa(source.name, "는")} 보관 처리됩니다.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeMerge} disabled={merging}>
              취소
            </Button>
            <Button onClick={merge} disabled={!targetId || merging} className="gap-1.5">
              {merging ? <Spinner className="h-3 w-3" /> : null}
              합치기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
