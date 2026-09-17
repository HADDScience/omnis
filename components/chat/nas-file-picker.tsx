"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { NasBrowser, type Entry } from "@/app/(main)/omnis/nas/nas-browser"

const ROOT = "/HADD Science"

/**
 * 「NAS 파일 연결」 창 — 공용 NAS 에 이미 있는 파일을 올리지 않고 첨부로 잇는다(2026-09-17).
 *
 * 경로를 붙여넣거나(`Z:\HADD Science\…` · 맥 마운트 경로 모두) 폴더를 따라가 고른다.
 * 붙여넣은 경로가 폴더면 그 폴더를 열고, 파일이면 바로 고른다 — 판정은 서버(`/api/nas?stat=1`)가 한다.
 */
export function NasFilePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (entry: Entry) => void
}) {
  // 창을 닫았다 열어도 마지막에 보던 곳에서 시작한다 — 같은 폴더의 파일을 여러 번 잇는 일이 많다
  const [browsePath, setBrowsePath] = useState(ROOT)
  const [typed, setTyped] = useState("")

  function openTyped() {
    const p = typed.trim()
    if (p) setBrowsePath(p)
  }

  function pick(entry: Entry) {
    const parent = entry.path.split("/").slice(0, -1).join("/")
    if (parent) setBrowsePath(parent)
    setTyped("")
    onPick(entry)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,85dvh)] w-[calc(var(--app-vw)-2rem)] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>NAS 파일 연결</DialogTitle>
          <DialogDescription>
            공용 NAS 에 있는 파일은 올리지 않고 연결합니다. 크기 제한이 없습니다.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            openTyped()
          }}
        >
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="경로 붙여넣기 — Z:\HADD Science\… 또는 /Volumes/HADD Science/…"
            aria-label="NAS 경로"
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline" disabled={!typed.trim()}>
            열기
          </Button>
        </form>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* 경로를 새로 열면 탐색기를 새로 만든다 — initialPath 는 처음 한 번만 읽는다 */}
          <NasBrowser key={browsePath} initialPath={browsePath} onPick={pick} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
