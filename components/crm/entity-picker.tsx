"use client"

import { useState, useMemo } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const CREATE_VALUE = "__create__"

export interface PickerOption {
  id: string
  label: string
  /** 오른쪽에 흐리게 붙는 보조 정보 — 직함·규격·단가 등 */
  hint?: string | null
  /** 검색어에 함께 걸리게 할 문자열 */
  keywords?: string
}

interface Props {
  options: PickerOption[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder: string
  /** 비어 있을 때 버튼에 뜨는 글 */
  emptyLabel?: string
  /**
   * 검색 결과가 없을 때 "«입력한 말» 새로 만들기" 를 띄운다.
   * 엑셀은 마스터 시트에 먼저 등록해야만 드롭다운에 나왔다 — 그 순서를 없애는 것이
   * 이 컴포넌트의 존재 이유다.
   */
  onCreate?: (name: string) => void | Promise<void>
  createLabel?: string
  disabled?: boolean
  className?: string
}

export function EntityPicker({
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  onCreate,
  createLabel = "새로 만들기",
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = useMemo(() => options.find((o) => o.id === value), [options, value])

  const trimmed = query.trim()
  const exact = options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase())

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <span className="truncate">
          {selected ? (
            <>
              {selected.label}
              {selected.hint && (
                <span className="ml-1.5 text-muted-foreground">{selected.hint}</span>
              )}
            </>
          ) : (
            (emptyLabel ?? placeholder)
          )}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={15} className="shrink-0 opacity-50" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width)] min-w-[260px] p-0" align="start">
        <Command
          filter={(v, search) => {
            // "새로 만들기" 줄은 검색어 그 자체가 내용이라 걸러내면 안 된다.
            // 이걸 빼먹으면 결과가 없을 때 안내문만 뜨고 만들 방법이 사라진다.
            if (v.startsWith(CREATE_VALUE)) return 1
            const o = options.find((x) => x.id === v)
            if (!o) return 0
            const hay = `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase()
            return hay.includes(search.toLowerCase()) ? 1 : 0
          }}
        >
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
              결과 없음
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onChange(o.id === value ? null : o.id)
                    setOpen(false)
                    setQuery("")
                  }}
                  className="gap-2"
                >
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={14}
                    className={cn("shrink-0", o.id === value ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{o.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreate && trimmed && !exact && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`${CREATE_VALUE}${trimmed}`}
                    onSelect={async () => {
                      setOpen(false)
                      const name = trimmed
                      setQuery("")
                      await onCreate(name)
                    }}
                    className="gap-2 text-primary"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} size={14} className="shrink-0" aria-hidden />
                    <span className="truncate">
                      &laquo;{trimmed}&raquo; {createLabel}
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
