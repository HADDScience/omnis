// AI 활용 설문 — 모델에게 주는 지시와 받는 모양. 순수(prisma 없음). 시험: lib/ai-survey/rules.test.ts
//
// 모델은 「남은 칸 가운데 무엇을, 어떤 말과 보기로 물을지」 만 정한다. 범위 · 값 목록 · 끝낼 때는 코드가 정한다(rules.ts).
// 앞부분(SYSTEM)은 매 턴 같은 글이라 벤더의 입력 캐시를 탄다 — 바뀌는 것(대화 기록 · 남은 칸)은 뒤에 붙인다.
import { z } from "zod"
import { LIMIT_HITS, PAYERS, SLOTS, SLOT_NAMES, TASK_KINDS, TASK_SIZES, WISH_TAGS, answerText, missingSlots, type Facts, type Slot, type Turn } from "./rules"

/** OpenAI 구조화 출력은 모든 칸이 required 여야 한다 — 없는 값은 null */
export const AskOutputSchema = z.object({
  question: z.string().describe("응답자에게 보일 질문 한 문장(존댓말, 60자 안쪽)"),
  fields: z
    .array(
      z.object({
        slot: z.enum(SLOT_NAMES as [Slot, ...Slot[]]),
        kind: z.enum(["single", "multi", "slider", "number", "scale", "text"]),
        label: z.string().nullable().describe("칸이 둘 이상일 때 칸 이름. 하나면 null"),
        options: z.array(z.object({ label: z.string(), value: z.string().nullable() })).nullable(),
        min: z.number().nullable(),
        max: z.number().nullable(),
        step: z.number().nullable(),
        unit: z.string().nullable(),
      }),
    )
    .describe("1~3개. 서로 이어지는 칸만 묶는다"),
})

const values = (v: Record<string, string>) => Object.entries(v).map(([k, label]) => `${k}(${label})`).join(" · ")

const SLOT_GUIDE: Record<Slot, string> = {
  daysPerWeek: "slider. 범위는 화면이 정한다(0~5일)",
  hoursPerDay: "slider. 범위는 화면이 정한다(0~8시간)",
  sessionsPerDay: "number. hoursPerDay 와 둘 중 하나만 묻는다",
  tools: "multi. options 에 도구 이름 4~6개(value 는 null)",
  payer: `single. options 의 value 는 ${values(PAYERS)}`,
  monthlyFeeKrw: "number(원). payer 가 유료일 때만 열린다",
  limitHit: `single. value 는 ${values(LIMIT_HITS)}`,
  taskKinds: `multi. options 4~7개, label 은 응답자가 바로 알아볼 구체적 예시(「메일 초안」 「회의록 요약」), value 는 ${values(TASK_KINDS)}`,
  mainTask: "single. 앞에서 고른 작업 가운데 하나. value 는 taskKinds 와 같은 값",
  taskSize: `single. value 는 ${values(TASK_SIZES)}`,
  wishes: `multi. options 4~7개, label 은 구체적 예시, value 는 ${values(WISH_TAGS)}`,
  pain: "multi. options 에 범용 AI 의 아쉬운 점 4~6개(value 는 null). 질문 글에 「범용 AI」 를 쓴다",
  free: "칸에 들지 않는 후속 질문. kind 는 single · multi · scale(1~5, options 두 개가 양 끝 이름) · slider · number · text(한 줄, 정말 필요할 때만)",
}

export const SURVEY_SYSTEM = `당신은 HADD Science 사내 도구 「옴니스」 의 AI 활용 설문 진행자다. 구성원 한 사람에게 차례로 묻는다.

알아낼 것은 세 가지다.
1. 회사 일에 AI 를 얼마나 쓰는가(빈도 · 시간 · 도구 · 유료 여부 · 한도 경험)
2. AI 로 어떤 작업을 주로 하는가(종류 · 비중 · 크기)
3. 바라는 것과 아쉬운 점 — 가리키는 대상이 서로 다르다
   - 바라는 것(wishes): 「옴니스」(사내 AI)가 해 주면 좋겠는 일
   - 아쉬운 점(pain): 「범용 AI」(ChatGPT · Claude · Gemini 같은 것)를 쓰며 아쉬운 점. 옴니스에 대한 불만을 묻는 것이 아니다

정해진 문항은 없다. 지금까지의 답을 보고 「남은 칸」 가운데 다음에 물을 것을 당신이 고른다.

규칙
- 한 번에 질문 하나. 칸은 1개가 기본이고, 바로 이어지는 것만 2~3개로 묶는다(예: 쓰는 날 수 + 하루 시간).
- 응답자가 글을 쓰지 않고 눌러서 답하게 한다. text 는 정말 필요할 때만.
- 보기(options)는 응답자가 바로 고를 수 있는 구체적 예시로 쓴다. 앞 답을 반영한다(개발자라고 답했으면 코딩 예시를 앞에).
- 「잘 모르겠음」 · 「기타」 는 화면이 늘 붙인다. 보기에 넣지 않는다.
- 이미 답한 칸은 다시 묻지 않는다. 남은 칸에 없는 slot 은 쓰지 않는다.
- 질문은 짧은 존댓말 한 문장. 인사 · 감사 · 설명을 붙이지 않는다.
- 아쉬운 점(pain)을 묻는 질문에는 반드시 「범용 AI」 라고 쓴다(예: 「ChatGPT 같은 범용 AI 에 긴 작업을 맡기실 때 어떤 점이 아쉬우신가요?」). 그냥 「AI」 라고만 쓰면 옴니스로 읽힌다. 「옴니스」 라는 말은 pain 질문과 그 보기에 쓰지 않는다.
- 바라는 것(wishes)을 묻는 질문에는 「옴니스」 라고 쓴다. wishes 와 pain 은 한 질문에 묶지 않는다.
- free(후속 질문)는 앞 답에서 더 알아야 할 것이 분명할 때만, 남은 칸과 함께 묻는다.

칸(slot)과 폼
${SLOT_NAMES.map((s) => `- ${s}: ${SLOTS[s].about} — ${SLOT_GUIDE[s]}`).join("\n")}`

/** 지금까지의 문답 — 모델이 읽는 대화 기록 */
export function transcript(turns: Turn[]): string {
  const done = turns.filter((t) => t.answer)
  if (done.length === 0) return "(아직 없음 — 첫 질문이다)"
  return done
    .map((t, i) => {
      const a = t.ask.fields.map((f) => `${f.label ? `${f.label}: ` : ""}${answerText(f, t.answer?.[f.id])}`).join(" / ")
      return `${i + 1}. 질문: ${t.ask.question}\n   답: ${a}`
    })
    .join("\n")
}

export function surveyPrompt(turns: Turn[], facts: Facts, freeLeft: number): string {
  const open = missingSlots(facts)
  return `지금까지의 문답
${transcript(turns)}

남은 칸: ${open.join(", ")}${freeLeft > 0 ? ` (free 는 ${freeLeft}번 더 쓸 수 있다)` : " (free 는 더 쓸 수 없다)"}

다음 질문 하나를 만들어라.`
}
