import { z } from "zod"

/**
 * 사진 설명 — 모델 출력 ↔ File.description 의 단일 진실 소스.
 * 키가 한국어인 것은 프롬프트가 그대로 받아 쓰게 하려고다(실험 prompt2 와 같은 모양,
 * mydocs/working/2026-10-29-photo-describe-bench.md).
 */
export const PhotoDescriptionSchema = z.object({
  /** 문서 · 포스터 · 화면캡처 · 슬라이드 · 제품·로고 · 행사·사람 · 장소·장비 · 손글씨 · 기타 */
  종류: z.string().default(""),
  설명: z.string().default(""),
  사진속글자: z.string().default(""),
  /** 앞뒤 대화로 본 용도. 관계가 안 보이면 빈 문자열 */
  업무: z.string().default(""),
  검색어: z.array(z.string()).default([]),
})
export type PhotoDescription = z.infer<typeof PhotoDescriptionSchema>
