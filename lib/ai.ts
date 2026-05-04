import { prisma } from "@/lib/db"

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

interface TaskDraft {
  name: string
  background: string
  expectedResult: string
  checklist: string[]
  projectId: string | null
  productId: string | null
  categoryId: string | null
}

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

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: 8192,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API 오류: ${res.status} ${err}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  const usage = data.usageMetadata

  // 토큰 사용량 DB 기록
  if (usage) {
    try {
      await prisma.geminiUsage.create({
        data: {
          endpoint,
          promptTokens: usage.promptTokenCount ?? 0,
          candidateTokens: usage.candidatesTokenCount ?? 0,
          totalTokens: usage.totalTokenCount ?? 0,
          userId: userId ?? null,
        },
      })
    } catch {
      // 토큰 기록 실패 시 무시 (핵심 기능 차단 방지)
    }
  }

  return cleanCodeBlocks(text)
}

export async function structureTask(
  messages: string[],
  context?: {
    projects: { id: string; name: string; productName: string | null }[]
    categories: { id: string; name: string }[]
    products: { id: string; name: string }[]
  },
  userId?: string
): Promise<TaskDraft> {
  const projectSection = context?.projects?.length
    ? `\n기존 프로젝트 목록 (가장 적합한 프로젝트의 ID를 projectId에 지정, 없으면 null):\n${context.projects.map((p) => `- ${p.id}: ${p.name}${p.productName ? ` (${p.productName})` : ""}`).join("\n")}`
    : ""

  const categorySection = context?.categories?.length
    ? `\n업무 카테고리 목록 (가장 적합한 카테고리의 ID를 categoryId에 지정, 없으면 null):\n${context.categories.map((c) => `- ${c.id}: ${c.name}`).join("\n")}`
    : ""

  const productSection = context?.products?.length
    ? `\n제품 목록 (이 업무와 가장 관련 있는 제품의 ID를 productId에 지정, 없으면 null):\n${context.products.map((p) => `- ${p.id}: ${p.name}`).join("\n")}`
    : ""

  const prompt = `다음 채팅 메시지들은 관리자가 작업자에게 내린 업무 지시입니다.
이 메시지들을 분석하여 아래 JSON 형식으로 구조화해주세요.

규칙:
- name: 업무를 한 줄로 요약 (15자 이내)
- background: 업무의 배경이나 맥락 (2-3문장)
- expectedResult: 기대하는 결과물 (1-2문장)
- checklist: 수행해야 할 단계들 (2-5개, 각 항목은 짧게)
- projectId: 가장 적합한 프로젝트의 ID (없으면 null)
- productId: 가장 관련 있는 제품의 ID (없으면 null)
- categoryId: 가장 적합한 카테고리의 ID (없으면 null)
${projectSection}
${productSection}
${categorySection}

메시지가 리스트 형태이면 각 항목을 체크리스트로 추출하세요.

반드시 JSON만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 반환하세요.

메시지:
${messages.join("\n")}

JSON:`

  const raw = await callGemini(prompt, "structureTask", userId)

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("JSON 파싱 실패")
    const parsed = JSON.parse(jsonMatch[0])
    return {
      name: parsed.name ?? messages[0]?.slice(0, 30) ?? "새 업무",
      background: parsed.background ?? "",
      expectedResult: parsed.expectedResult ?? parsed.expected_result ?? "",
      checklist: parsed.checklist ?? [],
      projectId: parsed.projectId ?? null,
      productId: parsed.productId ?? null,
      categoryId: parsed.categoryId ?? null,
    }
  } catch {
    return {
      name: messages[0]?.slice(0, 30) ?? "새 업무",
      background: messages.join(" ").slice(0, 200),
      expectedResult: "",
      checklist: [],
      projectId: null,
      productId: null,
      categoryId: null,
    }
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
  checklists: { id: string; name: string; done: boolean }[] = []
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
    const raw = await callGemini(prompt, "classifyMention")
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { action: "none", summary: "" }
    return JSON.parse(match[0]) as MentionIntent
  } catch {
    return { action: "none", summary: "" }
  }
}

export interface TaskRebuildResult {
  action: "complete" | "pause" | "resume" | "rebuild" | "info" | "none"
  name?: string
  background?: string
  expectedResult?: string
  checklist?: { name: string; done: boolean }[]
  statusLabel?: string
}

export async function rebuildTask(
  taskName: string,
  background: string | null,
  expectedResult: string | null,
  checklists: { name: string; done: boolean }[],
  allMessages: { author: string; content: string; files?: string[] }[]
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
- 절대 규칙: 마지막 메시지에 "완료!" (느낌표 포함 단어)가 있으면 action은 반드시 "complete". 뒤에 어떤 추가 지시가 붙더라도 예외 없음.

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
정확한 형식: {"action": "rebuild", "name": "업무명", "background": "배경", "expectedResult": "기대결과", "checklist": [{"name": "항목명", "done": true}]}
- action 키 필수 (last_message_intent 등 다른 키 금지)
- 체크리스트 항목은 name 키 필수 (description 등 다른 키 금지)`

  try {
    const raw = await callGemini(prompt, "rebuildTask", undefined, 0)
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
      statusLabel: parsed.statusLabel,
    } as TaskRebuildResult
  } catch {
    return { action: "none" }
  }
}

export async function generateWeeklyReport(
  tasks: { name: string; status: string }[]
): Promise<string> {
  const prompt = `다음은 이번 주 업무 목록입니다. 주간 업무보고 초안을 작성해주세요.

형식:
## 금주 실적
- 업무1: 결과 요약
- 업무2: 결과 요약

## 차주 계획
- 계획1
- 계획2

업무 목록:
${tasks.map((t) => `- ${t.name} (${t.status})`).join("\n")}

보고서:`

  return callGemini(prompt, "weeklyReport")
}
