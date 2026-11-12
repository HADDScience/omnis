/** 나눠 그리는 목록의 다음 개수 — 남은 것이 한 번 몫의 절반도 안 되면 한꺼번에 그린다(끝에서 또 기다리지 않게) */
export function nextRevealCount(current: number, total: number, step: number): number {
  if (current >= total) return total
  const next = current + step
  return total - next < step / 2 ? total : next
}
