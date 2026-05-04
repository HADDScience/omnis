"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Folder01Icon,
  File01Icon,
  Add01Icon,
  Delete02Icon,
  Search01Icon,
  ArrowLeft01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import { format } from "date-fns"
import { CARD_TEMPLATES, type Section } from "@/lib/omnis-types"
import { TaskList } from "@/app/(main)/tasks/task-list"

interface OmnisCard {
  id: string
  title: string
  content: unknown
  tags: string[]
  version: number
  updatedAt: string
  updatedBy: { name: string } | null
  categoryId: string
}

interface Category {
  id: string
  name: string
  icon: string | null
  cards: OmnisCard[]
}

const TASK_FOLDER_ID = "__tasks__"

interface TaskListData {
  tasks: unknown[]
  projects: { id: string; name: string; status: string }[]
  users: { id: string; name: string }[]
}

export function OmnisView({ categories, taskCount, taskListData }: { categories: Category[]; taskCount?: number; taskListData?: TaskListData }) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)

  // 카드 생성 다이얼로그
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [creatingCard, setCreatingCard] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<number | null>(null)
  const [newCard, setNewCard] = useState({ categoryId: "", title: "", tags: "" })

  // 폴더(카테고리) 생성 다이얼로그
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolder, setNewFolder] = useState({ name: "", icon: "" })

  const query = search.toLowerCase()

  const selectedCategory = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) ?? null
    : null

  // 검색 필터
  const filteredCategories = categories.map((cat) => ({
    ...cat,
    cards: cat.cards.filter(
      (c) =>
        !query ||
        c.title.toLowerCase().includes(query) ||
        c.tags.some((t) => t.toLowerCase().includes(query))
    ),
  }))

  const filteredCards = selectedCategory
    ? (filteredCategories.find((c) => c.id === selectedCategoryId)?.cards ?? [])
    : []

  function handleOpenFolder(categoryId: string) {
    setSelectedCategoryId(categoryId)
    setSearch("")
  }

  function handleBackToRoot() {
    setSelectedCategoryId(null)
    setSearch("")
  }

  function handleOpenCreateCard() {
    setNewCard({
      categoryId: selectedCategoryId ?? "",
      title: "",
      tags: "",
    })
    setCreateStep(1)
    setSelectedTemplateIndex(null)
    setShowCreateCard(true)
  }

  function handleCloseCreateCard() {
    setShowCreateCard(false)
    setCreateStep(1)
    setSelectedTemplateIndex(null)
    setNewCard({ categoryId: "", title: "", tags: "" })
  }

  async function handleCreateCard() {
    if (!newCard.categoryId || !newCard.title.trim() || selectedTemplateIndex === null) return
    setCreatingCard(true)
    try {
      const template = CARD_TEMPLATES[selectedTemplateIndex]
      const sections: Section[] = template.sections.map((s) => ({
        ...s,
        id: crypto.randomUUID(),
      } as Section))
      const res = await fetch("/api/omnis/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: newCard.categoryId,
          title: newCard.title.trim(),
          content: { sections },
          tags: newCard.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      })
      if (res.ok) {
        handleCloseCreateCard()
        router.refresh()
      }
    } finally {
      setCreatingCard(false)
    }
  }

  async function handleCreateFolder() {
    if (!newFolder.name.trim()) return
    setCreatingFolder(true)
    try {
      const res = await fetch("/api/omnis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFolder.name.trim(),
          icon: newFolder.icon.trim() || null,
        }),
      })
      if (res.ok) {
        setShowCreateFolder(false)
        setNewFolder({ name: "", icon: "" })
        router.refresh()
      }
    } finally {
      setCreatingFolder(false)
    }
  }

  async function handleDeleteCard(cardId: string, title: string) {
    if (!confirm(`"${title}" 카드를 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/omnis/cards?id=${cardId}`, { method: "DELETE" })
    if (res.ok) router.refresh()
  }

  async function handleDeleteFolder(categoryId: string, name: string) {
    if (!confirm(`"${name}" 폴더를 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/omnis?id=${categoryId}`, { method: "DELETE" })
    if (res.ok) router.refresh()
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 상단 툴바 */}
      <div className="flex items-center gap-2">
        {/* 브레드크럼 */}
        {(selectedCategory || selectedCategoryId === TASK_FOLDER_ID) ? (
          <div className="flex items-center gap-1.5 text-sm mr-2">
            <button
              onClick={handleBackToRoot}
              className="text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              옴니스
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold text-foreground">
              {selectedCategoryId === TASK_FOLDER_ID ? (
                <>
                  <HugeiconsIcon icon={Task01Icon} size={14} className="inline mr-1 text-primary" />
                  업무
                </>
              ) : (
                <>
                  {selectedCategory?.icon && <span className="mr-1">{selectedCategory.icon}</span>}
                  {selectedCategory?.name}
                </>
              )}
            </span>
          </div>
        ) : null}

        {/* 검색 */}
        <div className="relative flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={selectedCategory ? "파일 검색..." : "폴더·파일 검색..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* 버튼 */}
        {!selectedCategory && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setNewFolder({ name: "", icon: "" }); setShowCreateFolder(true) }}
            className="gap-1.5 shrink-0"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            새 폴더
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleOpenCreateCard}
          className="gap-1.5 shrink-0"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
          새 카드
        </Button>
      </div>

      {/* 루트 뷰: 폴더 그리드 */}
      {!selectedCategory && (
        <>
          {filteredCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              {search ? `"${search}" 검색 결과가 없습니다.` : "아직 폴더가 없습니다."}
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {/* 업무 특수 폴더 */}
              <div
                className="group relative rounded-xl border-2 border-primary/30 bg-primary/5 p-4 cursor-pointer hover:border-primary/60 hover:bg-primary/10 transition-all"
                onClick={() => handleOpenFolder(TASK_FOLDER_ID)}
              >
                <div className="mb-3">
                  <HugeiconsIcon icon={Task01Icon} size={36} className="text-primary" />
                </div>
                <p className="font-semibold text-sm truncate mb-1">업무</p>
                <p className="text-[11px] text-muted-foreground">
                  {taskCount ?? 0}개 업무
                </p>
              </div>

              {filteredCategories.map((cat) => {
                const latestCard = cat.cards.slice().sort(
                  (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                )[0]
                const lastUpdated = latestCard
                  ? format(new Date(latestCard.updatedAt), "MM/dd")
                  : null

                return (
                  <div
                    key={cat.id}
                    className="group relative rounded-xl border border-border bg-card p-4 cursor-pointer hover:border-primary/40 hover:bg-accent/30 transition-all"
                    onClick={() => handleOpenFolder(cat.id)}
                  >
                    {/* 삭제 버튼 (빈 폴더만) */}
                    {cat.cards.length === 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteFolder(cat.id, cat.name)
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={14} />
                      </button>
                    )}

                    {/* 폴더 아이콘 */}
                    <div className="mb-3 text-3xl leading-none">
                      {cat.icon ? (
                        <span>{cat.icon}</span>
                      ) : (
                        <HugeiconsIcon icon={Folder01Icon} size={36} className="text-amber-400" />
                      )}
                    </div>

                    {/* 이름 */}
                    <p className="font-semibold text-sm truncate mb-1">{cat.name}</p>

                    {/* 메타 */}
                    <p className="text-[11px] text-muted-foreground">
                      {cat.cards.length}개 파일
                      {lastUpdated && ` · ${lastUpdated}`}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* 업무 특수 폴더 내부 */}
      {selectedCategoryId === TASK_FOLDER_ID && taskListData && (
        <>
          <button
            onClick={handleBackToRoot}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={13} />
            모든 폴더로
          </button>
          <TaskList
            tasks={taskListData.tasks as Parameters<typeof TaskList>[0]["tasks"]}
            projects={taskListData.projects}
            tableOnly
          />
        </>
      )}

      {/* 폴더 내부 뷰: 파일 리스트 */}
      {selectedCategory && selectedCategoryId !== TASK_FOLDER_ID && (
        <>
          {/* 뒤로 가기 버튼 (모바일용 보조) */}
          <button
            onClick={handleBackToRoot}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={13} />
            모든 폴더로
          </button>

          {filteredCards.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              {search ? `"${search}" 검색 결과가 없습니다.` : "이 폴더에 파일이 없습니다."}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-xl border border-border overflow-hidden">
              {filteredCards.map((card) => (
                <FileRow
                  key={card.id}
                  card={card}
                  onDelete={() => handleDeleteCard(card.id, card.title)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 카드 생성 다이얼로그 */}
      <Dialog open={showCreateCard} onOpenChange={(open) => { if (!open) handleCloseCreateCard() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {createStep === 1 ? "템플릿 선택" : "카드 정보 입력"}
            </DialogTitle>
          </DialogHeader>

          {createStep === 1 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">카드 유형을 선택하세요</p>
              <div className="grid grid-cols-3 gap-2">
                {CARD_TEMPLATES.map((template, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedTemplateIndex(index)}
                    className={[
                      "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all hover:bg-muted",
                      selectedTemplateIndex === index
                        ? "border-primary ring-2 ring-primary bg-muted"
                        : "border-border",
                    ].join(" ")}
                  >
                    <span className="text-2xl leading-none">{template.icon}</span>
                    <span className="text-xs font-medium leading-tight">{template.name}</span>
                  </button>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreateCard}>
                  취소
                </Button>
                <Button
                  onClick={() => setCreateStep(2)}
                  disabled={selectedTemplateIndex === null}
                >
                  다음
                </Button>
              </DialogFooter>
            </div>
          )}

          {createStep === 2 && (
            <div className="flex flex-col gap-3">
              {/* 선택된 템플릿 미리보기 */}
              {selectedTemplateIndex !== null && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <span className="text-lg leading-none">{CARD_TEMPLATES[selectedTemplateIndex].icon}</span>
                  <span className="text-sm font-medium">{CARD_TEMPLATES[selectedTemplateIndex].name}</span>
                  <button
                    type="button"
                    onClick={() => setCreateStep(1)}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    변경
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">카테고리</Label>
                <Select
                  value={newCard.categoryId}
                  onValueChange={(v) => setNewCard({ ...newCard, categoryId: v ?? "" })}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="카테고리 선택">
                      {newCard.categoryId
                        ? (categories.find((c) => c.id === newCard.categoryId)?.name ?? null)
                        : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.icon} {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">제목</Label>
                <Input
                  value={newCard.title}
                  onChange={(e) => setNewCard({ ...newCard, title: e.target.value })}
                  placeholder="카드 제목"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">태그 (쉼표로 구분)</Label>
                <Input
                  value={newCard.tags}
                  onChange={(e) => setNewCard({ ...newCard, tags: e.target.value })}
                  placeholder="예: 매출, 2026년"
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateStep(1)}>
                  이전
                </Button>
                <Button
                  onClick={handleCreateCard}
                  disabled={creatingCard || !newCard.categoryId || !newCard.title.trim()}
                >
                  {creatingCard ? <Spinner /> : "추가"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 폴더 생성 다이얼로그 */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>새 폴더 만들기</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">폴더 이름</Label>
              <Input
                value={newFolder.name}
                onChange={(e) => setNewFolder({ ...newFolder, name: e.target.value })}
                placeholder="예: 기업정보"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">아이콘 (이모지, 선택)</Label>
              <Input
                value={newFolder.icon}
                onChange={(e) => setNewFolder({ ...newFolder, icon: e.target.value })}
                placeholder="예: 🏢"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFolder(false)}>
              취소
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolder.name.trim()}
            >
              {creatingFolder ? <Spinner /> : "만들기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FileRow({ card, onDelete }: { card: OmnisCard; onDelete: () => void }) {
  const router = useRouter()

  function handleClick() {
    router.push(`/omnis/${card.id}`)
  }

  const updatedDate = format(new Date(card.updatedAt), "MM/dd")

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent/30 transition-colors cursor-pointer"
      onClick={handleClick}
    >
      {/* 파일 아이콘 */}
      <HugeiconsIcon icon={File01Icon} size={18} className="text-sky-400 shrink-0" />

      {/* 제목 */}
      <span className="flex-1 text-sm font-medium truncate">{card.title}</span>

      {/* 태그 */}
      <div className="hidden sm:flex items-center gap-1 flex-wrap max-w-[200px]">
        {card.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
            {tag}
          </Badge>
        ))}
        {card.tags.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{card.tags.length - 3}</span>
        )}
      </div>

      {/* 버전 */}
      <span className="hidden md:block text-[11px] text-muted-foreground shrink-0 w-8 text-right">
        v{card.version}
      </span>

      {/* 날짜 */}
      <span className="text-[11px] text-muted-foreground shrink-0 w-10 text-right">
        {updatedDate}
      </span>

      {/* 수정자 */}
      <span className="hidden lg:block text-[11px] text-muted-foreground shrink-0 w-16 truncate text-right">
        {card.updatedBy?.name ?? "-"}
      </span>

      {/* 삭제 버튼 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
      >
        <HugeiconsIcon icon={Delete02Icon} size={14} />
      </button>
    </div>
  )
}
