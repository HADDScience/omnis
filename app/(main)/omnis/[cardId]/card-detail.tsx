"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Edit02Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Add01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons"
import { format } from "date-fns"
import {
  migrateContent,
  createEmptySection,
  SECTION_TYPE_LABELS,
  type Section,
  type SectionType,
  type CardContent as CardContentType,
} from "@/lib/omnis-types"
import { SectionViewer, SectionEditor } from "@/components/omnis/section-editor"

// ─── 타입 ────────────────────────────────────────────────

interface VersionEntry {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
}

interface CardInfo {
  id: string
  title: string
}

interface OmnisCardProps {
  card: {
    id: string
    title: string
    content: unknown
    tags: string[]
    version: number
    category: { name: string; icon: string | null }
    updatedBy: { name: string } | null
    createdAt: string
    updatedAt: string
  }
  allCards: CardInfo[]
}

// ═══════════════════════════════════════════════════════════
//  OmnisCardDetail
// ═══════════════════════════════════════════════════════════

export function OmnisCardDetail({ card, allCards }: OmnisCardProps) {
  const router = useRouter()
  const cardContent = migrateContent(card.content)
  const status = cardContent.status || ""

  // 편집 상태
  const [editing, setEditing] = useState(false)
  const [editSections, setEditSections] = useState<Section[]>(cardContent.sections)
  const [editTags, setEditTags] = useState(card.tags.join(", "))
  const [saving, setSaving] = useState(false)

  // 버전 히스토리
  const [history, setHistory] = useState<VersionEntry[]>([])
  const [previewHash, setPreviewHash] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState("")
  const [rolling, setRolling] = useState(false)
  const [timeMachineHash, setTimeMachineHash] = useState<string | null>(null)
  const [timeMachineContent, setTimeMachineContent] = useState("")
  const [timeMachineLoading, setTimeMachineLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/omnis/cards/history?cardId=${card.id}`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {})
  }, [card.id, card.version])

  // ─── 섹션 조작 ─────────────────────────────────────────

  function updateSection(idx: number, updated: Section) {
    setEditSections((prev) => prev.map((s, i) => (i === idx ? updated : s)))
  }

  function deleteSection(idx: number) {
    setEditSections((prev) => prev.filter((_, i) => i !== idx))
  }

  function moveSection(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= editSections.length) return
    setEditSections((prev) => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  function addSection(type: SectionType) {
    const label = SECTION_TYPE_LABELS[type]
    const section = createEmptySection(type, label)
    setEditSections((prev) => [...prev, section])
  }

  // ─── 저장 ──────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    try {
      // text 필드 생성 (git 버전관리 호환)
      const textForGit = editSections
        .filter((s) => s.type === "text")
        .map((s) => `## ${s.title}\n\n${s.body}`)
        .join("\n\n")

      const content: CardContentType & { text: string } = {
        status,
        sections: editSections,
        text: textForGit,
      }

      await fetch("/api/omnis/cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: card.id,
          content,
          tags: editTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      })
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setEditSections(cardContent.sections)
    setEditTags(card.tags.join(", "))
  }

  // ─── 버전 관련 ─────────────────────────────────────────

  async function loadVersion(hash: string) {
    if (previewHash === hash) {
      setPreviewHash(null)
      return
    }
    const res = await fetch(`/api/omnis/cards/history?cardId=${card.id}&hash=${hash}`)
    const data = await res.json()
    setPreviewContent(data.content || "")
    setPreviewHash(hash)
  }

  async function enterTimeMachine(hash: string) {
    if (timeMachineHash === hash) {
      setTimeMachineHash(null)
      return
    }
    setTimeMachineLoading(true)
    try {
      const res = await fetch(`/api/omnis/cards/history?cardId=${card.id}&hash=${hash}`)
      const data = await res.json()
      setTimeMachineContent(data.content || "")
      setTimeMachineHash(hash)
    } finally {
      setTimeMachineLoading(false)
    }
  }

  function exitTimeMachine() {
    setTimeMachineHash(null)
    setTimeMachineContent("")
  }

  // 타임머신 콘텐츠를 섹션으로 파싱
  const timeMachineSections = (() => {
    if (!timeMachineContent) return []
    try {
      const parsed = JSON.parse(timeMachineContent)
      if (parsed.sections) return parsed.sections as Section[]
      if (parsed.text) return [{ id: "tm", type: "text" as const, title: "내용", body: parsed.text }]
    } catch {
      // JSON 파싱 실패 → 마크다운 텍스트
      if (timeMachineContent.trim()) return [{ id: "tm", type: "text" as const, title: "내용", body: timeMachineContent }]
    }
    return []
  })()

  async function handleRollback(hash: string) {
    if (!confirm(`이 버전(${hash.slice(0, 7)})으로 롤백하시겠습니까?`)) return
    setRolling(true)
    try {
      await fetch("/api/omnis/cards/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: card.id, hash }),
      })
      setPreviewHash(null)
      router.refresh()
    } finally {
      setRolling(false)
    }
  }

  // ─── 렌더 ──────────────────────────────────────────────

  return (
    <div className="relative p-4 w-full">
      {/* 메인 콘텐츠 */}
      <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto">
      {/* 제목 + 메타 정보 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{card.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">
              {card.category.icon} {card.category.name}
            </Badge>
            {status && (
              <Badge variant={status === "최신" ? "default" : "secondary"}>{status}</Badge>
            )}
            {card.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              v{card.version} · {card.updatedBy?.name} · {format(new Date(card.updatedAt), "yy.MM.dd")}
            </span>
            {!editing && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setEditing(true)}
              >
                <HugeiconsIcon icon={Edit02Icon} size={14} />
                편집
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── 편집 모드 ─── */}
      {editing && (
        <>
          {editSections.map((section, idx) => (
            <div key={section.id} className="flex flex-col gap-1">
              {/* 순서 이동 버튼 */}
              <div className="flex items-center gap-1 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={idx === 0}
                  onClick={() => moveSection(idx, -1)}
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={idx === editSections.length - 1}
                  onClick={() => moveSection(idx, 1)}
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
                </Button>
              </div>
              <SectionEditor
                section={section}
                onChange={(updated) => updateSection(idx, updated)}
                onDelete={() => deleteSection(idx)}
                allCards={allCards}
              />
            </div>
          ))}

          {/* 섹션 추가 */}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SECTION_TYPE_LABELS) as SectionType[]).map((type) => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 h-7"
                onClick={() => addSection(type)}
              >
                <HugeiconsIcon icon={Add01Icon} size={12} />
                {SECTION_TYPE_LABELS[type]}
              </Button>
            ))}
          </div>

          {/* 태그 편집 + 저장/취소 */}
          <Card>
            <CardContent className="pt-6 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">태그 (쉼표 구분)</Label>
                <Input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Spinner /> : "저장"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  취소
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ─── 타임머신 모드 ─── */}
      {!editing && timeMachineHash && (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 px-4 py-2">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              과거 버전 보기: {history.find((v) => v.hash === timeMachineHash)?.shortHash}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {history.find((v) => v.hash === timeMachineHash)?.message}
            </span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={exitTimeMachine}>
              현재 버전으로 돌아가기
            </Button>
          </div>
          {timeMachineLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : timeMachineSections.length > 0 ? (
            timeMachineSections.map((section, i) => (
              <SectionViewer key={`tm-${i}`} section={section} allCards={allCards} />
            ))
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">이 버전에는 내용이 없습니다.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ─── 읽기 모드 (현재 버전) ─── */}
      {!editing && !timeMachineHash && (
        <>
          {cardContent.sections.length > 0 ? (
            cardContent.sections.map((section) => (
              <SectionViewer key={section.id} section={section} allCards={allCards} />
            ))
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">내용</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  내용이 없습니다. 편집 버튼을 눌러 작성하세요.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      </div>

      {/* ─── 사이드 버전 타임라인 ─── */}
      {history.length > 0 && (
        <div className="group/timeline hidden lg:block fixed right-0 top-16 bottom-0 w-12 hover:w-72 transition-all duration-300 overflow-hidden overflow-y-auto border-l bg-background/80 backdrop-blur-sm z-20 pl-2">
          <div className="sticky top-4">
            {/* 콜랩스 상태: 미니 타임라인 */}
            <div className="flex flex-col items-center gap-0 pt-2 group-hover/timeline:hidden">
              <span className="text-[9px] font-medium text-muted-foreground/40 group-hover/timeline:text-muted-foreground mb-2 transition-colors">
                v{card.version}
              </span>
              <div className="relative flex flex-col items-center">
                <div className="absolute top-0 bottom-0 w-px bg-border/40 group-hover/timeline:bg-border transition-colors" />
                {history.slice(0, 8).map((v, i) => (
                  <button
                    key={v.hash}
                    onClick={() => enterTimeMachine(v.hash)}
                    className="relative z-10 mb-3 group/dot"
                    title={`${v.shortHash} · ${v.message}`}
                  >
                    <div className={`h-2.5 w-2.5 rounded-full border-2 transition-all group-hover/dot:scale-150 ${
                      timeMachineHash === v.hash
                        ? "bg-amber-500 border-amber-500 scale-125"
                        : i === 0
                          ? "bg-primary/40 border-primary/40 group-hover/dot:bg-primary group-hover/dot:border-primary"
                          : "bg-muted-foreground/20 border-muted-foreground/20 group-hover/dot:bg-muted-foreground/60 group-hover/dot:border-muted-foreground/60"
                    }`} />
                  </button>
                ))}
                {history.length > 8 && (
                  <span className="text-[8px] text-muted-foreground/30 mt-1">+{history.length - 8}</span>
                )}
              </div>
            </div>

            {/* 펼쳐진 상태: 전체 타임라인 */}
            <div className="hidden group-hover/timeline:block">
              <div className="text-xs font-medium text-muted-foreground mb-3 px-1">
                버전 기록 <span className="text-[10px]">({history.length})</span>
              </div>
              <div className="relative pl-4">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />

                <div className="flex flex-col gap-3">
                  {history.map((v, i) => (
                    <div key={v.hash} className="relative">
                      <div className={`absolute -left-[9.5px] top-1 h-2 w-2 rounded-full border-2 transition-colors ${
                        timeMachineHash === v.hash
                          ? "bg-amber-500 border-amber-500"
                          : i === 0
                            ? "bg-primary border-primary"
                            : "bg-background border-muted-foreground/40"
                      }`} />

                      <button
                        className={`flex flex-col gap-0.5 text-left w-full rounded-md px-2 py-1 transition-colors ${
                          timeMachineHash === v.hash ? "bg-amber-500/10 ring-1 ring-amber-500/30" : "hover:bg-muted"
                        }`}
                        onClick={() => enterTimeMachine(v.hash)}
                      >
                        <div className="flex items-center gap-1.5">
                          <code className="text-[9px] text-muted-foreground font-mono">{v.shortHash}</code>
                          {i === 0 && <Badge variant="default" className="text-[8px] px-1 py-0 h-3.5">최신</Badge>}
                          {timeMachineHash === v.hash && <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 bg-amber-500/20 text-amber-600">보는 중</Badge>}
                        </div>
                        <span className="text-[10px] leading-tight line-clamp-2">{v.message}</span>
                        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                          <span>{v.author}</span>
                          <span>{format(new Date(v.date), "MM/dd HH:mm")}</span>
                        </div>
                      </button>

                      {i > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-[9px] gap-0.5 ml-2 mt-0.5"
                          disabled={rolling}
                          onClick={() => handleRollback(v.hash)}
                        >
                          <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={10} />
                          롤백
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
