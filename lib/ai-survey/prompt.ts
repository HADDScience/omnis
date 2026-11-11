// AI 활용 설문 — 모델에게 주는 지시와 받는 모양. 순수(prisma 없음). 시험: lib/ai-survey/rules.test.ts
//
// 모델이 하는 일은 둘이다.
//   1) 「남은 칸 가운데 무엇을, 어떤 말과 보기로 물을지」 를 정한다(SURVEY_SYSTEM).
//   2) 응답자가 입력창에 쓴 글을 칸 값으로 옮긴다(SAY_SYSTEM) — 지금 질문의 답인지, 앞 답을 고치는 말인지도 가린다.
// 범위 · 구간 · 값 목록 · 끝낼 때는 코드가 정한다(rules.ts). 모델이 낸 값은 코드가 다시 검증한다.
// 앞부분(SYSTEM)은 매 턴 같은 글이라 벤더의 입력 캐시를 탄다 — 바뀌는 것(대화 기록 · 남은 칸)은 뒤에 붙인다.
import { z } from "zod"
import { LIMIT_HITS, PAYERS, SLOTS, SLOT_NAMES, TASK_KINDS, TASK_SIZES, WISH_TAGS, answerText, fieldMode, missingSlots, type Facts, type Slot, type Turn } from "./rules"

/** OpenAI 구조화 출력은 모든 칸이 required 여야 한다 — 없는 값은 null */
export const AskOutputSchema = z.object({
  question: z.string().describe("응답자에게 보일 질문 한 문장(존댓말, 60자 안쪽)"),
  fields: z
    .array(
      z.object({
        slot: z.enum(SLOT_NAMES as [Slot, ...Slot[]]),
        kind: z.enum(["single", "multi", "slider", "bucket", "scale", "text"]),
        label: z.string().nullable().describe("칸이 둘 이상일 때 칸 이름. 하나면 null"),
        options: z.array(z.object({ label: z.string(), value: z.string().nullable() })).nullable(),
        min: z.number().nullable(),
        max: z.number().nullable(),
        step: z.number().nullable(),
        unit: z.string().nullable(),
      }),
    )
    .describe("범위 칸은 1~3개, 말로 답하는 칸은 1개"),
})

const values = (v: Record<string, string>) => Object.entries(v).map(([k, label]) => `${k}(${label})`).join(" · ")

const SLOT_GUIDE: Record<Slot, string> = {
  daysPerWeek: "범위(슬라이더 0~7일 — 주말 포함). 범위는 화면이 정한다",
  hoursPerDay: "범위(슬라이더 0~10시간, 끝은 「10시간 이상」). 범위는 화면이 정한다",
  sessionsPerDay: "범위(구간 칩 1~2번 … 50번 넘게). 구간은 화면이 정한다. hoursPerDay 와 둘 중 하나만 묻는다",
  tools: "말. options 에 도구 이름 4~6개(value 는 null)",
  payer: `말. options 의 value 는 ${values(PAYERS)}`,
  monthlyFeeKrw: "범위(구간 칩 3만원 미만 … 40만원 넘게). 구간은 화면이 정한다. payer 가 유료일 때만 열린다",
  limitHit: `말. value 는 ${values(LIMIT_HITS)}`,
  taskKinds: `말. options 4~7개, label 은 응답자가 바로 알아볼 구체적 예시(「메일 초안」 「회의록 요약」), value 는 ${values(TASK_KINDS)}`,
  mainTask: "말. 앞에서 고른 작업 가운데 하나. value 는 taskKinds 와 같은 값",
  taskSize: `말. value 는 ${values(TASK_SIZES)}`,
  wishes: `말. options 4~7개, label 은 구체적 예시, value 는 ${values(WISH_TAGS)}`,
  pain: "말. options 에 범용 AI 의 아쉬운 점 4~6개(value 는 null). 질문 글에 「범용 AI」 를 쓴다",
  free: "칸에 들지 않는 후속 질문. kind 는 single · multi(말 + 추천 칩) · text(말만) · scale(범위, 1~5, options 두 개가 양 끝 이름) · slider(범위, min · max · unit)",
}

const SLOT_LIST = SLOT_NAMES.map((s) => `- ${s}: ${SLOTS[s].about} — ${SLOT_GUIDE[s]}`).join("\n")

