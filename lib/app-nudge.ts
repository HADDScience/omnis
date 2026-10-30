// 앱 설치 · 기기 알림 권유(2026-10-30 작업지시자) — 순수 규칙만 둔다. 화면: components/layout/app-nudge.tsx
//
// 「옴니스를 처음 들어가면 앱 설치를 권하고, 더 이상 안 보기를 누를 때까지 뜬다. 설치하면 알림 설정도 같은 방식으로」.
//   - 설치 전(브라우저 탭): 설치 권유
//   - 설치 뒤(홈 화면 아이콘으로 염): 알림 권유 — 이 기기가 아직 알림을 받지 않을 때만
//   - 「다음에」 는 이번 접속(탭 세션)에만, 「더 이상 안 보기」 는 이 기기에서 영영. 설치 · 알림은 기기마다라 기기에 남긴다
//   - 자동화 브라우저(e2e)에는 띄우지 않는다 — 대화상자가 시험 화면을 가린다
//   - 이미 한 것은 권하지 않는다(2026-10-30 작업지시자): 설치했거나 이 기기에서 알림을 받고 있으면 설치 권유를,
//     알림 권한을 이미 허용(또는 차단)한 기기는 알림 권유를 숨긴다. 허용했는데 구독이 없으면 설정 화면에서 끈 것일 수 있어
//     다시 구독하지 않는다 — 켜고 끄기는 설정 › 기기 알림이 맡는다

export type NudgeStage = "install" | "push"

export interface NudgeInput {
  /** 홈 화면 아이콘으로 열렸는가(lib/pwa.ts isStandalone) */
  standalone: boolean
  /** 탭으로 열었어도 이 기기에 설치한 흔적이 있는가(lib/pwa.ts detectInstalled) */
  installed: boolean
  /** 「더 이상 안 보기」 를 누른 단계 */
  off: Record<NudgeStage, boolean>
  /** 이번 접속에 「다음에」 를 누른 단계 */
  later: Record<NudgeStage, boolean>
  /** 이 브라우저가 푸시를 받을 수 있는가(lib/pwa.ts pushSupported) */
  pushSupported: boolean
  /** 서버에 푸시 키가 있는가(GET /api/push/subscriptions configured) */
  pushConfigured: boolean
  permission: NotificationPermission | null
  /** 이 기기에 구독이 있는가 */
  subscribed: boolean
  /** navigator.webdriver */
  automated: boolean
}

export function decideNudge(input: NudgeInput): NudgeStage | null {
  if (input.automated) return null
  const receiving = input.permission === "granted" && input.subscribed
  if (!input.standalone) {
    // 설치했거나(앱은 따로 열어 쓴다) 이 탭으로 이미 알림을 받고 있으면 설치를 권할 까닭이 없다
    if (input.installed || receiving) return null
    return input.off.install || input.later.install ? null : "install"
  }
  if (input.off.push || input.later.push) return null
  if (!input.pushSupported || !input.pushConfigured) return null
  // 이미 답한 권한 — 허용이면 설정을 한 것이고(구독이 없으면 설정 화면에서 끈 것일 수 있다),
  // 차단이면 화면에서 다시 물을 수 없다. 어느 쪽이든 권해 봐야 누를 것이 없다
  if (input.permission !== "default") return null
  return "push"
}

export const nudgeOffKey = (stage: NudgeStage) => `omnis:nudge-off:${stage}`
export const nudgeLaterKey = (stage: NudgeStage) => `omnis:nudge-later:${stage}`
