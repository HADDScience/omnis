"use client"

import { useEffect, useMemo, useRef } from "react"
import Spreadsheet, { type CellBase, type Matrix, type Selection } from "react-spreadsheet"
import { sheetRangeClip, type CellRange } from "@/lib/answer-clipboard"
import { putClip } from "./answer-copy"

/**
 * 읽기 전용 표(react-spreadsheet) — 칸 범위를 끌어 고르고 Ctrl/⌘+C 하면 표(text/html) · 탭 글(text/plain) 두 형식으로 복사된다.
 * react-spreadsheet 는 글(text/plain)만 싣는다. 그래서 이 표가 포커스를 가졌고 칸 범위를 골랐으면 복사 사건을
 * 잡기 단계에서 먼저 받아 두 형식을 싣고 멈춘다.
 * 옴니스 답 표(components/omnis/omnis-ask.tsx)와 카드 표(section-editor.tsx)가 같이 쓴다.
 *
 * 머리글은 react-spreadsheet 의 열 머리(columnLabels — 고를 수 없는 th)가 아니라 첫 줄 칸으로 그린다 —
 * 머리글도 칸처럼 끌어 고르고 복사할 수 있게. 좌표는 머리글 줄이 0 이다(lib/answer-clipboard.ts sheetRangeClip).
 */
export function CopyableSheet({ headers, rows, className = "" }: { headers: string[]; rows: string[][]; className?: string }) {
  const data: Matrix<CellBase> = useMemo(() => {
    const body = rows.map((r) => r.map((value) => ({ value, readOnly: true })))
    if (!headers.length) return body
    return [headers.map((value) => ({ value, readOnly: true, className: "omnis-sheet-head" })), ...body]
  }, [headers, rows])
  const root = useRef<HTMLDivElement>(null)
  const range = useRef<CellRange | null>(null)
  const latest = useRef({ headers, rows })
  useEffect(() => {
    latest.current = { headers, rows }
  }, [headers, rows])

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const el = root.current
      const r = range.current
      if (!el || !r || !e.clipboardData) return
      // 이 표가 포커스를 가진 때만 — 다른 표 · 입력칸의 복사를 가로채지 않는다
      if (!el.contains(document.activeElement)) return
      // 화면 글을 끌어 고른 복사는 답 본문(OmnisAnswerBody)이 맡는다
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount > 0 && !el.contains(sel.getRangeAt(0).commonAncestorContainer)) return
      const clip = sheetRangeClip(latest.current.headers, latest.current.rows, r)
      if (!clip.text) return
      e.preventDefault()
      // react-spreadsheet 의 문서 듣기(글만 쓴다)까지 가지 않게 — 그쪽은 고른 칸이 바뀔 때마다 다시 붙어 순서를 믿을 수 없다
      e.stopPropagation()
      putClip(e.clipboardData, clip)
    }
    // 잡기 단계(capture)의 window — 어떤 문서 · 요소 듣기보다 먼저 돈다
    window.addEventListener("copy", onCopy, true)
    return () => window.removeEventListener("copy", onCopy, true)
  }, [])

  return (
    <div ref={root} data-copyable-sheet className={`omnis-spreadsheet omnis-spreadsheet--readonly overflow-x-auto ${className}`}>
      <Spreadsheet
        data={data}
        hideColumnIndicators
        hideRowIndicators
        onSelect={(s: Selection) => {
          range.current = s.toRange(data)
        }}
      />
    </div>
  )
}
