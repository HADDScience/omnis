// AI 활용 설문을 누가 볼 수 있나 — 시범 기간에는 허용한 계정만(작업지시자 2026-11-11).
// 순수(prisma 없음). 시험: lib/ai-survey/access.test.ts
//
//   AI_SURVEY_ALLOW_USER_IDS   쉼표(또는 공백)로 나눈 User.id 목록. "*" 는 전원.
// 값이 없으면 아무에게도 열지 않는다 — 설정을 빠뜨린 배포가 전원에게 여는 일이 없게.
// 누구인지(이름 · id)는 코드와 저장소에 두지 않고 배포 환경변수에만 둔다. 바꾸면 새 배포부터 먹는다.
// 허용 밖 사용자에게는 진입 줄을 그리지 않고, 화면과 API 는 404 다(있는지도 알리지 않는다).

export const SURVEY_ALLOW_ENV = "AI_SURVEY_ALLOW_USER_IDS"

/** env 를 인자로 받는다 — 시험이 process.env 를 건드리지 않게 */
export function surveyAllowList(env: Record<string, string | undefined> = process.env): { all: boolean; ids: Set<string> } {
  const parts = (env[SURVEY_ALLOW_ENV] ?? "").split(/[\s,]+/).filter(Boolean)
  return { all: parts.includes("*"), ids: new Set(parts.filter((p) => p !== "*")) }
}

export function surveyAllowed(userId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!userId) return false
  const list = surveyAllowList(env)
  return list.all || list.ids.has(userId)
}
