"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiUrl } from "@/lib/base-path"
import { toast } from "sonner"
import { buildMcpClients, SERVER_NAME, type McpClient } from "./mcp-clients"

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
    return true
  } catch {
    toast.error("복사하지 못했어요. 직접 선택해서 복사해 주세요.")
    return false
  }
}

/** 커맨드 한 덩어리. 긴 줄은 이 칸 안에서만 가로로 밀린다 — 창 전체가 밀리지 않게(규칙 30). */
function CommandBlock({ command }: { command: string }) {
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">
        {command}
      </pre>
      <Button
        variant="outline"
        className="touch-target min-h-11 w-full"
        onClick={() => void copyText(command, "커맨드를 복사했어요.")}
      >
        커맨드 복사
      </Button>
    </div>
  )
}

/**
 * 도구 하나의 안내. 탭마다 모양은 같고 내용만 다르다 — 규칙 25 의 「데이터 동일」 예외로
 * 한 컴포넌트에 데이터를 넣는다.
 */
function ClientGuide({ client }: { client: McpClient }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {client.command ? (
        <>
          <p className="text-muted-foreground">
            터미널에 붙여넣으세요. <b className="text-foreground">토큰은 필요 없어요.</b>
          </p>
          <CommandBlock command={client.command} />
        </>
      ) : null}
      {client.install ? (
        <>
          <p className="text-muted-foreground">버튼 한 번으로 설치돼요.</p>
          <a
            href={client.install}
            className="touch-target inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {client.name} 에 설치
          </a>
        </>
      ) : null}
      {client.steps ? <div className="text-muted-foreground">{client.steps}</div> : null}
      <div className="flex items-start gap-2 border-l-2 border-primary/40 bg-muted/40 py-1.5 pl-2 text-xs leading-relaxed">
        <span className="shrink-0 font-medium">그다음</span>
        <span className="text-muted-foreground">{client.auth}</span>
      </div>
      {client.note ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{client.note}</p>
      ) : null}
      <Button
        variant="ghost"
        className="touch-target min-h-11 w-full"
        onClick={() => void copyText(client.prompt, "AI 에게 넘길 안내를 복사했어요.")}
      >
        프롬프트 복사 — AI 에게 대신 붙여 달라고 하기
      </Button>
    </div>
  )
}

export default function McpDialog({
  onClose,
  closeLabel = "닫기",
}: {
  onClose: () => void
  /** 온보딩에서 열었을 때는 「온보딩으로 돌아가기」 */
  closeLabel?: string
}) {
  const [url, setUrl] = useState("")
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState("claude-code")
  const clients = useMemo(() => (url ? buildMcpClients(url) : []), [url])
  useEffect(() => {
    const controller = new AbortController()
    fetch(apiUrl("/api/onboarding"), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("MCP 주소 조회 실패")
        const data = await res.json()
        if (
          typeof data.mcpUrl !== "string" ||
          !/^https?:\/\//.test(data.mcpUrl)
        )
          throw new Error("MCP 주소 오류")
        setUrl(data.mcpUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [attempt])
  async function copy() {
    if (await copyText(url, "MCP 서버 주소를 복사했어요.")) setCopied(true)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="z-[var(--z-dialog)] max-h-[85svh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Omnis MCP 등록</DialogTitle>
          <DialogDescription>
            쓰는 AI 도구에 Omnis 의 업무·채팅·지식을 연결하세요. 도구가 달라도 붙는 서버는 하나이고,
            이름은 <b>{SERVER_NAME}</b> 로 맞춰 주세요.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <div role="alert" className="space-y-2">
            <p>서버 주소를 불러오지 못했어요.</p>
            <Button
              variant="outline"
              className="touch-target min-h-11"
              onClick={() => {
                setFailed(false)
                setAttempt((value) => value + 1)
              }}
            >
              다시 불러오기
            </Button>
          </div>
        ) : !url ? (
          <p role="status">MCP 서버 주소를 불러오는 중…</p>
        ) : (
          <>
            {/* 대화상자는 grid 라 자식이 내용 폭 밑으로 줄지 않는다. min-w-0 이 없으면 390px 에서 탭 줄·긴 커맨드가 창을 564px 로 밀었다. */}
            <div className="min-w-0 space-y-2">
              <label htmlFor="omnis-mcp-url" className="text-xs font-medium">
                MCP 서버 주소
              </label>
              <Input
                id="omnis-mcp-url"
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 text-xs"
              />
              <Button onClick={copy} className="touch-target min-h-11 w-full">
                {copied ? "주소 복사됨 · 다시 복사" : "서버 주소 복사"}
              </Button>
            </div>
            <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-w-0">
              {/* 도구가 일곱이라 좁은 화면에서는 줄을 바꿔 쌓는다 — 가로로 밀리지 않게.
                  탭의 기본 높이 h-[calc(100%-1px)] 는 목록 높이를 따라가서, 줄이 바뀌면 탭이 한 줄 높이로 늘어나
                  둘째 줄이 본문을 덮었다(390px). 그래서 h-auto 로 덮는다. */}
              <TabsList variant="line" aria-label="AI 도구" className="h-auto w-full flex-wrap justify-start">
                {clients.map((client) => (
                  <TabsTrigger key={client.id} value={client.id} className="touch-target h-auto min-h-9 flex-none px-3">
                    {client.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {clients.map((client) => (
                <TabsContent key={client.id} value={client.id} className="pt-2">
                  <ClientGuide client={client} />
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          승인은 Omnis 계정으로 해요. 내 계정 권한 안에서 업무·지식을 쓰고, 지식재산권은 해당 구성원 권한이 필요해요.
          이 안내창을 여는 것만으로 등록되지는 않아요.
        </p>
        <Button variant="outline" className="touch-target min-h-11" onClick={onClose}>
          {closeLabel}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
