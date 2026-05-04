"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Edit02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"

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
  updatedAt: string
}

export function ReportDetail({ report }: { report: Report }) {
  const router = useRouter()
  const content = (report.content ?? {}) as { markdown?: string; draft?: string }
  const markdown = content.markdown || content.draft || ""

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(markdown)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/reports/weekly`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, markdown: editValue }),
      })
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await fetch(`/api/reports/weekly`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, status: "제출 완료" }),
      })
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl">
      {/* 메타 정보 */}
      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-medium">{report.owner.name}</div>
              <div className="text-xs text-muted-foreground">{report.isoWeek}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={report.status === "제출 완료" ? "default" : "secondary"}>
              {report.status}
            </Badge>
            {!editing && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                <HugeiconsIcon icon={Edit02Icon} size={14} />
                편집
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 본문 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">보고서 내용</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={20}
                className="font-mono text-sm"
                placeholder="마크다운으로 작성하세요..."
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Spinner /> : "저장"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setEditing(false); setEditValue(markdown) }}>
                  취소
                </Button>
              </div>
            </div>
          ) : markdown ? (
            <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:w-full">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdown}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              내용이 없습니다. 편집 버튼을 눌러 작성하세요.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 제출 버튼 */}
      {report.status !== "제출 완료" && (
        <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
          {submitting ? <Spinner /> : (
            <>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
              제출 완료
            </>
          )}
        </Button>
      )}
    </div>
  )
}
