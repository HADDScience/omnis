/**
 * 목록의 기본 줄 차례. 현황(첫 화면)과 IP 화면이 같은 기본을 쓴다.
 *
 * 등록 > 출원 > 검토 > 거절·포기·중단, 묶음 안에서는 더 나아간 단계가 먼저.
 * ip.status_options 의 단계를 전부 적어 둔다. 여기 없는 단계가 새로 생기면
 * groupOf 로 묶음을 정해 그 묶음 끝에 붙인다. 사람마다 바꾼 차례는
 * 「단계 순서 설정」으로 계정에 저장되고, 이 기본보다 앞선다.
 */
export const DEFAULT_STAGE_ORDER = [
  "등록",
  "심사중",
  "보정서제출",
  "의견제출통지",
  "출원공고",
  "출원",
  "출원준비",
  "검토의견",
  "검토요청",
  "아이디어",
  "거절확정",
  "포기·중단",
]

/** 단계 묶음. 앞에 있을수록 먼저 온다. */
export function groupOf(stage: string): number {
  if (stage === "등록" || stage === "등록완료") return 0
  if (/거절|포기|중단/.test(stage)) return 3
  if (/검토|아이디어/.test(stage)) return 2
  return 1
}

/** 주어진 단계들을 기본 차례로 세운다. `weight` 는 묶음 안 미지 단계의 순서(클수록 앞) */
export function sortByDefault(
  values: string[],
  weight: (v: string) => number = () => 0
): string[] {
  const fixed = (v: string) => {
    const i = DEFAULT_STAGE_ORDER.indexOf(v)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...new Set(values)].sort(
    (a, b) =>
      groupOf(a) - groupOf(b) ||
      fixed(a) - fixed(b) ||
      weight(b) - weight(a) ||
      a.localeCompare(b, "ko")
  )
}
