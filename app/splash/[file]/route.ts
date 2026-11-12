import { readFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"

import { brand } from "@/lib/brand"
import { SPLASH_BACKGROUND, SPLASH_TILE_PX, findSplashImage, splashImages } from "@/lib/pwa-splash"

/**
 * iOS 시작 이미지 — /splash/<가로>x<세로>-<light|dark>.png. lib/pwa-splash.ts 의 기기 목록에서 빌드 때 전부 만들어 둔다.
 * 그림을 저장소에 넣지 않고 여기서 그리는 까닭: 로고 판(NEXT_PUBLIC_BRAND)을 바꾸면 시작 이미지도 따라 바뀌어야 한다.
 * 바탕 한 색 + 가운데 앱 타일(SPLASH_TILE_PX) — 첫 HTML 의 스플래시(components/layout/app-splash.tsx)와 같은 자리 · 크기다.
 */
export const dynamic = "force-static"
export const dynamicParams = false

export function generateStaticParams() {
  return splashImages().map((i) => ({ file: i.file }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const image = findSplashImage(file)
  if (!image) return new Response("Not found", { status: 404 })

  const iconSrc = brand.manifestIcons.find((i) => i.sizes === "512x512" && i.purpose === "any")?.src ?? "/icon-512.png"
  const icon = await readFile(path.join(process.cwd(), "public", iconSrc))
  const tile = Math.round(SPLASH_TILE_PX * image.ratio)
  const mark = await sharp(icon).resize(tile, tile).png().toBuffer()

  const png = await sharp({
    create: { width: image.width, height: image.height, channels: 3, background: SPLASH_BACKGROUND[image.theme] },
  })
    .composite([{ input: mark, left: Math.round((image.width - tile) / 2), top: Math.round((image.height - tile) / 2) }])
    .png({ compressionLevel: 9, palette: true })
    .toBuffer()

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // 이름에 크기 · 테마만 있고 로고 판은 없다 — 판을 바꾼 배포 뒤에도 하루면 새 그림을 받는다
      "Cache-Control": "public, max-age=86400",
    },
  })
}
