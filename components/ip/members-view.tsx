"use client"

import { useCallback, useEffect, useState } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/ip/page-header"
import { useAuth } from "@/components/ip/auth-gate"
import { api, OmnisError } from "@/lib/ip/omnis"
import { cn } from "@/lib/utils"

const ROLES = ["owner", "editor", "viewer"] as const
type Role = (typeof ROLES)[number]

const ROLE_LABEL: Record<string, string> = {
  owner: "관리자",
  editor: "편집",
  viewer: "읽기 전용",
}

interface MemberRow {
  user_id: string
  email: string
  display_name: string | null
  role: string
  omnis_name: string
}

/** 아직 구성원이 아닌 Omnis 계정. 여기서 골라 접근을 준다. */
interface CandidateRow {
  id: string
  name: string
  email: string | null
  department: string | null
  position: string | null
}

/**
 * 구성원 관리.
 *
 * 「접근 신청 → 승인」 절차가 사라졌다. 예전에는 소셜 로그인으로 아무나 들어와
 * 신청서를 쓰고, 관리자가 이름과 남긴 말로 본인을 확인해 승인했다. 계정을 관리자가
 * 만드는 Omnis 계정 하나로 모으면서 그 확인이 계정 발급 시점으로 앞당겨졌다 —
 * 여기서 하는 일은 「이미 있는 Omnis 계정에게 이 자료를 열어 준다」뿐이다.
 *
 * 그래서 신원을 되묻지 않는다. 이름·이메일은 Omnis 계정에서 그대로 가져온다.
 */
export function MembersView() {
  const { isOwner, member } = useAuth()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [addChoice, setAddChoice] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const data = await api<{ members: MemberRow[]; candidates: CandidateRow[] }>(
        "/members"
      )
      setMembers(data.members)
      setCandidates(data.candidates)
      setError(null)
    } catch (err) {
      setError(err instanceof OmnisError ? err.message : "불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  // 첫 적재는 effect 안에서 직접 한다. load() 를 그대로 부르면 린터가
  // "effect 안에서 setState 를 부른다"고 잡는데, 그 경고의 취지(정리되지 않은
  // 비동기 갱신)는 cancelled 로 막는다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api<{ members: MemberRow[]; candidates: CandidateRow[] }>(
          "/members"
        )
        if (cancelled) return
        setMembers(data.members)
        setCandidates(data.candidates)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof OmnisError ? err.message : "불러오지 못했습니다.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** role 이 null 이면 접근 해제다. */
  async function setRole(userId: string, role: Role | null) {
    setBusy(userId)
    setError(null)
    try {
      await api("/members", { method: "POST", body: { userId, role } })
      await load()
    } catch (err) {
      setError(err instanceof OmnisError ? err.message : "바꾸지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="멤버" description="관리자만 접근할 수 있는 화면입니다." />
        <div className="py-14 text-center text-muted-foreground rounded-xl border bg-card">
          권한이 없습니다.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="멤버"
        description="HADD 계정에 지식재산권 자료 접근을 열어 줍니다. 계정 자체는 관리자가 만들고, 여기서는 누가 이 자료를 볼 수 있는지만 정합니다."
      />

      {error ? (
        <Card className="ring-red-500/25">
          <CardContent className="text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">불러오는 중…</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>멤버 {members.length}명</CardTitle>
          <CardDescription>역할을 바꾸거나 접근을 해제할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border/60">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0"
            >
              <span className="font-medium">{m.omnis_name}</span>
              <span className="text-[12px] text-muted-foreground">{m.email}</span>
              {m.user_id === member.userId ? <Badge variant="secondary">나</Badge> : null}

              <div className="ml-auto flex items-center gap-2">
                <Select
                  items={Object.fromEntries(ROLES.map((x) => [x, ROLE_LABEL[x]]))}
                  value={m.role}
                  onValueChange={(v) => void setRole(m.user_id, String(v) as Role)}
                  disabled={busy === m.user_id || m.user_id === member.userId}
                >
                  <SelectTrigger size="sm" className="min-w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {ROLE_LABEL[x]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="xs"
                  variant="ghost"
                  className={cn("text-red-600 dark:text-red-400")}
                  disabled={busy === m.user_id || m.user_id === member.userId}
                  onClick={() => void setRole(m.user_id, null)}
                >
                  해제
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>추가할 수 있는 계정 {candidates.length}명</CardTitle>
          <CardDescription>
            아직 이 자료에 접근할 수 없는 Omnis 구성원입니다. 계정을 새로 만들려면
            Omnis 에서 먼저 만드세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border/60">
          {candidates.length === 0 ? (
            <p className="py-3 text-muted-foreground">
              모든 Omnis 구성원이 이미 접근할 수 있습니다.
            </p>
          ) : (
            candidates.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0"
              >
                <span className="font-medium">{c.name}</span>
                {c.department ? (
                  <Badge variant="outline">{c.department}</Badge>
                ) : null}
                {c.position ? (
                  <span className="text-[12px] text-muted-foreground">{c.position}</span>
                ) : null}
                <span className="text-[12px] text-muted-foreground">{c.email ?? ""}</span>

                <div className="ml-auto flex items-center gap-2">
                  <Select
                    items={Object.fromEntries(ROLES.map((x) => [x, ROLE_LABEL[x]]))}
                    value={addChoice[c.id] ?? "editor"}
                    onValueChange={(v) =>
                      setAddChoice((s) => ({ ...s, [c.id]: String(v) }))
                    }
                  >
                    <SelectTrigger size="sm" className="min-w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((x) => (
                        <SelectItem key={x} value={x}>
                          {ROLE_LABEL[x]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="xs"
                    disabled={busy === c.id}
                    onClick={() =>
                      void setRole(c.id, (addChoice[c.id] ?? "editor") as Role)
                    }
                  >
                    접근 허용
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
