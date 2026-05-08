"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"

interface CategoryOption {
  id: string
  name: string
  icon?: string | null
}

interface CreateCardDialogProps {
  categories: CategoryOption[]
}

/**
 * 옴니스 지식카드 생성 다이얼로그.
 * - URL `?create=1` 시 자동 오픈 (CommandPalette quick-action 진입점)
 * - `?create=1&categoryId=<id>` 시 카테고리 프리셀렉트
 * - 생성 성공 시 해당 카드 상세로 이동
 */
export function CreateCardDialog({ categories }: CreateCardDialogProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const wantOpen = searchParams.get("create") === "1"
  const presetCategoryId = searchParams.get("categoryId")

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [categoryId, setCategoryId] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (wantOpen) {
      setOpen(true)
      if (presetCategoryId) setCategoryId(presetCategoryId)
      else if (!categoryId && categories.length > 0) setCategoryId(categories[0].id)
    }
  }, [wantOpen, presetCategoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearQuery() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("create")
    params.delete("categoryId")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTitle("")
      clearQuery()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !categoryId || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/omnis/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId,
          title: title.trim(),
          content: {},
          tags: [],
        }),
      })
      if (res.status === 401) {
        toast.error("세션이 만료되었습니다. 다시 로그인해주세요.", {
          action: {
            label: "로그인",
            onClick: () => {
              window.location.href = "/login"
            },
          },
        })
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? "생성 실패")
      }
      const card = await res.json()
      toast.success("지식카드 생성됨")
      setOpen(false)
      setTitle("")
      clearQuery()
      router.push(`/omnis/${card.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "지식카드 생성 실패")
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCategory = categories.find((c) => c.id === categoryId)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 지식카드 만들기</DialogTitle>
          <DialogDescription>
            카테고리와 제목만 정하면 빈 카드가 생성됩니다. 상세 편집은 다음 화면에서 진행합니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} id="create-card-form" className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-title" className="text-[11.5px] font-semibold text-muted-foreground">
              카드 제목 *
            </Label>
            <Input
              id="card-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: HPLC 세척 주기, 4분기 매출 요약 …"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[11.5px] font-semibold text-muted-foreground">
              카테고리 *
            </Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="카테고리 선택">
                  {selectedCategory ? (
                    <span className="inline-flex items-center gap-1.5">
                      {selectedCategory.icon && <span>{selectedCategory.icon}</span>}
                      {selectedCategory.name}
                    </span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id} label={c.name}>
                    <span className="inline-flex items-center gap-1.5">
                      {c.icon && <span>{c.icon}</span>}
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button
            type="submit"
            form="create-card-form"
            disabled={submitting || !title.trim() || !categoryId}
            className="gap-1.5"
          >
            {submitting && <Spinner className="h-3.5 w-3.5" />}
            {submitting ? "생성 중…" : "카드 생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