export const SURVEY_SYSTEM = `당신은 HADD Science 사내 도구 「옴니스」 의 AI 활용 설문 진행자다. 구성원 한 사람과 채팅하듯 차례로 묻는다.

알아낼 것은 세 가지다.
1. 회사 일에 AI 를 얼마나 쓰는가(빈도 · 시간 · 도구 · 유료 여부 · 한도 경험)
2. AI 로 어떤 작업을 주로 하는가(종류 · 비중 · 크기)
3. 바라는 것과 아쉬운 점 — 가리키는 대상이 서로 다르다
   - 바라는 것(wishes): 「옴니스」(사내 AI)가 해 주면 좋겠는 일
   - 아쉬운 점(pain): 「범용 AI」(ChatGPT · Claude · Gemini 같은 것)를 쓰며 아쉬운 점. 옴니스에 대한 불만을 묻는 것이 아니다

정해진 문항은 없다. 지금까지의 답을 보고 「남은 칸」 가운데 다음에 물을 것을 당신이 고른다.

답하는 방식은 칸마다 정해져 있다.
- 범위 칸: 응답자가 슬라이더 · 구간 칩으로만 답한다. 범위와 구간은 화면이 정하니 당신은 질문 글만 쓴다. options · min · max 를 채워도 쓰이지 않는다.
- 말로 답하는 칸: 응답자가 입력창에 말로 답한다. options 는 누르면 바로 답이 되는 「추천 답」 칩이다 — 응답자가 바로 고를 만한 구체적 예시로 쓰고, 앞 답을 반영한다(개발자라고 답했으면 코딩 예시를 앞에).

규칙
- 한 번에 질문 하나. 범위 칸끼리만 2~3개로 묶을 수 있다(예: 쓰는 날 수 + 하루 시간). 말로 답하는 칸은 한 번에 하나만 묻고 범위 칸과 섞지 않는다.
- 일주일은 7일이다. 주말에도 쓰는 사람이 있으니 「주 5일 중」 이라고 묻지 않는다.
- 「잘 모르겠음」 은 화면이 늘 붙인다. 「기타」 는 응답자가 말로 쓴다. 둘 다 보기에 넣지 않는다.
- 이미 답한 칸은 다시 묻지 않는다. 남은 칸에 없는 slot 은 쓰지 않는다.
- 질문은 짧은 존댓말 한 문장. 인사 · 감사 · 설명을 붙이지 않는다.
- 아쉬운 점(pain)을 묻는 질문에는 반드시 「범용 AI」 라고 쓴다(예: 「ChatGPT 같은 범용 AI 에 긴 작업을 맡기실 때 어떤 점이 아쉬우신가요?」). 그냥 「AI」 라고만 쓰면 옴니스로 읽힌다. 「옴니스」 라는 말은 pain 질문과 그 보기에 쓰지 않는다.
- 바라는 것(wishes)을 묻는 질문에는 「옴니스」 라고 쓴다. wishes 와 pain 은 한 질문에 묶지 않는다.
- free(후속 질문)는 앞 답에서 더 알아야 할 것이 분명할 때만 묻는다.

칸(slot)과 답하는 방식
${SLOT_LIST}`

const liveAnswer = (t: Turn) => t.ask.fields.map((f) => `${f.label ? `${f.label}: ` : ""}${answerText(f, t.answer?.[f.id])}`).join(" / ")

/** 지금까지의 문답 — 모델이 읽는 대화 기록. 고친 답은 지금 값으로, 근거가 바뀌어 버린 후속 질문은 뺀다 */
export function transcript(turns: Turn[]): string {
  const done = turns.filter((t) => t.answer && !t.stale)
  if (done.length === 0) return "(아직 없음 — 첫 질문이다)"
  return done.map((t, i) => `${i + 1}. 질문: ${t.ask.question}\n   답: ${liveAnswer(t)}`).join("\n")
}

export function surveyPrompt(turns: Turn[], facts: Facts, freeLeft: number): string {
  const open = missingSlots(facts)
  return `지금까지의 문답
${transcript(turns)}

남은 칸: ${open.join(", ")}${freeLeft > 0 ? ` (free 는 ${freeLeft}번 더 쓸 수 있다)` : " (free 는 더 쓸 수 없다)"}

다음 질문 하나를 만들어라.`
}

// ─── 말로 한 답 읽기 ─────────────────────────────────────────────

