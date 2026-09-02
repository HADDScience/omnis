import {
  fallbackAiDraft,
  normalizeAiDraft,
  type TaskAiDraft,
} from "@/lib/schemas/task-ai"
import {
  assertGeminiUsageAllowed,
  estimateGeminiTokens,
  recordGeminiUsage,
} from "@/lib/gemini-usage"

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

/**
 * @deprecated `TaskAiDraft`(lib/schemas/task-ai.ts)를 사용하세요. expectedResult 제거됨.
 * 외부에서 import 하지 마세요.
 */
export type TaskDraft = TaskAiDraft

function cleanCodeBlocks(text: string): string {
  return text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim()
}

async function callGemini(
  prompt: string,
  endpoint: string,
  userId?: string,
  temperature = 0.3
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다")
  const maxOutputTokens = 8192

  await assertGeminiUsageAllowed({
    endpoint,
    userId,
    estimatedTokens: estimateGeminiTokens([prompt]) + maxOutputTokens,
  })

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      // 구조화 추출은 깊은 추론이 불필요 → thinking 비활성으로 토큰 ~50%↓ + 속도↑ + 503 회피
      ...(endpoint === "structureTask" ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  })
  // 503(모델 과부하)·일시적 429(rate, spend cap 제외)는 재시도. spend cap 429는 즉시 중단.
  let res: Response | undefined
  let lastErr = ""
  const MAX_ATTEMPTS = 8
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: reqBody,
    })
    if (res.ok) break
    lastErr = await res.text()
    const transient = res.status === 503 || (res.status === 429 && !/spend(ing)? cap/i.test(lastErr))
    if (!transient || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`Gemini API 오류 (${endpoint}): ${res.status} ${lastErr}`)
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * (attempt + 1), 9000)))
  }
  if (!res || !res.ok) throw new Error(`Gemini API 오류 (${endpoint}): ${lastErr}`)

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  const usage = data.usageMetadata

  if (usage) {
    try {
      await recordGeminiUsage({
        endpoint,
        promptTokens: usage.promptTokenCount ?? 0,
        candidateTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
        userId,
      })
    } catch (err) {
      console.error("[gemini-usage] 사용량 기록 실패", { endpoint, userId, err })
    }
  } else {
    console.warn("[gemini-usage] Gemini 응답에 usageMetadata가 없습니다", { endpoint, userId })
  }

  return cleanCodeBlocks(text)
}

