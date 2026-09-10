import { test, expect } from "@playwright/test"
import { type Actor, createActor, loadAccounts } from "./_actors"
import { CAST, newTag, runKickoff } from "./_kickoff"
import { loadAskQuestions, runOmnisAsk, type AskQuestion } from "./_omnis-ask"

/**
 * 도입 시나리오 전체 — 킥오프(4명 동시 지시·분배·보고·취합) 뒤에 같은 4명이 옴니스 AI 에게 묻는다.
 *
 * 질문은 두 종류다.
 *   1. 방금 끝난 킥오프에 대한 질문 — 실행 태그가 붙어 있어 방금 만든 자료를 AI 가 찾는지 본다
 *   2. 회사에 대한 질문 — 질문 파일(저장소 밖)의 것
 * 두 단계의 시간·토큰·정확도를 리포트 annotation 과 tests/scenario/reports/ 에 남긴다.
 */
test.describe("도입 시나리오 전체 — 킥오프 → 옴니스 AI 질의", () => {
  test.describe.configure({ timeout: 25 * 60_000 })

  test("4명이 일을 끝낸 뒤 그 일과 회사에 대해 AI 에게 묻는다", async ({ browser }) => {
    const pw = loadAccounts()
    const actors: Actor[] = []
    try {
      const [ceo, lead, woochang, hyerin] = await Promise.all(CAST.map((n) => createActor(browser, n, pw[n])))
      actors.push(ceo, lead, woochang, hyerin)
      const tag = newTag()

      // ── 1. 킥오프 ─────────────────────────────────────────────
      const k = await runKickoff({ ceo, lead, woochang, hyerin }, tag, test.info())
      test.info().annotations.push({ type: "킥오프 시간", description: `${(k.ms / 1000).toFixed(0)}s` })

      // ── 2. 옴니스 AI 질의 — 방금 한 일 + 회사 ───────────────────────
      const aboutKickoff: AskQuestion[] = [
        { actor: ceo.name, q: `[${tag}] 치매진단플랫폼 과제 킥오프 업무는 어떻게 됐어? 누가 뭘 했어?`, expect: ["완료", "정우창", "노혜린"] },
        { actor: lead.name, q: `[${tag}] 자가검사 앱 화면 프로토타입은 어디까지 됐어?`, expect: ["완료", "Figma"] },
        { actor: hyerin.name, q: `[${tag}] 뉴로힐 검사 키트 사양서는 몇 세트 기준으로 정리했어?`, expect: ["20"] },
        { actor: woochang.name, q: `[${tag}] 킥오프에서 대표님이 잡은 컨셉이 뭐였어?`, expect: ["10분", "자가검사"] },
      ]
      const s = await runOmnisAsk(actors, [...aboutKickoff, ...loadAskQuestions()], test.info(), { reportTag: `${tag}-full` })
      for (const a of test.info().annotations) console.log(`[시나리오] ${a.type}: ${a.description}`)
      expect(s.errors, "질의 오류").toBe(0)
    } finally {
      await Promise.all(actors.map((a) => a.context.close()))
    }
  })
})
