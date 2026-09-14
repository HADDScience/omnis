import { test, expect } from "@playwright/test"
import { type Actor, createActor, loadAccounts } from "./_actors"
import { CAST, newTag } from "./_kickoff"
import { loadAskQuestions, runOmnisAsk } from "./_omnis-ask"

/**
 * 옴니스 AI 질의 — 4명이 동시에 /omnis/ask 에서 회사에 대해 묻는다. 본문은 _omnis-ask.ts.
 * 질문 파일: E2E_OMNIS_QUESTIONS (기본 ~/work/omnis-import/eval/omnis-ask-260910.json).
 * 보고서: tests/scenario/reports/<태그>-omnis-ask.md (git 밖).
 */
test.describe("옴니스 AI 질의 — 4명 동시", () => {
  test.describe.configure({ timeout: 15 * 60_000 })

  test("각자 회사에 대해 묻고 답변·토큰·지연·정확도를 남긴다", async ({ browser }) => {
    const pw = loadAccounts()
    const actors: Actor[] = []
    try {
      const cast = await Promise.all(CAST.map((n) => createActor(browser, n, pw[n])))
      actors.push(...cast)
      const s = await runOmnisAsk(actors, loadAskQuestions(), test.info(), { reportTag: `${newTag()}-ask` })
      for (const a of test.info().annotations) console.log(`[시나리오] ${a.type}: ${a.description}`)
      expect(s.errors, "질의 오류").toBe(0)
      expect(s.n).toBeGreaterThan(0)
    } finally {
      await Promise.all(actors.map((a) => a.context.close()))
    }
  })
})
