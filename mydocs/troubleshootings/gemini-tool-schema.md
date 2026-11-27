---
kind: reference
status: active
canonical: mydocs/troubleshootings/gemini-tool-schema.md
last_verified: 2026-11-27
---

# Gemini 도구 스키마 400 — 도구 하나가 질문 경로 전체를 막는다

2026-11-26 PR #267 · #268 에서 실제로 겪고 고친 것이다.

## 무엇이 일어났나

질문 경로(`ask_omnis` · 앱 AI)는 `runGeminiToolLoop`(`lib/ai.ts`)이 도구 수십 개의 JSON Schema 를 한 요청에 실어 보낸다.
그중 **하나라도** Gemini 가 받지 않는 모양이면 요청 전체가 `400 INVALID_ARGUMENT` 다. 그 도구를 부르지 않는 질문까지
전부 실패한다. MCP 클라이언트(Claude 등)는 같은 스키마를 문제없이 받으므로 MCP 쪽 시험으로는 드러나지 않는다.

두 번 연달아 밟았다.

| PR | 원인 | 모양 |
|---|---|---|
| #267 | `website_stats` 의 기간 인자 `enum: [7, 30, 90]` | Gemini 의 `enum` 은 **문자열만** 받는다. 숫자 enum 하나로 400 — `function_declarations[24] … enum[0] (TYPE_STRING), 7` |
| #268 | `set_ai_budget` 스키마의 `additionalProperties` | Gemini 스키마(OpenAPI 부분집합)에 없는 칸이다. #267 을 고친 뒤에도 400 이 남았다 — `Unknown name "additionalProperties" at 'tools[0].function_declarations[82].parameters.properties[2].value'` |

## 고친 방법

- **#267:** 그 도구에서 숫자 enum 을 뺐다. 값 검사는 서버 코드가 그대로 한다(범위 밖이면 기본값).
  모든 도구 스키마의 enum 이 문자열인지 보는 시험을 더했다.
- **#268:** 도구마다 고치는 대신 **보내기 직전에 줄인다** — `geminiSchema()`(`lib/ai.ts`).
  - Gemini 가 아는 칸(`GEMINI_SCHEMA_KEYS`: type · format · description · nullable · enum · properties · required · items ·
    min/max 류 · pattern · anyOf · default · example · propertyOrdering …)만 남긴다.
  - 문자열이 아닌 enum 은 지우고 설명 끝에 「(7 · 30 · 90 중 하나)」 로 옮긴다.
  - `properties` · `items` · `anyOf` 안쪽도 같은 규칙으로 내려간다.
  - MCP 로 내보내는 스키마는 그대로다. 줄이는 것은 Gemini 로 보낼 때뿐이다.
- 시험: `lib/ai-gemini-schema.test.ts` 가 등록된 모든 도구를 `geminiSchema` 로 줄인 뒤, 허용 칸 밖의 칸 · 문자열이 아닌 enum 이
  하나도 없는지 본다. 새 도구가 `additionalProperties` 나 숫자 enum 을 써도 CI 에서 걸린다.

## 다음에 먼저 확인할 것

- 질문 경로가 갑자기 전부 400 이면, 최근에 **새로 들어오거나 바뀐 도구 스키마**부터 본다. 에러 본문에 문제 칸의 경로
  (`tools[0].function_declarations[N].parameters…`)가 찍힌다(위 표). N 은 그 요청에 실은 도구 목록의 순번이다.
- 도구 스키마를 손으로 Gemini 모양에 맞추지 않는다. MCP 쪽은 표준 JSON Schema 로 두고 `geminiSchema` 가 줄이게 둔다.
- `callGemini` 에 응답 스키마(`schema` 옵션, `responseSchema`)를 줄 때는 `geminiSchema` 를 거치지 않는다. 처음부터 Gemini 모양
  (문자열 enum · `nullable` · `additionalProperties` 없음)으로 쓴다.
