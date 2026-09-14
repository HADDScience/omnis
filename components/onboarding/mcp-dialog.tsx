"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { apiUrl } from "@/lib/base-path"
import { toast } from "sonner"

export default function McpDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("")
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(apiUrl("/api/onboarding"), { signal: controller.signal }).then(async res => {
      if (!res.ok) throw new Error("MCP 주소 조회 실패")
      const data = await res.json()
      if (typeof data.mcpUrl !== "string" || !/^https?:\/\//.test(data.mcpUrl)) throw new Error("MCP 주소 오류")
      setUrl(data.mcpUrl)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [attempt])
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); toast.success("MCP 서버 주소를 복사했어요.") }
    catch { toast.error("복사하지 못했어요. 주소를 직접 선택해서 복사해 주세요.") }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="z-[var(--z-dialog)] max-h-[85svh] overflow-y-auto" showCloseButton={false}>
      <DialogHeader><DialogTitle>Omnis MCP 등록</DialogTitle><DialogDescription>사용하는 AI에 Omnis의 업무와 지식을 연결하세요.</DialogDescription></DialogHeader>
      <ol className="space-y-4 text-sm leading-relaxed">
        <li><strong>1. AI 앱의 커넥터 설정을 여세요.</strong><p className="mt-1 text-muted-foreground">Claude에서는 설정 → 커넥터 → 커스텀 커넥터 추가로 이동하세요.</p></li>
        <li><strong>2. 아래 MCP 서버 주소를 등록하세요.</strong><p className="mt-1 text-muted-foreground">커넥터 이름은 Omnis로 입력하세요.</p></li>
        <li><strong>3. Omnis 계정으로 로그인하고 연결을 승인하세요.</strong><p className="mt-1 text-muted-foreground">내 계정 권한 안에서 업무·지식을 사용할 수 있어요. 지식재산권은 해당 구성원 권한이 필요해요.</p></li>
      </ol>
      {failed ? <div role="alert" className="space-y-2"><p>서버 주소를 불러오지 못했어요.</p><Button variant="outline" className="min-h-11" onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>다시 불러오기</Button></div> : !url ? <p role="status">MCP 서버 주소를 불러오는 중…</p> : <div className="space-y-2"><label htmlFor="omnis-mcp-url" className="text-xs font-medium">MCP 서버 주소</label><Input id="omnis-mcp-url" readOnly value={url} onFocus={event => event.currentTarget.select()} className="min-h-11 text-xs" /><Button onClick={copy} className="min-h-11 w-full">{copied ? "주소 복사됨 · 다시 복사" : "서버 주소 복사"}</Button></div>}
      <p className="text-xs leading-relaxed text-muted-foreground">연결은 AI 앱에서 마무리해 주세요. 이 안내창을 여는 것만으로 등록되지는 않아요.</p>
      <Button variant="outline" className="min-h-11" onClick={onClose}>닫기</Button>
    </DialogContent>
  </Dialog>
}
