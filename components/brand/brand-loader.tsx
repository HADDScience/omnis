import { Spinner } from "@/components/ui/spinner"
import { brand } from "@/lib/brand"
import { OmnisLoader } from "./omnis-loader"

/**
 * 화면 · 칸을 채우는 로딩 표시. 지금 로고(v1)는 기존 Spinner 그대로, 새 로고(v2)는 OmnisLoader.
 * 단추 안의 작은 돌림표는 Spinner 를 그대로 쓴다 — 글자 높이의 로고는 알아보기 어렵다.
 *
 * `className` 은 v1 Spinner 에 그대로 간다(지금 크기 유지). v2 는 `size`(px)를 쓴다.
 */
export function BrandLoader({ className, size = 20, label }: { className?: string; size?: number; label?: string }) {
  if (brand.loader === "omnis") return <OmnisLoader size={size} label={label} className="shrink-0" />
  return <Spinner className={className} />
}
