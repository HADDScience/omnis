"use client"

// 사진 미리보기 img — WebP 미리보기(/thumb)를 폭에 맞춰 고르고, 못 받으면 원본으로 한 번 바꿔 그린다.
// 누르면 여는 원본 · 내려받기는 부르는 쪽이 /raw 로 건다.
import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react"
import { thumbSrcSet, thumbUrl } from "@/lib/thumb"

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes"> & {
  fileId: string
  /** 미리보기를 못 받을 때 쓸 원본 주소 */
  original: string
  /** 그려질 폭(css px). srcset 의 1배 · 2배 단계를 고른다 */
  cssWidth: number
}

export function ThumbImage({ fileId, original, cssWidth, onError, alt = "", ...rest }: Props) {
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLImageElement>(null)
  // React 가 onError 를 달기 전에 실패한 이미지는 이벤트를 놓친다 — 붙은 뒤 한 번 본다.
  // naturalWidth 로 가르지 않는다: srcset(480w)이면 아주 작은 그림은 잘 받아도 0 이다. 깨진 그림만 decode 가 거절한다
  useEffect(() => {
    const el = ref.current
    if (el?.complete && el.currentSrc) el.decode().catch(() => setFailed(true))
  }, [])
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      ref={ref}
      alt={alt}
      src={failed ? original : thumbUrl(fileId, cssWidth)}
      srcSet={failed ? undefined : thumbSrcSet(fileId, cssWidth)}
      sizes={failed ? undefined : `${cssWidth}px`}
      onError={(e) => {
        if (!failed) setFailed(true)
        onError?.(e)
      }}
    />
  )
}