export async function structureTask(
  messages: string[],
  context?: {
    projects: { id: string; name: string; productName: string | null }[]
    products: { id: string; name: string }[]
    members?: { id: string; name: string }[]
  },
  userId?: string
): Promise<TaskAiDraft> {
  const projectSection = context?.projects?.length
    ? `\n기존 프로젝트 목록 (가장 적합한 프로젝트의 ID를 projectId에 지정, 없으면 null):\n${context.projects.map((p) => `- ${p.id}: ${p.name}${p.productName ? ` (${p.productName})` : ""}`).join("\n")}`
    : ""

  const productSection = context?.products?.length
    ? `\n제품 목록 (이 업무와 가장 관련 있는 제품의 ID를 productId에 지정, 없으면 null):\n${context.products.map((p) => `- ${p.id}: ${p.name}`).join("\n")}`
    : ""

  const memberSection = context?.members?.length
    ? `\n팀원 목록 (메시지의 담당자를 아래 정식 이름으로 매핑해 ownerHints 배열에 지정):\n${context.members.map((m) => `- ${m.name}`).join("\n")}`
    : ""

  const today = new Date().toISOString().slice(0, 10)
  const prompt = `다음 채팅 메시지들은 관리자가 작업자에게 내린 업무 지시입니다.
이 메시지들을 분석하여 아래 JSON 형식으로 구조화해주세요.

규칙:
- name: 업무를 한 줄로 요약 (15자 이내)
- background: 업무의 배경이나 맥락 (2-3문장)
- checklist: 수행해야 할 단계들 (2-5개, 각 항목은 짧게)
- projectId: 기존 프로젝트 목록 중 가장 적합한 프로젝트의 ID. 적합한 기존 프로젝트가 없으면 null.
- newProject: 기존 프로젝트 목록에 없는 프로젝트·고객사·캠페인 이름이 메시지에 명시되어 있거나, 이 업무가 새로운 프로젝트로 묶여야 할 때 신규 프로젝트를 객체로 제안. 그렇지 않으면 null.
  형식: { "name": "프로젝트명(20자 이내)", "purpose": "프로젝트 목적 1-2문장", "goal": "프로젝트 목표 1문장" }
  주의: projectId와 newProject는 동시에 채우지 마세요. 둘 중 하나만 사용하세요.
- productId: 제품 목록 중 가장 관련 있는 제품의 ID (없으면 null)
- newProduct: 제품 목록에 없는 제품·소재·물질 이름이 메시지에 명시되어 있으면 신규 제품을 객체로 제안. 형식: { "name": "제품명" }. 그렇지 않으면 null.
  주의: productId와 newProduct는 동시에 채우지 마세요. 둘 중 하나만 사용하세요.
- priority: 메시지에서 추정한 우선순위 ("LOW" | "NORMAL" | "HIGH" 중 하나, 명확치 않으면 생략)
- ownerHints: 메시지에서 언급된 담당자 **이름 배열**. 존칭("우창님")·약칭("우창")이 쓰였어도 팀원 목록의 정식 이름으로 변환(예: "우창님" → "정우창"). 여러 명에게 지시했으면 모두 넣으세요(예: "인턴들 각자 제출해주세요" → 해당 인턴 전원). 언급이 없으면 빈 배열 []
- deadlineHint: 마감일 힌트. ISO 날짜(YYYY-MM-DD) 또는 한국어 상대표현("오늘"·"내일"·"이번 주 금요일" 등). 명시 없으면 생략. 오늘은 ${today} 입니다.
${projectSection}
${productSection}
${memberSection}

메시지가 리스트 형태이면 각 항목을 체크리스트로 추출하세요.
priority/ownerHints/deadlineHint는 메시지에서 명확히 추론 가능할 때만 채우세요. 추측하지 말고 생략하세요.
체크리스트는 담당자별로 쪼개지 마세요. 한 업무에 목록 하나입니다 — 여러 명이 맡아도 같은 목록을 함께 봅니다.

반드시 JSON만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 반환하세요.

메시지:
${messages.join("\n")}

JSON:`

  const raw = await callGemini(prompt, "structureTask", userId)

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("JSON 파싱 실패")
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    return normalizeAiDraft(parsed)
  } catch (err) {
    console.error("[ai/structureTask] 응답 파싱 실패, fallback 사용", { userId, err })
    return fallbackAiDraft(messages)
  }
}

export interface MentionIntent {
  action: "complete" | "pause" | "resume" | "add_checklist" | "modify" | "modify_overview" | "info" | "none"
  summary: string
  modifyTarget?: string
  modifyTo?: string
  overviewField?: "background" | "expectedResult"
  overviewValue?: string
}

export async function classifyMention(
  taskName: string,
  message: string,
  checklists: { id: string; name: string; done: boolean }[] = [],
  userId?: string
): Promise<MentionIntent> {
  const checklistContext = checklists.length > 0
    ? `\n\n현재 체크리스트:\n${checklists.map((c, i) => `${i + 1}. [${c.done ? "x" : " "}] ${c.name}`).join("\n")}`
    : ""

  const prompt = `업무 관리 시스템에서 사용자가 특정 업무를 멘션하며 보낸 채팅 메시지입니다.
이 메시지의 의도를 분류해주세요.

업무명: ${taskName}
메시지: ${message}${checklistContext}

의도 분류:
- "complete": 업무 전체 완료 또는 최종 승인 (예: "완료했습니다", "다 했어요", "완료!", "완벽합니다!", "수고했어요!", "이대로 진행하겠습니다", "전부 확인했습니다", "최종본으로 제출하겠습니다")
- "pause": 업무 중지/보류 (예: "잠깐 멈춰", "보류")
- "resume": 업무 재개/시작 (예: "다시 시작", "진행해")
- "modify": 기존 체크리스트 항목의 수정/정정 (예: "사이즈 A1으로 정정이래요", "색상 빨간색으로 바꿔"). 체크리스트에서 특정 값을 다른 값으로 바꾸는 경우.
- "modify_overview": 업무 개요(배경, 기대결과)의 수정 (예: "배경에 추가로 이건 급한 건이야", "기대결과를 보고서 제출로 바꿔줘"). 업무 자체의 설명을 바꾸는 경우.
- "add_checklist": 새로운 추가 지시 (예: "이것도 해주세요", "추가로 확인해줘"). 기존 항목 수정이 아닌 새 항목 추가.
- "info": 정보 공유/질문 (예: "진행상황 어때?")
- "none": 분류 불가

응답 JSON:
- action: 위 분류 중 하나
- summary: 핵심 내용 짧게 요약 (add_checklist일 때 새 항목명)
- modifyTarget: modify일 때, 수정 대상 체크리스트 항목의 원문 (체크리스트에서 가장 관련 있는 항목을 정확히 복사)
- modifyTo: modify일 때, 수정된 새 내용
- overviewField: modify_overview일 때, "background" 또는 "expectedResult"
- overviewValue: modify_overview일 때, 새 내용

반드시 JSON만 반환. 마크다운 코드블록 없이 순수 JSON만.`

  try {
    const raw = await callGemini(prompt, "classifyMention", userId)
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { action: "none", summary: "" }
    return JSON.parse(match[0]) as MentionIntent
  } catch (err) {
    console.error("[ai/classifyMention] 분류 실패", { taskName, userId, err })
    return { action: "none", summary: "" }
  }
}

