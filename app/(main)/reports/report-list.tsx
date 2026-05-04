"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon } from "@hugeicons/core-free-icons"

interface Report {
  id: string
  title: string
  isoWeek: string
  status: string
  content: unknown
  owner: { id: string; name: string }
  weekStart: string
  weekEnd: string
  createdAt: string
}

export function ReportList({ reports: initial }: { reports: Report[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch("/api/reports/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateDraft: true }),
      })
      if (res.ok) router.refresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {initial.length}건의 보고서
        </h2>
        <Button size="sm" onClick={handleCreate} disabled={creating}>
          {creating ? <Spinner /> : "주간보고 생성"}
        </Button>
      </div>

      {initial.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              아직 주간보고가 없습니다. 위 버튼을 눌러 생성하세요.
            </p>
          </CardContent>
        </Card>
      ) : (
        initial.map((r) => <ReportCard key={r.id} report={r} />)
      )}
    </div>
  )
}

function ReportCard({ report }: { report: Report }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`"${report.title}" 보고서를 삭제하시겠습니까?`)) return
    setDeleting(true)
    const res = await fetch(`/api/reports/weekly?id=${report.id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
    else setDeleting(false)
  }

  if (deleting) return null
  const content = (report.content ?? {}) as {
    markdown?: string
    completed?: string[]
    inProgress?: string[]
    draft?: string
  }

  const markdown = content.markdown || content.draft || ""
  const hasContent = markdown.length > 0 || (content.completed?.length ?? 0) > 0

  return (
    <Card className="group">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Link href={`/reports/${report.id}`}>
            <CardTitle className="text-sm hover:text-primary transition-colors cursor-pointer">
              {report.title}
            </CardTitle>
          </Link>
          <div className="flex items-center gap-2">
            <Badge
              variant={report.status === "제출 완료" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {report.status}
            </Badge>
            <button
              onClick={handleDelete}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
              aria-label="보고서 삭제"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {hasContent ? (
          <>
            <div className={`relative ${expanded ? "" : "max-h-[120px] overflow-hidden"}`}>
              {markdown ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {markdown}
                  </ReactMarkdown>
                </div>
              ) : (
                <>
                  {content.completed && content.completed.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">완료 업무</div>
                      <ul className="text-sm list-disc list-inside">
                        {content.completed.map((t, i) => <li key={i}>{t}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {/* 그라데이션 오버레이 */}
              {!expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card to-transparent" />
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs self-start -ml-2"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "접기" : "더보기"}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">내용 없음</p>
        )}
      </CardContent>
    </Card>
  )
}
