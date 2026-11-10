"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons"
import { apiUrl } from "@/lib/base-path"
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-policy"

/**
 * 본인 비밀번호 변경 폼. `required` 면 관리자가 정해 준 임시 비밀번호를 쓰는 중이라
 * 바꾼 뒤 앱으로 돌려보낸다. 막지는 않는다(2026-11-06 핫픽스).
 */
export function ChangePasswordForm({ required }: { required: boolean }) {
  const router = useRouter()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const problem = passwordProblem(next, current)
    if (problem) return setError(problem)
    if (next !== confirm) return setError("새 비밀번호 두 칸이 서로 다릅니다.")

    setLoading(true)
    const res = await fetch(apiUrl("/api/account/password"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current, next }),
    }).catch(() => null)
    setLoading(false)
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null
      return setError(body?.error ?? "바꾸지 못했습니다. 잠시 뒤 다시 시도하세요.")
    }
    setCurrent("")
    setNext("")
    setConfirm("")
    setDone(true)
    if (required) {
      router.push("/chat")
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PasswordField id="current-password" label="지금 비밀번호" autoComplete="current-password" value={current} onChange={setCurrent} />
      <PasswordField id="new-password" label="새 비밀번호" autoComplete="new-password" value={next} onChange={setNext} minLength={PASSWORD_MIN}
        hint={`${PASSWORD_MIN}자 이상. 다른 곳에서 쓰지 않는 문장형을 권합니다.`} />
      <PasswordField id="confirm-password" label="새 비밀번호 확인" autoComplete="new-password" value={confirm} onChange={setConfirm} />
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive">
          {error}
        </p>
      )}
      {done && !required && (
        <p role="status" className="text-[12.5px] text-muted-foreground">비밀번호를 바꿨습니다.</p>
      )}
      <Button type="submit" disabled={loading} className="h-11">
        {loading ? <Spinner className="h-4 w-4" /> : null}
        비밀번호 바꾸기
      </Button>
    </form>
  )
}

/** 눈 아이콘으로 글자를 보이거나 숨기는 비밀번호 칸. 칸마다 따로 켠다 */
function PasswordField({ id, label, autoComplete, value, onChange, minLength, hint }: {
  id: string
  label: string
  autoComplete: string
  value: string
  onChange: (v: string) => void
  minLength?: number
  hint?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value}
          onChange={(e) => onChange(e.target.value)} required minLength={minLength} className="h-11 pr-11" />
        <button
          type="button"
          aria-label={`${label} ${visible ? "숨기기" : "보기"}`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          <HugeiconsIcon icon={visible ? ViewOffIcon : ViewIcon} size={17} aria-hidden />
        </button>
      </div>
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
