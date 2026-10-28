# bench — 모델 × 방법론 벤치마크

계획과 배경: [`mydocs/plans/2026-09-09-model-method-benchmark.md`](../mydocs/plans/2026-09-09-model-method-benchmark.md)

```
npx tsx bench/run.ts --list                                   # 키 있는 모델 · 방법 · 질문 수
npx tsx bench/run.ts --models gemini-2.5-flash --methods baseline --limit 2   # 작게 한 번
npx tsx bench/run.ts                                          # 전부
npx tsx bench/run.ts --run 20260909-1030                      # 중단한 것 이어서
npx tsx bench/report.ts bench/results/20260909-1030           # 표만 다시
```

| 파일 | 역할 |
|---|---|
| `config.ts` | 모델 축 · 요금표 · 심판 모델 · 환율 |
| `providers.ts` | Gemini · Anthropic · OpenAI 호환 어댑터, 사용량·재시도 |
| `context.ts` | 벡터/하이브리드 검색 · 현황 요약 · 통째 말뭉치 (프로덕션 함수 재사용, 시간 측정) |
| `tools.ts` | route 용 도구 (MCP 읽기 도구 + ip_overview) · JSON 프로토콜 |
| `methods.ts` | baseline · vector · hybrid · stuff · route |
| `judge.ts` | 근거 적중 + 심판 모델 0·1·2 점 |
| `run.ts` | 그리드 실행, `results/<run>/results.jsonl` (재개 가능) |
| `report.ts` | `summary.md` · `summary.csv` |

키: `.env` 의 `GEMINI_API_KEY`(있음). Anthropic 은 `ANTHROPIC_API_KEY`, OpenAI 호환은
`OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY`. 없는 벤더는 자동으로 건너뛴다.
DB 는 `DATABASE_URL`. 벤치는 읽기만 하지만, 검색이 질문 임베딩을 만들 때 `GeminiUsage` 에 행이 남는다.

`results/` 는 git 에 넣지 않는다 (답변 본문에 사내 대화가 그대로 들어간다). 질문 파일도 같은 이유로
저장소 밖 `~/work/omnis-import/eval/scenarios-260907.json` 이 기본이다 (`--questions` · `BENCH_QUESTIONS`).
형식: `{ "ask": [{ "q": "질문", "expect": ["기대 문자열", …] }] }`.

## 에이전트형 과제 — `bench/agent/`

사내 메신저형 에이전트(여러 단계로 도구를 부르고, 쓰기는 「제안 → 사용자 확인」)를 어떤 벤더·모델로
돌릴지, 회사에 월 얼마를 요구할지 정하는 근거. 계획: `mydocs/plans/2026-10-28-omnis-messenger-agent.md` 0단계.

```
npx tsx bench/agent/run.ts --list                       # 모델 · 키 유무 · 과제 수
npx tsx bench/agent/run.ts --dry-run                    # 0원 — 고정 스크립트로 루프·도구·채점·리포트 + 비용 추산
npx tsx bench/agent/run.ts --models claude-haiku-5-5,gemini-3.8-flash --limit 2   # 모델별 2건 시험 (유료)
npx tsx bench/agent/run.ts --models <…> --repeat 2      # 전체 (유료)
npx tsx bench/agent/run.ts --run agent-20261028-150012  # 중단한 것 이어서 (없으면 새 폴더, 있으면 --run 없이 거부)
npx tsx bench/agent/report.ts bench/results/agent-…     # 표만 다시 (--workdays 22)
npx tsx bench/agent/estimate.ts bench/results/agent-…-dry   # dry-run 결과로 비용 추산만
npx tsx bench/agent/run.ts --dry-run --router jev       # 라우터 모드 0원 확인 (가짜 Jev · 가짜 Responses API)
npx tsx bench/agent/run.ts --router jev --repeat 2      # 라우터 모드 실측 (유료): Jev 가 luna/sol 을 고른다
```

| 파일 | 역할 |
|---|---|
| `agent/drivers.ts` | 벤더 어댑터 — Anthropic(공식 SDK) · Gemini(함수 호출) · OpenAI(공식 SDK, Responses API) · 고정 스크립트 · 가짜 OpenAI. 토큰 추산식 |
| `agent/env.ts` | `.env` 읽기. API 키(모델 셋 + `JEV_API_KEY` · `AI_GATEWAY_API_KEY`)는 `.env` 가 셸 환경변수를 이긴다. 시작할 때 키별 출처를 찍는다 |
| `agent/router.ts` | 라우터 — Jev 에 요청 원문만 보내 simple/complex · 확신도를 받고, 코드 규칙으로 실행 모델을 고른다 |
| `agent/loop.ts` | 벤더 중립 루프. 턴 상한(12) · 건당 원 상한(1,000원) · 턴 기록(도구·인자·결과 길이·지연) |
| `agent/tools.ts` | 도구 세트. MCP 읽기 도구는 로컬 DB 를 실제로 읽고, 쓰기 도구 + `create_file` 은 **제안으로만 기록** |
| `agent/grade.ts` | 결정적 채점(제안 인자 조건 · expect · 금지 행동 · 「실행했다고 단정」) + 심판 0·1·2 |
| `agent/report.ts` | 모델별 완수율·쓰기 정확도·평균 턴·건당 원·p50/p90 지연, **하루 20/50/100건 × 건당 원 = 월 예산** |
| `agent/estimate.ts` | dry-run 이 쌓은 실제 요청 크기로 모델별 건당 원 추산 |
| `agent/tasks.example.json` | 과제 파일 형식 예시 (지어낸 이름) |

