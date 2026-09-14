import { test } from "@playwright/test"
import { type Actor, createActor, loadAccounts } from "./_actors"
import { CAST, newTag, runKickoff } from "./_kickoff"

/**
 * 과제 킥오프 — 대표 → 팀장 → 실무 2명(동시) → 취합 보고. 본문은 _kickoff.ts.
 * 목킹 없음. 브라우저 컨텍스트 4개가 같은 로컬 서버·DB·Gemini 를 쓴다.
 * 매 실행마다 제목에 실행 태그를 붙여 이전 실행과 섞이지 않게 한다.
 */
test.describe("과제 킥오프 — 대표 → 팀장 → 실무 2명 → 취합 보고", () => {
  test.describe.configure({ timeout: 15 * 60_000 })

  test("4명 동시 접속으로 지시·분배·보고·취합이 끝까지 이어진다", async ({ browser }) => {
    const pw = loadAccounts()
    const actors: Actor[] = []
    try {
      const [ceo, lead, woochang, hyerin] = await Promise.all(CAST.map((n) => createActor(browser, n, pw[n])))
      actors.push(ceo, lead, woochang, hyerin)
      await runKickoff({ ceo, lead, woochang, hyerin }, newTag(), test.info())
      for (const a of test.info().annotations) console.log(`[시나리오] ${a.type}: ${a.description}`)
    } finally {
      await Promise.all(actors.map((a) => a.context.close()))
    }
  })
})
