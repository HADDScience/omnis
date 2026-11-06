"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-policy"

/**
 * 본인 비밀번호 변경 폼. `required` 면 관리자가 정해 준 비밀번호로 들어온 경우라
 * 바꾸기 전에는 다른 화면으로 갈 수 없다((main)/layout.tsx 가 이리로 보낸다).
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="current-password">지금 비밀번호</Label>
        <Input id="current-password" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} required className="h-11" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">새 비밀번호</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} required minLength={PASSWORD_MIN} className="h-11" />
        <p className="text-[12px] text-muted-foreground">{PASSWORD_MIN}자 이상. 다른 곳에서 쓰지 않는 문장형을 권합니다.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required className="h-11" />
      </div>
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
