"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import Link from "next/link"
import Spreadsheet, { type CellBase, type Matrix } from "react-spreadsheet"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  Add01Icon,
  Attachment01Icon,
  Link01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"
import type {
  Section,
  TextSection,
  TableSection,
  KeyValueSection,
  KeyValueType,
  FilesSection,
  LinksSection,
} from "@/lib/omnis-types"
import { KEYVALUE_TYPE_LABELS } from "@/lib/omnis-types"

// ─── 파일 정보 타입 ──────────────────────────────────────
interface FileInfo {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
}

// ─── 연결 카드 정보 ──────────────────────────────────────
interface CardInfo {
  id: string
  title: string
}

// ─── 유틸 ────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ═══════════════════════════════════════════════════════════
//  SectionViewer  (읽기 모드)
// ═══════════════════════════════════════════════════════════

export function SectionViewer({
  section,
  allCards,
}: {
  section: Section
  allCards?: CardInfo[]
}) {
  switch (section.type) {
    case "text":
      return <TextViewer section={section} />
    case "table":
      return <TableViewer section={section} />
    case "keyvalue":
      return <KeyValueViewer section={section} />
    case "files":
      return <FilesViewer section={section} />
    case "links":
      return <LinksViewer section={section} allCards={allCards} />
  }
}

// ─── 텍스트 뷰어 ────────────────────────────────────────
function TextViewer({ section }: { section: TextSection }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{section.title || "텍스트"}</CardTitle>
      </CardHeader>
      <CardContent>
        {section.body ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:w-full">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">내용이 없습니다.</p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 테이블 뷰어 ────────────────────────────────────────
function TableViewer({ section }: { section: TableSection }) {
  const data: Matrix<CellBase> = useMemo(() =>
    section.rows.map((row) =>
      row.map((cell) => ({ value: cell, readOnly: true }))
    ), [section.rows])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{section.title || "테이블"}</CardTitle>
      </CardHeader>
      <CardContent>
        {section.headers.length === 0 ? (
          <p className="text-sm text-muted-foreground">빈 테이블</p>
        ) : (
          <div className="overflow-x-auto omnis-spreadsheet omnis-spreadsheet--readonly">
            <Spreadsheet
              data={data}
              columnLabels={section.headers}
              hideRowIndicators
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 키-값 뷰어 ─────────────────────────────────────────
function KeyValueDisplay({ value, valueType }: { value: string; valueType?: KeyValueType }) {
  if (!value) return <span className="text-sm text-muted-foreground">—</span>
  switch (valueType) {
    case "date":
      return <span className="text-sm">{value}</span>
    case "email":
      return <a href={`mailto:${value}`} className="text-sm text-primary hover:underline">{value}</a>
    case "url":
      return <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">{value}</a>
    case "person":
      return <span className="text-sm inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{value}</span>
    default:
      return <span className="text-sm">{value}</span>
  }
}

function KeyValueViewer({ section }: { section: KeyValueSection }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{section.title || "키-값"}</CardTitle>
      </CardHeader>
      <CardContent>
        {section.pairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">항목이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {section.pairs.map((p, i) => (
              <div key={i} className="contents">
                <span className="text-sm text-muted-foreground">{p.key}</span>
                <KeyValueDisplay value={p.value} valueType={p.valueType} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 파일 뷰어 ──────────────────────────────────────────
function FilesViewer({ section }: { section: FilesSection }) {
  const [files, setFiles] = useState<FileInfo[]>([])

  useEffect(() => {
    if (section.fileIds.length === 0) return
    Promise.all(
      section.fileIds.map((fid) =>
        fetch(`/api/files/${fid}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => setFiles(results.filter(Boolean)))
  }, [section.fileIds])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <HugeiconsIcon icon={Attachment01Icon} size={14} />
          {section.title || "첨부파일"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {files.length === 0 && section.fileIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">첨부파일이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <HugeiconsIcon icon={Attachment01Icon} size={12} className="text-muted-foreground shrink-0" />
                <a
                  href={f.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:text-primary/80 truncate"
                >
                  {f.name}
                </a>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({formatFileSize(f.size)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 관련 카드 뷰어 ─────────────────────────────────────
function LinksViewer({
  section,
  allCards,
}: {
  section: LinksSection
  allCards?: CardInfo[]
}) {
  const linked = allCards?.filter((c) => section.cardIds.includes(c.id)) ?? []

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <HugeiconsIcon icon={Link01Icon} size={14} />
          {section.title || "관련 카드"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">연결된 카드가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {linked.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/omnis/${c.id}`}
                  className="text-sm text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════
//  SectionEditor  (편집 모드)
// ═══════════════════════════════════════════════════════════

export function SectionEditor({
  section,
  onChange,
  onDelete,
  allCards,
}: {
  section: Section
  onChange: (updated: Section) => void
  onDelete: () => void
  allCards?: CardInfo[]
}) {
  function handleTitleChange(title: string) {
    onChange({ ...section, title })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Input
            value={section.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="섹션 제목"
            className="text-sm font-semibold h-8 flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive shrink-0"
            onClick={() => {
              if (confirm("이 섹션을 삭제하시겠습니까?")) onDelete()
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {section.type === "text" && (
          <TextEditor section={section} onChange={onChange} />
        )}
        {section.type === "table" && (
          <TableEditor section={section} onChange={onChange} />
        )}
        {section.type === "keyvalue" && (
          <KeyValueEditor section={section} onChange={onChange} />
        )}
        {section.type === "files" && (
          <FilesEditor section={section} onChange={onChange} />
        )}
        {section.type === "links" && (
          <LinksEditor section={section} onChange={onChange} allCards={allCards} />
        )}
      </CardContent>
    </Card>
  )
}

// ─── 텍스트 에디터 ──────────────────────────────────────
function TextEditor({
  section,
  onChange,
}: {
  section: TextSection
  onChange: (s: Section) => void
}) {
  return (
    <Textarea
      value={section.body}
      onChange={(e) => onChange({ ...section, body: e.target.value })}
      rows={8}
      className="font-mono text-sm"
      placeholder="마크다운을 입력하세요..."
    />
  )
}

// ─── 테이블 에디터 ──────────────────────────────────────
function TableEditor({
  section,
  onChange,
}: {
  section: TableSection
  onChange: (s: Section) => void
}) {
  const [contextPos, setContextPos] = useState<{ x: number; y: number; row: number; col: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const data: Matrix<CellBase> = useMemo(() =>
    section.rows.map((row) =>
      row.map((cell) => ({ value: cell }))
    ), [section.rows])

  const handleChange = useCallback((newData: Matrix<CellBase>) => {
    const rows = newData.map((row) =>
      row.map((cell) => (cell?.value as string) ?? "")
    )
    onChange({ ...section, rows })
  }, [section, onChange])

  const addRowAt = (ri: number) => {
    const newRow = section.headers.map(() => "")
    const rows = [...section.rows]
    rows.splice(ri, 0, newRow)
    onChange({ ...section, rows })
  }

  const deleteRow = (ri: number) => {
    if (section.rows.length <= 1) return
    onChange({ ...section, rows: section.rows.filter((_, i) => i !== ri) })
  }

  const addColAt = (ci: number) => {
    const headers = [...section.headers]
    headers.splice(ci, 0, "")
    const rows = section.rows.map((r) => { const nr = [...r]; nr.splice(ci, 0, ""); return nr })
    onChange({ ...section, headers, rows })
  }

  const deleteCol = (ci: number) => {
    if (section.headers.length <= 1) return
    const headers = section.headers.filter((_, i) => i !== ci)
    const rows = section.rows.map((r) => r.filter((_, i) => i !== ci))
    onChange({ ...section, headers, rows })
  }

  const renameHeader = (ci: number) => {
    const current = section.headers[ci]
    const name = prompt("열 이름", current)
    if (name === null) return
    const headers = [...section.headers]
    headers[ci] = name
    onChange({ ...section, headers })
  }

  // 우클릭으로 셀 위치 감지
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const td = target.closest("td, th")
    if (!td) return

    e.preventDefault()
    const tr = td.closest("tr")
    if (!tr) return

    const table = tr.closest("table")
    if (!table) return

    const allRows = Array.from(table.querySelectorAll("tr"))
    const rowIdx = allRows.indexOf(tr) - 1 // -1 for header row
    const cells = Array.from(tr.children)
    const colIdx = cells.indexOf(td)

    setContextPos({ x: e.clientX, y: e.clientY, row: rowIdx, col: colIdx })
  }, [])

  // 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    if (!contextPos) return
    const close = () => setContextPos(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [contextPos])

  // 헤더 경계 더블클릭 → 열 너비 자동 조절
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const th = target.closest("th")
    if (!th) return

    const table = th.closest("table")
    if (!table) return

    const cells = Array.from(th.parentElement?.children ?? [])
    const colIdx = cells.indexOf(th)

    // 해당 열의 모든 셀 내용물 너비 측정
    const rows = Array.from(table.querySelectorAll("tr"))
    let maxWidth = 0

    rows.forEach((row) => {
      const cell = row.children[colIdx] as HTMLElement | undefined
      if (!cell) return
      const viewer = cell.querySelector(".Spreadsheet__data-viewer") as HTMLElement | null
      if (viewer) {
        const textWidth = viewer.scrollWidth
        if (textWidth > maxWidth) maxWidth = textWidth
      }
      // 헤더 텍스트도 측정
      const text = cell.textContent ?? ""
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.font = getComputedStyle(cell).font
        const w = ctx.measureText(text).width + 24 // padding
        if (w > maxWidth) maxWidth = w
      }
    })

    if (maxWidth > 0) {
      maxWidth = Math.max(maxWidth, 60) // 최소 너비
      const cols = table.querySelectorAll(`tr:first-child > *:nth-child(${colIdx + 1})`)
      cols.forEach((c) => {
        ;(c as HTMLElement).style.minWidth = `${maxWidth}px`
        ;(c as HTMLElement).style.width = `${maxWidth}px`
      })
      // colgroup이 있으면 조절
      const colgroup = table.querySelector("colgroup")
      if (colgroup) {
        const col = colgroup.children[colIdx] as HTMLElement | undefined
        if (col) col.style.width = `${maxWidth}px`
      }
    }
  }, [])

  const addRowEnd = () => {
    const newRow = section.headers.map(() => "")
    onChange({ ...section, rows: [...section.rows, newRow] })
  }

  const addColEnd = () => {
    const headers = [...section.headers, `열${section.headers.length + 1}`]
    const rows = section.rows.map((r) => [...r, ""])
    onChange({ ...section, headers, rows })
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-stretch">
        <div
          ref={wrapperRef}
          className="overflow-x-auto omnis-spreadsheet flex-1"
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
        >
          <Spreadsheet
            data={data}
            onChange={handleChange}
            columnLabels={section.headers}
            hideRowIndicators
          />
        </div>
        <button
          onClick={addColEnd}
          className="shrink-0 w-7 flex items-center justify-center border border-l-0 border-border bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors rounded-r-md"
          title="열 추가"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
        </button>
      </div>
      <button
        onClick={addRowEnd}
        className="sticky bottom-0 h-7 flex items-center justify-center border border-t-0 border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors rounded-b-md text-xs gap-1 backdrop-blur-sm"
        title="행 추가"
      >
        <HugeiconsIcon icon={Add01Icon} size={12} />
      </button>

      {/* 커스텀 컨텍스트 메뉴 */}
      {contextPos && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: contextPos.x, top: contextPos.y }}
        >
          {contextPos.row >= 0 && (
            <>
              <button
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                onClick={() => { addRowAt(contextPos.row); setContextPos(null) }}
              >
                위에 행 추가
              </button>
              <button
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                onClick={() => { addRowAt(contextPos.row + 1); setContextPos(null) }}
              >
                아래에 행 추가
              </button>
              <button
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-accent"
                onClick={() => { deleteRow(contextPos.row); setContextPos(null) }}
              >
                행 삭제
              </button>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => { addColAt(contextPos.col); setContextPos(null) }}
          >
            왼쪽에 열 추가
          </button>
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => { addColAt(contextPos.col + 1); setContextPos(null) }}
          >
            오른쪽에 열 추가
          </button>
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => { renameHeader(contextPos.col); setContextPos(null) }}
          >
            열 이름 변경
          </button>
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-accent"
            onClick={() => { deleteCol(contextPos.col); setContextPos(null) }}
          >
            열 삭제
          </button>
        </div>
      )}
    </div>
  )
}

// ─── 키-값 에디터 ───────────────────────────────────────
function KeyValueEditor({
  section,
  onChange,
}: {
  section: KeyValueSection
  onChange: (s: Section) => void
}) {
  const updatePair = (idx: number, field: "key" | "value" | "valueType", val: string) => {
    const pairs = section.pairs.map((p, i) =>
      i === idx ? { ...p, [field]: val } : p
    )
    onChange({ ...section, pairs })
  }

  const addPair = () => {
    onChange({ ...section, pairs: [...section.pairs, { key: "", value: "", valueType: "text" as KeyValueType }] })
  }

  const deletePair = (idx: number) => {
    onChange({ ...section, pairs: section.pairs.filter((_, i) => i !== idx) })
  }

  const inputForType = (type: KeyValueType | undefined, value: string, onValueChange: (v: string) => void) => {
    switch (type) {
      case "date":
        return <Input type="date" value={value} onChange={(e) => onValueChange(e.target.value)} className="text-xs h-7 flex-1" />
      case "email":
        return <Input type="email" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder="이메일" className="text-xs h-7 flex-1" />
      case "url":
        return <Input type="url" value={value} onChange={(e) => onValueChange(e.target.value)} placeholder="https://..." className="text-xs h-7 flex-1" />
      default:
        return <Input value={value} onChange={(e) => onValueChange(e.target.value)} placeholder="값" className="text-xs h-7 flex-1" />
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {section.pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={p.key}
            onChange={(e) => updatePair(i, "key", e.target.value)}
            placeholder="키"
            className="text-xs h-7 w-[28%]"
          />
          <Select
            value={p.valueType ?? "text"}
            onValueChange={(v: string | null) => { if (v) updatePair(i, "valueType", v) }}
          >
            <SelectTrigger className="h-7 text-[10px] w-[72px] shrink-0">
              <SelectValue>{KEYVALUE_TYPE_LABELS[(p.valueType ?? "text") as KeyValueType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(KEYVALUE_TYPE_LABELS) as [KeyValueType, string][]).map(([k, label]) => (
                <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {inputForType(p.valueType, p.value, (v) => updatePair(i, "value", v))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-destructive shrink-0"
            onClick={() => deletePair(i)}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit text-xs" onClick={addPair}>
        <HugeiconsIcon icon={Add01Icon} size={12} className="mr-1" />
        항목 추가
      </Button>
    </div>
  )
}

// ─── 파일 에디터 ────────────────────────────────────────
function FilesEditor({
  section,
  onChange,
}: {
  section: FilesSection
  onChange: (s: Section) => void
}) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (section.fileIds.length === 0) {
      setFiles([])
      return
    }
    Promise.all(
      section.fileIds.map((fid) =>
        fetch(`/api/files/${fid}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => setFiles(results.filter(Boolean)))
  }, [section.fileIds])

  const uploadFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return
      setUploading(true)
      try {
        const newIds: string[] = []
        for (const file of fileList) {
          const formData = new FormData()
          formData.append("file", file)
          const res = await fetch("/api/files", { method: "POST", body: formData })
          if (res.ok) {
            const record = await res.json()
            newIds.push(record.id)
          }
        }
        if (newIds.length > 0) {
          onChange({ ...section, fileIds: [...section.fileIds, ...newIds] })
        }
      } finally {
        setUploading(false)
      }
    },
    [section, onChange]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        uploadFiles(Array.from(e.target.files))
        e.target.value = ""
      }
    },
    [uploadFiles]
  )

  const removeFile = (fid: string) => {
    onChange({ ...section, fileIds: section.fileIds.filter((id) => id !== fid) })
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-md p-2 transition-colors ${dragging ? "ring-2 ring-primary bg-primary/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true) }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false) }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        const dropped = Array.from(e.dataTransfer.files)
        if (dropped.length > 0) uploadFiles(dropped)
      }}
    >
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <HugeiconsIcon icon={Attachment01Icon} size={12} className="text-muted-foreground shrink-0" />
              <span className="truncate">{f.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                ({formatFileSize(f.size)})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-destructive shrink-0"
                onClick={() => removeFile(f.id)}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleInputChange} disabled={uploading} />
        <Button
          variant="outline"
          size="sm"
          className="text-xs w-fit"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <HugeiconsIcon icon={Attachment01Icon} size={12} className="mr-1" />
          {uploading ? "업로드 중..." : "파일 첨부"}
        </Button>
        <span className="text-[10px] text-muted-foreground">또는 여기에 파일을 드래그하세요</span>
      </div>
    </div>
  )
}

// ─── 관련 카드 에디터 ───────────────────────────────────
function LinksEditor({
  section,
  onChange,
  allCards,
}: {
  section: LinksSection
  onChange: (s: Section) => void
  allCards?: CardInfo[]
}) {
  const linked = allCards?.filter((c) => section.cardIds.includes(c.id)) ?? []
  const available = allCards?.filter((c) => !section.cardIds.includes(c.id)) ?? []

  const addCard = (cardId: string | null) => {
    if (!cardId) return
    onChange({ ...section, cardIds: [...section.cardIds, cardId] })
  }

  const removeCard = (cardId: string) => {
    onChange({ ...section, cardIds: section.cardIds.filter((id) => id !== cardId) })
  }

  return (
    <div className="flex flex-col gap-2">
      {linked.length > 0 && (
        <ul className="flex flex-col gap-1">
          {linked.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <HugeiconsIcon icon={Link01Icon} size={12} className="text-muted-foreground shrink-0" />
              <span className="truncate">{c.title}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-destructive shrink-0"
                onClick={() => removeCard(c.id)}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Select onValueChange={addCard}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="카드 연결 추가">카드 연결 추가</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {available.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