export interface TaskRebuildResult {
  action: "complete" | "pause" | "resume" | "rebuild" | "info" | "none"
  name?: string
  background?: string
  expectedResult?: string
  checklist?: { name: string; done: boolean }[]
  priority?: "LOW" | "NORMAL" | "HIGH"
  statusLabel?: string
}

export async function rebuildTask(
  taskName: string,
  background: string | null,
  expectedResult: string | null,
  checklists: { name: string; done: boolean }[],
  allMessages: { author: string; content: string; files?: string[] }[],
  userId?: string
): Promise<TaskRebuildResult> {
  const messagesText = allMessages
    .map((m) => {
      let line = `${m.author}: ${m.content}`
      if (m.files && m.files.length > 0) line += `\n  [첨부: ${m.files.join(", ")}]`
      return line
    })
    .join("\n")

  const checklistText = checklists
    .map((c, i) => `${i + 1}. [${c.done ? "x" : " "}] ${c.name}`)
    .join("\n")

  const prompt = `업무 관리 시스템에서 특정 업무에 대한 모든 대화 기록입니다.
이 대화를 종합 분석하여 업무 카드를 재구성해주세요.

## 현재 업무 정보
업무명: ${taskName}
배경: ${background || "(없음)"}
기대결과: ${expectedResult || "(없음)"}
체크리스트:
${checklistText || "(없음)"}

## 전체 대화 기록 (시간순)
${messagesText}

## 지시사항

위 대화를 종합하여 다음을 판단하세요:

1. 마지막 메시지의 핵심 의도:
   - "complete": 업무 전체가 완료되었음을 선언하거나 최종 승인하는 경우
     * 명시적 완료: "이 업무 전부 끝났습니다", "전체 완료", "모두 완료했습니다"
     * 감탄/승인형: "완료!", "완벽합니다!", "수고했어요!" (업무 완료에 대한 최종 반응)
     * 확인 후 최종 처리: "전부 확인했습니다", "이대로 진행하겠습니다", "최종본으로 제출하겠습니다"
     * 관리자가 결과물 최종 OK 후 다음 지시 포함: "완료! 인쇄 발주 진행해주세요" → 현재 업무는 "complete", 뒤의 지시는 별개 업무로 무시. 현재 업무 완료 판정 우선.
   - "pause": 업무 중지/보류 (예: "잠깐 멈춰", "보류해")
   - "resume": 업무 재개 (예: "다시 시작", "진행해")
   - "rebuild": 업무 카드 변경이 필요한 모든 경우. 다음 중 하나라도 해당하면 rebuild:
     * 체크리스트 항목 추가 (예: "이것도 해줘", "추가로 확인해")
     * 체크리스트 항목 수정 (예: "사이즈 A1으로 정정", "색상 변경")
     * 체크리스트 항목 완료 보고 (예: "오타 수정했어", "확인 완료했어", "다 했어")
     * 배경/기대결과 변경
     * 새로운 요구사항 추가
   - "info": 정보 공유/질문, 변경 불필요 (예: "진행상황 어때?", "참고로 알려줘")
   - "none": 업무와 무관한 대화

중요:
- "~했어", "~완료했어", "~수정했어" 같은 단순 진행 보고는 특정 작업의 진행 보고이므로 "rebuild"로 판단하고 해당 체크리스트 항목의 done을 true로 변경하세요.
- 단, "완료!", "완벽합니다!", "수고했어요!", "이대로 진행하겠습니다", "전부 확인했습니다", "최종본으로 제출하겠습니다" 처럼 업무 전체에 대한 최종 승인/완료 표현은 "complete"로 판단하세요.
- 마지막 메시지 직전에 상대방이 "최종 확인 부탁드립니다", "전 항목 완료했습니다" 등의 완료 보고를 했고, 마지막 메시지가 이에 대한 승인 표현이면 "complete"로 판단하세요.
- ★ 수행자가 업무 '전체'를 끝내고 마무리를 선언하는 표현은 반드시 "complete": "업무 마무리하겠습니다", "업무 마치겠습니다/마칩니다", "업무 완료합니다", "작업 다 끝냈습니다", "이상으로 마무리합니다", "최종 완료했습니다", "모두 반영해서 완료했습니다". (특정 체크리스트 항목 하나만 끝낸 진행보고와 구분: 메시지가 업무 전반의 종료/마무리를 뜻하면 complete)
- 절대 규칙: 마지막 메시지에 "완료!"(느낌표) 또는 "마무리하겠습니다"·"업무 완료"·"마치겠습니다"가 있으면 action은 반드시 "complete". 뒤에 어떤 추가 지시가 붙더라도 예외 없음.

2. action이 "rebuild"인 경우, 모든 대화를 종합하여 업무 카드를 재구성:
   - name: 업무명 (변경 필요 시만, 아니면 현재 업무명 유지)
   - background: 업무 배경 (대화에서 드러난 전체 맥락 반영)
   - expectedResult: 기대 결과 (최신 요구사항 반영)
   - checklist: 체크리스트 전체를 반환 (기존 항목 유지 + 대화에서 추가/수정/완료된 내용 반영)
     * 대화에서 "~했어", "~완료" 언급된 항목은 done: true
     * 대화에서 추가 요청된 항목은 새로 추가 (done: false)
     * 대화에서 수정 요청된 항목은 내용 변경
     * 언급되지 않은 기존 항목은 현재 done 상태 유지

반드시 아래 정확한 키 이름으로 JSON만 반환하세요. 다른 키 이름 사용 금지.
정확한 형식: {"action": "rebuild", "name": "업무명", "background": "배경", "expectedResult": "기대결과", "checklist": [{"name": "항목명", "done": true}], "priority": "HIGH"}
- action 키 필수 (last_message_intent 등 다른 키 금지)
- 체크리스트 항목은 name 키 필수 (description 등 다른 키 금지)
- priority: 대화에서 추가 요구·재작업·긴급 피드백이 있으면 우선순위를 한 단계 올려 반영("LOW"→"NORMAL"→"HIGH"). 변화 없으면 생략. 추측 금지.
- checklist: 피드백으로 새 할 일이 생기면 기존 항목 유지 + 새 항목 추가, 새로 생긴 항목은 done:false`

  try {
    const raw = await callGemini(prompt, "rebuildTask", userId, 0)
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { action: "none" }
    const parsed = JSON.parse(match[0])

    // Gemini가 다른 키 이름을 사용할 수 있으므로 정규화
    const action = parsed.action || parsed.last_message_intent || parsed.intent || "none"
    const checklist = parsed.checklist?.map((c: Record<string, unknown>) => ({
      name: (c.name || c.description || c.item || "") as string,
      done: !!c.done,
    }))

    return {
      action,
      name: parsed.name,
      background: parsed.background,
      expectedResult: parsed.expectedResult || parsed.expected_result,
      checklist,
      priority: parsed.priority,
      statusLabel: parsed.statusLabel,
    } as TaskRebuildResult
  } catch (err) {
    console.error("[ai/rebuildTask] 재구성 실패", { taskName, userId, err })
    return { action: "none" }
  }
}

