// 공고 가점 뽑기 — 발췌(lib/grant-bonus.ts bonusExcerpt) → 모델 → 근거 확인 → GrantNotice 저장 · AiUsage 기록.
// 부르는 곳: scripts/extract-grant-bonus.ts(수집기 이식 뒤 한 번). 모델은 lib/ai-models.ts 의 grant_bonus(옴니스 기본과 같은 모델).
import { createHash } from "node:crypto"
import { generateText } from "ai"
import { prisma } from "@/lib/db"
import { modelFor, modelKey } from "@/lib/ai-models"
import { costOf } from "@/lib/ai-pricing"
import { realModel } from "@/lib/agent/model"
import { checkBudgetAlertsSoon } from "@/lib/ai-budget-alerts"
import { parseBonusOutput } from "@/lib/grant-bonus"
import { Prisma } from "@/generated/prisma/client"

export const BONUS_SYSTEM = [
  "너는 한국 정부지원사업 · 국가 R&D 공고문에서 「가점(가산점) · 우대」 항목을 옮겨 적는다. 판단하거나 보태지 않는다.",
  "뽑는 것: 기업이 가진 인증 · 확인서 · 지정 · 선정 이력 · 자격(소재지 포함)으로 주는 가점 · 우대. 예: 벤처기업 확인, 이노비즈, 메인비즈, 기업부설연구소, 여성기업, 장애인기업, 사회적기업, 가족친화인증, 비수도권 소재, 혁신형 의료기기기업.",
  "뽑지 않는 것: 감점, 평가 배점(기술성 30점 같은 심사 항목), 고용 증가 · 매출 · 투자 유치 · 협약 이행 · 구매 · MOU 같은 실적, 개인이나 기업의 수상 · 표창 · 포상, 설명회 참석, 지원 대상 자격(가점이 아니면).",
  "이 공고의 평가 · 선정에서 주는 가점만 뽑는다. 인증 자체를 소개하며 「다른 사업에서 가점을 받는다」고 쓴 문장은 이 공고의 가점이 아니다.",
  "각 항목: label(공고에 적힌 이름 그대로), points(그 항목 점수 숫자 · 범위면 큰 쪽 · 모르면 null), points_text(점수 원문, 예 「최대 2점」), condition(조건이 있으면 짧게, 없으면 null), quote(근거 — 발췌에 있는 글자 그대로 한두 문장, 표면 그 행의 글자), source(근거가 있는 [[…]] 머리 글자 그대로).",
  "한 칸에 여러 인증이 묶여 있으면(「벤처 · 이노비즈 · 메인비즈 중 1개」) 한 항목으로 둔다. 같은 항목이 여러 번 나오면 한 번만.",
  "가점 전체 상한이 있으면 cap 에 {points, text, quote}, 없으면 null.",
  '출력은 JSON 하나만: {"items":[{"label":"","points":null,"points_text":null,"condition":null,"quote":"","source":""}],"cap":null}. 해당 항목이 없으면 items 는 [].',
].join("\n")

export const excerptHash = (excerpt: string) => createHash("sha256").update(excerpt).digest("hex")

export interface ExtractResult {
  status: "ok" | "no_text" | "failed"
  items: number
  dropped: number
  costKrw: number
  inputTokens: number
  outputTokens: number
}

/** 발췌 하나로 공고 가점을 뽑아 저장한다. 발췌가 비면 모델을 부르지 않고 no_text 로 둔다 */
export async function extractNoticeBonus(
  noticeId: string,
  excerpt: string,
  opts: { dryRun?: boolean; userId?: string } = {}
): Promise<ExtractResult & { raw?: string }> {
  const hash = excerptHash(excerpt)
  const empty = { items: 0, dropped: 0, costKrw: 0, inputTokens: 0, outputTokens: 0 }
  if (!excerpt.trim()) {
    if (!opts.dryRun)
      await prisma.grantNotice.update({
        where: { id: noticeId },
        data: {
          bonusStatus: "no_text",
          bonusItems: [],
          bonusCap: Prisma.DbNull,
          bonusExtractedAt: new Date(),
          bonusModel: null,
          bonusTextHash: hash,
        },
      })
    return { status: "no_text", ...empty }
  }

  const choice = modelFor("grant_bonus")
  const key = modelKey(choice)
  const r = await generateText({
    model: await realModel(choice),
    reasoning: choice.reasoning,
    ...(choice.vendor === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
    system: BONUS_SYSTEM,
    messages: [{ role: "user", content: `공고 발췌:\n\n${excerpt}` }],
  })
  const usage = {
    inputTokens: r.usage.inputTokens ?? 0,
    cachedInputTokens: r.usage.inputTokenDetails.cacheReadTokens ?? 0,
    outputTokens: r.usage.outputTokens ?? 0,
  }
  const cost = costOf(key, usage)
  await prisma.aiUsage.create({
    data: {
      vendor: choice.vendor,
      model: choice.model,
      feature: "grant_bonus",
      ...usage,
      reasoningTokens: r.usage.outputTokenDetails.reasoningTokens ?? 0,
      costUsd: cost.usd,
      costKrw: cost.krw,
      userId: opts.userId ?? null,
    },
  })
  await checkBudgetAlertsSoon()

  const parsed = parseBonusOutput(r.text, excerpt)
  const base = {
    costKrw: Number(cost.krw),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    raw: r.text,
  }
  if (!parsed) {
    if (!opts.dryRun)
      await prisma.grantNotice.update({
        where: { id: noticeId },
        data: { bonusStatus: "failed", bonusExtractedAt: new Date(), bonusModel: key, bonusTextHash: null },
      })
    return { status: "failed", items: 0, dropped: 0, ...base }
  }
  if (!opts.dryRun)
    await prisma.grantNotice.update({
      where: { id: noticeId },
      data: {
        bonusStatus: "ok",
        bonusItems: parsed.items as unknown as Prisma.InputJsonValue,
        bonusCap: parsed.cap ? (parsed.cap as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        bonusExtractedAt: new Date(),
        bonusModel: key,
        bonusTextHash: hash,
      },
    })
  return { status: "ok", items: parsed.items.length, dropped: parsed.dropped, ...base }
}
