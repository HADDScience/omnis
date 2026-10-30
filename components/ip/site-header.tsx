"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Download04Icon,
  HelpCircleIcon,
  LinkSquare02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Header } from "@/components/layout/header"
import { RecordButton } from "@/components/ip/record-fab"
import { McpInstall } from "@/components/ip/mcp-install"
import { Tutorial } from "@/components/ip/tutorial"
import { useAuth } from "@/components/ip/auth-gate"
import { useData } from "@/components/ip/data-provider"
import { useToday } from "@/hooks/ip/use-today"
import { exportAll, exporterName } from "@/lib/ip/excel"

const LEGACY_IP_URL = "https://haddscience.github.io/ip-platform/"

export function SiteHeader() {
  const today = useToday()
  const { member } = useAuth()
  const { trademarks, patents, refresh, reloading } = useData()
  const [busy, setBusy] = useState(false)
  // 첫 안내는 저절로 한 번 뜨고 끝난다. 다시 보고 싶을 때 여는 자리가 필요하다.
  const [help, setHelp] = useState(false)

  async function onExportAll() {
    setBusy(true)
    try {
      // 파일명 끝에 내려받은 사람을 적는다 — 기준 워크북의 관행이다.
      await exportAll({ trademarks, patents }, today, exporterName(member))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/*
        옴니스 제목줄 하나에 합쳤다 — 예전 IP 머리줄(조직명 · 앱 이름 · 버튼 줄)은 옴니스
        제목줄과 겹쳐 두 줄이 됐다. 버튼은 같은 것을 같은 순서로 오른쪽 칸에 둔다.
        오늘 날짜와 내 이름은 탭 띠 오른쪽(SiteNav)으로 옮겼다.
      */}
      <Header
        crumbs={["아카이브", "지식재산권"]}
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="새로고침"
              title="새로고침"
              className="touch-target justify-center"
              disabled={reloading}
              onClick={() => void refresh()}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={reloading ? "animate-spin" : undefined}
              />
            </Button>

            {/*
              어느 화면에 있든 도구를 붙일 수 있게 상단바에 둔다. 기록하기 화면에도
              같은 버튼이 있지만, 그 화면까지 가야만 보이는 것이 문제였다.
            */}
            <McpInstall trigger="header" />

            <Button
              size="sm"
              variant="outline"
              className="touch-target"
              onClick={onExportAll}
              disabled={busy}
              aria-label="전체 엑셀"
            >
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
              <span className="hidden sm:inline">{busy ? "생성 중…" : "전체 엑셀"}</span>
            </Button>

            <RecordButton />

            {/* 옛 화면(GitHub Pages)이 익숙한 사람을 위해 둘 다 운영하는 동안 남겨 두는 길 */}
            <Button
              size="sm"
              variant="ghost"
              className="touch-target"
              render={<a href={LEGACY_IP_URL} target="_blank" rel="noreferrer" />}
              nativeButton={false}
              aria-label="이전 화면으로"
              title="이전 화면으로 (새 탭)"
            >
              <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
              <span className="hidden sm:inline">이전 화면</span>
            </Button>

            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="처음 안내 다시 보기"
              title="처음 안내 다시 보기"
              className="touch-target justify-center"
              onClick={() => setHelp(true)}
            >
              <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
            </Button>
          </div>
        }
      />

      {/* 처음 온 사람에게 저절로 뜨는 쪽 */}
      <Tutorial />
      {/* 물음표로 다시 여는 쪽. 본 표시를 다시 남기지 않는다. */}
      <Tutorial open={help} onOpenChange={setHelp} />
    </>
  )
}