- **dry-run 은 모델·심판을 부르지 않는다.** `dry-perfect`(과제 파일의 정답 스크립트)는 전부 통과하고
  `dry-naive`(대충 읽고 아무 데나 글을 올린 뒤 끝났다고 말하는 에이전트)는 전부 떨어져야 채점이 제대로 선 것이다.
  `dry-openai` 는 정답 스크립트를 Responses API 모양의 가짜 응답으로 바꿔 실제 OpenAI 어댑터를 돈다 — 직전 reasoning·function_call
  항목을 그대로 되돌리는지, 호출마다 function_call_output 을 붙이는지, temperature·previous_response_id 를 안 보내는지 검사한다.
  임베딩이 Gemini 를 부르는 `search_knowledge` 도 dry-run 에서는 막는다.
- 실제 실행에서는 `search_knowledge` 가 질문 임베딩을 만든다(Gemini, 건당 1원 미만). 로컬 DB 의 `GeminiUsage` 에 행이 남는다.
- **DB 는 `.env` 의 `DATABASE_URL` 만 읽고, localhost 가 아니면 시작하지 않는다.** `next start/build` 는
  `.env.production.local` 을 읽어 운영 Neon 에 붙으니 쓰지 않는다.
- `--budget-krw`(기본 35,000원)에 모델+심판 누적이 닿으면 멈춘다. 같은 `--run` 으로 이어 돌린다.
- 심판은 `AGENT_BENCH_JUDGE`(기본 `claude-sonnet-5-5`, config.ts 의 모델 키). `--no-judge` 로 끈다.
- **API 키(GEMINI · ANTHROPIC · OPENAI)는 `.env` 값이 셸 환경변수를 이긴다.** `~/.zshrc` 가 export 한 다른 GEMINI 키로 불려 402 가 난 적이 있다.
  시작할 때 `키 GEMINI_API_KEY ← .env (셸 값 무시)` 처럼 출처만 찍는다(값은 안 찍는다).
- **라우터 모드(`--router jev`, 계획서 0-b):** 과제마다 Jev(TypeSafe System One, `jev-1.14.0` 고정)에 사용자 요청 원문만
  state 로 보내 고정 질문(simple / complex Choice)의 답과 확신도를 받는다. 유형 라벨·정답은 보내지 않는다.
  규칙(코드): simple → `--router-cheap`(기본 gpt-6-luna), complex → `--router-strong`(기본 gpt-6.1-sol),
  확신도 < `--router-threshold`(기본 0.7) · 형식이 다른 응답 · 호출 실패 → strong. 결과 표에는 `router:jev(luna/sol)` 한 줄,
  건당 원·지연은 Jev 몫 포함. 리포트에 라우팅 분포 · 유형별 분포 · 잘못 보낸 과제 · `--compare`(기본 agent-20261028-052125,
  전부 sol) 비교표가 붙는다. 키는 `JEV_API_KEY`(TypeSafe 직접 `api.typesafe.ai/v1/systemone`)를 먼저,
  없으면 `AI_GATEWAY_API_KEY`(`ai-gateway.vercel.sh/typesafe/v1/systemone`, 모델 `typesafe-ai/jev-1.14.0`). Jev 요금 입력 100만 토큰당 $0.042, 출력 무료.
- 새 실행의 run id 는 초까지 넣는다(`agent-YYYYMMDD-HHMMSS`). 폴더가 이미 있으면 `--run` 없이는 거부한다.
- 모델 축은 `config.ts` 의 `AGENT_MODELS`(Claude 5.5 셋 · gemini-3.8-flash · gemini-3.5-flash-lite · gpt-6.1-sol · gpt-6.1-terra · gpt-6-luna). 1차 벤치 `MODELS` 와 따로 둔다.
  OpenAI 는 Responses API 로 매번 전체 입력을 보낸다(`previous_response_id` 안 씀, `store: false` + `include: reasoning.encrypted_content`). reasoning effort medium, temperature 안 보냄.
  Claude 5.5 는 thinking 을 끌 수 없어 `effort`(medium)로만 조절하고 temperature·budget_tokens·forced tool_choice 를 보내지 않는다.
- 과제 파일은 사내 데이터가 들어가 저장소 밖 `~/work/omnis-import/eval/agent-tasks-261028.json` (`--tasks` · `AGENT_BENCH_TASKS`).
  정답은 그 날짜 로컬 스냅샷에 묶인다(`snapshotDate`). 스냅샷을 새로 받으면 정답을 다시 확인한다.
- 결과는 `bench/results/agent-<run>/` (git 제외).