export const SayOutputSchema = z.object({
  target: z.enum(["none", ...SLOT_NAMES] as [string, ...string[]]).describe("이 말이 가리키는 칸. 어느 칸인지 알 수 없으면 none"),
  values: z.array(z.string()).describe("enum · tags 칸의 값(목록에 있는 값만). 없으면 빈 배열"),
  labels: z.array(z.string()).describe("값 목록에 없는 것 · 이름 그대로 남길 것(도구 이름, 아쉬운 점 등)을 짧은 구로. 없으면 빈 배열"),
  num: z.number().nullable().describe("범위 칸이면 응답자가 말한 숫자(원 단위 금액은 원으로). 아니면 null"),
  unknown: z.boolean().describe("모르겠다 · 잘 모름이라고 답했으면 true"),
})

export const SAY_SYSTEM = `당신은 HADD Science 사내 도구 「옴니스」 의 AI 활용 설문에서 응답자가 입력창에 쓴 글을 읽고, 그 글이 어느 칸(slot)에 대한 것이며 값이 무엇인지 옮긴다. 대화하지 않는다 — 옮기기만 한다.

가릴 것
- 지금 묻는 질문의 답인가, 이미 답한 질문을 고치는 말인가. 「아까 4일 아니고 3일」 「구독은 회사가 내는 걸로 바꿔줘」 는 고치는 말이다 — target 은 그 칸이다.
- 고치는 말이 아니면 target 은 지금 묻는 질문의 칸이다.
- 설문과 상관없는 말 · 어느 칸인지 알 수 없는 말이면 target 은 none.

옮기는 법
- 범위 칸(daysPerWeek · hoursPerDay · sessionsPerDay · monthlyFeeKrw, 그리고 범위로 묻는 free): num 에 숫자만. 「매일」 은 7일, 「3만원」 은 30000, 「반나절」 은 4시간처럼 숫자로 바꾼다. 범위에 맞추는 일은 화면이 한다.
- 값 목록이 있는 칸(payer · limitHit · taskSize · mainTask · taskKinds · wishes): values 에 목록의 값만 넣는다. 목록에 없는 것은 지어내지 말고 labels 에 응답자의 말을 짧은 구로 넣는다(taskKinds · wishes 만).
- 이름 그대로 남기는 칸(tools · pain): labels 에 짧은 구로. 도구 이름은 흔한 표기로 쓴다(「챗지피티」 → ChatGPT).
- 「아쉬운 점」(pain)은 범용 AI 에 대한 것, 「바라는 것」(wishes)은 옴니스에 대한 것이다.
- 응답자가 말하지 않은 것을 채우지 않는다.

칸
${SLOT_NAMES.map((s) => `- ${s}: ${SLOTS[s].about}`).join("\n")}

값 목록
- payer: ${values(PAYERS)}
- limitHit: ${values(LIMIT_HITS)}
- taskSize: ${values(TASK_SIZES)}
- taskKinds · mainTask: ${values(TASK_KINDS)}
- wishes: ${values(WISH_TAGS)}`

/** 글을 읽을 때 모델에게 주는 것 — 지금 묻는 질문(과 그 추천 칩), 이미 답한 것. only 가 있으면 그 질문을 고치는 중이다 */
export function sayPrompt(text: string, turns: Turn[], only?: string): string {
  const fieldLine = (t: Turn) =>
    t.ask.fields
      .map((f) => {
        const opts = fieldMode(f) === "chat" && f.options?.length ? ` · 추천 칩: ${f.options.map((o) => (o.value ? `${o.label}=${o.value}` : o.label)).join(" | ")}` : ""
        return `${f.slot}(${fieldMode(f) === "range" ? "범위" : "말"})${opts}`
      })
      .join(" ; ")
  const answered = turns.filter((t) => t.answer && !t.stale)
  const focus = only ? turns.find((t) => t.id === only) : turns.findLast((t) => !t.answer)
  return `이미 답한 것
${answered.length ? answered.map((t) => `- ${fieldLine(t).replace(/ · 추천 칩:[^;]*/g, "")} — 질문: ${t.ask.question} — 답: ${liveAnswer(t)}`).join("\n") : "(없음)"}

${focus ? `${only ? "지금 고치는 질문" : "지금 묻는 질문"}: ${focus.ask.question}\n칸: ${fieldLine(focus)}` : "지금 묻는 질문: (없음 — 요약을 확인하는 중이다. 고치는 말만 올 수 있다)"}

응답자가 쓴 글: ${JSON.stringify(text)}`
}
