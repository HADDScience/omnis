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
