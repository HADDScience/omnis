import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/db"
import { countCases } from "@/lib/ip-data"

/**
 * 랜딩 「쌓이는 것」 의 숫자 — 비로그인 화면이라 **개수만** 센다. 이름 · 내용 · 사람(구성원 수 포함)은 내보내지 않는다
 * (mydocs/plans/archives/2026-10-29-landing-v2.md 「정한 것」 1 · 2). 예전 랜딩의 지표(80% · 10× …)는 잰 값이 아니어서
 * 여기서는 DB 가 센 값만 쓴다.
 */
export interface LandingStats {
  /** 업무 카드 — 보관한 것까지 */
  tasks: number
  /** 상표 + 특허 */
  ipCases: number
  /** 옴니스가 답한 질문 — OmnisQuery 는 답이 나온 질문마다 한 줄이다(lib/omnis-ask.ts · lib/agent/store.ts) */
  answeredQuestions: number
}

async function countAll(): Promise<LandingStats> {
  // 지식 카드 수는 세지 않는다 — 운영에 아직 1장이라 랜딩에서 뺐다(landing-page.tsx 의 Stats)
  const [tasks, answeredQuestions, ipCases] = await Promise.all([
    prisma.task.count(),
    prisma.omnisQuery.count(),
    countCases(),
  ])
  return { tasks, ipCases, answeredQuestions }
}

/**
 * 한 시간 캐시 — 랜딩을 열 때마다 DB 를 네 번 세지 않게. 값이 한 시간 늦는 것은 「쌓이는 것」 에 문제가 되지 않는다.
 * 저장소에 다른 캐시 방식(`"use cache"` 는 cacheComponents 가 꺼져 있어 쓸 수 없다)이 없어 unstable_cache 를 쓴다.
 */
const cachedCount = unstable_cache(countAll, ["landing-stats-v2"], { revalidate: 3600 })

/** 세다가 실패하면 null — 랜딩은 섹션을 숨기고 나머지를 그대로 보인다(꾸민 숫자를 대신 넣지 않는다) */
export async function getLandingStats(): Promise<LandingStats | null> {
  try {
    return await cachedCount()
  } catch (error) {
    console.warn("[landing] 숫자를 세지 못했다", error)
    return null
  }
}
