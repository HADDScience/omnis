import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"

/**
 * Omnis 로고 타일 — 그라데이션 바탕 위의 흰 마크. 홈 화면 아이콘과 같은 얼굴이다.
 *
 * 크기와 모서리는 쓰는 자리가 `className` 으로 정한다 (사이드바 26px · 랜딩 머리말 28px …).
 * 바로 옆에 "Omnis" 글자가 늘 붙어 있으므로 그림은 스크린리더에서 감춘다 — 두 번 읽히지 않게.
 *
 * 회사 공통 로그인 화면에는 쓰지 않는다 (app/(auth)/login/page.tsx 주석).
 */
export function OmnisMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-[image:var(--brand-gradient)]",
        className
      )}
    >
      {/*
        마크 크기는 타일 기준 비율로 준다. 퍼센트 **패딩**은 쓰지 않는다 — 패딩의 % 는 자기가
        아니라 부모 너비 기준이라, 넓은 부모(꼬리말) 안에서는 타일이 부풀고 마크가 사라졌다.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={apiUrl("/omnis-logo.png")} alt="" className="size-[70%] object-contain" />
    </span>
  )
}