export async function generateWeeklyReport(
  tasks: { name: string; status: string }[],
  userId?: string
): Promise<string> {
  const prompt = `다음은 이번 주 업무 목록입니다. 주간 업무보고 초안을 작성해주세요.

형식:
## 금주 실적
- 업무1: 결과 요약
- 업무2: 결과 요약

업무 목록:
${tasks.map((t) => `- ${t.name} (${t.status})`).join("\n")}

보고서:`

  return callGemini(prompt, "weeklyReport", userId)
}

// ─── 임베딩 (벡터 검색용) ────────────────────────────────

const GEMINI_EMBED_MODEL = "gemini-embedding-001"
const GEMINI_BATCH_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents`

/** 임베딩 차원. 마이그레이션의 vector(768) 및 EmbeddingChunk 스키마와 일치해야 함. */
export const EMBEDDING_DIM = 768

/** Gemini batchEmbedContents 1회 요청당 최대 텍스트 수 */
const EMBED_BATCH_SIZE = 100

/** 임베딩 입력 길이 상한 (모델 토큰 한도 보호) */
const MAX_EMBED_CHARS = 8000

export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"

function l2normalize(v: number[]): number[] {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm === 0) return v
  return v.map((x) => x / norm)
}

/**
 * 텍스트 배열을 Gemini 임베딩 벡터로 변환한다.
 * - taskType: 저장용 청크는 RETRIEVAL_DOCUMENT, 검색 질의는 RETRIEVAL_QUERY
 * - 768차원으로 truncate 후 L2 정규화 (코사인 유사도용)
 */
export async function embedTexts(
  texts: string[],
  taskType: EmbedTaskType,
  userId?: string
): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다")
  if (texts.length === 0) return []

  const out: number[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
    const endpoint = `embedTexts.${taskType}`
    await assertGeminiUsageAllowed({
      endpoint,
      userId,
      estimatedTokens: estimateGeminiTokens(batch),
    })
    const res = await fetch(`${GEMINI_BATCH_EMBED_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, MAX_EMBED_CHARS) }] },
          taskType,
          outputDimensionality: EMBEDDING_DIM,
        })),
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini 임베딩 API 오류 (${taskType}): ${res.status} ${err}`)
    }

    const data = await res.json()
    const embeddings = data.embeddings as { values: number[] }[] | undefined
    if (!embeddings || embeddings.length !== batch.length) {
      throw new Error("Gemini 임베딩 응답 형식 오류")
    }

    const usage = data.usageMetadata
    if (usage) {
      try {
        await recordGeminiUsage({
          endpoint,
          promptTokens: usage.promptTokenCount ?? usage.totalTokenCount ?? 0,
          candidateTokens: 0,
          totalTokens: usage.totalTokenCount ?? usage.promptTokenCount ?? 0,
          userId,
        })
      } catch (err) {
        console.error("[gemini-usage] 임베딩 사용량 기록 실패", { endpoint, userId, err })
      }
    } else {
      const estimated = estimateGeminiTokens(batch)
      try {
        await recordGeminiUsage({
          endpoint,
          promptTokens: estimated,
          candidateTokens: 0,
          totalTokens: estimated,
          userId,
        })
      } catch (err) {
        console.error("[gemini-usage] 임베딩 추정 사용량 기록 실패", { endpoint, userId, err })
      }
    }

    for (const e of embeddings) out.push(l2normalize(e.values))
  }
  return out
}

// ─── 옴니스 RAG 답변 ─────────────────────────────────────

/**
 * 검색된 청크를 근거로 질문에 답한다 (RAG의 generation 단계).
 * chunks가 비어 있으면 Gemini를 호출하지 않고 안내 메시지를 반환한다.
 */
export async function answerWithOmnis(
  question: string,
  chunks: { title: string; content: string; sourceLabel: string }[],
  taskOverview?: string,
  userId?: string
): Promise<string> {
  if (chunks.length === 0 && !taskOverview) {
    return "참고할 만한 사내 자료를 찾지 못했어요. 질문을 더 구체적으로 바꾸거나, 옴니스 카드에 관련 내용을 추가해 주세요."
  }

  const references =
    chunks.length > 0
      ? chunks
          .map((c, i) => `[${i + 1}] (${c.sourceLabel} · ${c.title})\n${c.content}`)
          .join("\n\n")
      : "(검색된 문서 없음)"

  const overviewSection = taskOverview
    ? `\n\n[업무 현황 — 현재 비보관 업무 전체 목록]\n${taskOverview}`
    : ""

  const today = new Date().toISOString().slice(0, 10)
  const prompt = `당신은 HADD Science의 사내 지식 비서 "옴니스"입니다.
오늘 날짜는 ${today}입니다.
아래 [참고 자료]와 [업무 현황]을 근거로 직원의 질문에 답하세요.

규칙:
- 주어진 자료에 있는 내용만 사용하세요. 답할 수 없으면 추측하지 말고 "관련 내용을 찾지 못했습니다"라고만 답하세요.
- [참고 자료]를 근거로 쓰면 문장 끝에 [1], [2]처럼 번호를 표기하세요. [업무 현황]을 근거로 할 때는 번호 표기가 필요 없습니다.
- [업무 현황]은 현재 비보관 업무 전체 목록입니다. 업무·마감일·지연·진행 상태를 묻는 질문은 이 목록을 근거로 하나도 빠뜨리지 말고 모두 답하세요.
- "지연된 업무"는 마감일이 오늘보다 이전인데 아직 완료되지 않은 업무입니다. 해당 업무를 전부 나열하세요.
- 한국어로 간결하고 명확하게 답하세요. 항목이 여러 개면 마크다운 목록이나 표를 쓰세요.

[참고 자료]
${references}${overviewSection}

[질문]
${question}

[답변]`

  return callGemini(prompt, "omnisAsk", userId, 0.3)
}
