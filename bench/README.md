# bench — 모델 × 방법론 벤치마크

계획과 배경: [`mydocs/plans/2026-09-09-model-method-benchmark.md`](../mydocs/plans/2026-09-09-model-method-benchmark.md)

```
npx tsx bench/run.ts --list                                   # 키 있는 모델 · 방법 · 질문 수
npx tsx bench/run.ts --models gemini-2.5-flash --methods baseline --limit 2   # 작게 한 번
npx tsx bench/run.ts                                          # 전부
npx tsx bench/run.ts --run 20260909-1030                      # 중단한 것 이어서
npx tsx bench/report.ts bench/results/20260909-1030           # 표만 다시
npx tsx bench/retrieval-eval.ts --questions <파일> --retrievers R0-hybrid,vector --repeat 1   # 검색만, 생성 호출 없음
BENCH_BUDGET_KRW=2000 npx tsx bench/run.ts                    # 한 run 누적 원가가 2000원에 닿으면 다음 호출 전에 멈춤
npx tsx bench/ledger.ts                                       # 전 run 합계
npx tsx bench/retrieval-eval.ts --questions <파일> --retrievers R0-hybrid,R1a-trgm,R1b-bm25,R2-query,R3-rerank   # WeKnora 이식 검색기
npx tsx bench/run.ts --models gemini-3.8-flash@low --methods wk-r3 --limit 1  # 이식 검색기 + 단발 생성
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
| `report.ts` | `summary.md` · `summary.csv` (유형별 표 포함. `type` 없는 문항은 regression) |
| `questions.ts` | 질문 파일 읽기. 선택 필드 `type` · `gold` · `minSteps` · `stale` · `unanswerable` |
| `retrieval-eval.ts` | 생성 없이 검색만 평가 — 검색기 레지스트리, Recall@8 · MRR · NDCG@10 · ms → `retrieval.jsonl` · `retrieval-summary.md` |
| `wk/search.ts` | WeKnora 검색 기법 이식 R1a~R4 (가중 RRF · 질의 이해 · 키워드 확장 · LLM 리랭크 + MMR · 부모 확장). 검색기(`R1a-trgm`…`R4-parent`)와 방법(`wk-r1a`…`wk-r4`)이 같은 함수를 쓴다 |
| `wk/keyword.ts` · `wk/llm.ts` | 키워드 점수(pg_trgm · BM25 근사) · 검색 단계 flash-lite 호출(재작성 · 리랭크) |
| `wk/setup.sql` | **로컬 실험 DB 전용** trigram GIN 인덱스. Prisma 마이그레이션이 아니다. 운영에 돌리지 않는다 |
| `ledger.ts` | `results/ledger.jsonl` 비용 장부 (run · 검색 평가 원가 누적). `npx tsx bench/ledger.ts` 로 합계 |

키: `.env` 의 `GEMINI_API_KEY`(있음). Anthropic 은 `ANTHROPIC_API_KEY`, OpenAI 호환은
`OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY`. 없는 벤더는 자동으로 건너뛴다.
DB 는 `DATABASE_URL`. 벤치는 읽기만 하지만, 검색이 질문 임베딩을 만들 때 `GeminiUsage` 에 행이 남는다.

`results/` 는 git 에 넣지 않는다 (답변 본문에 사내 대화가 그대로 들어간다). 질문 파일도 같은 이유로
저장소 밖 `~/work/omnis-import/eval/scenarios-260907.json` 이 기본이다 (`--questions` · `BENCH_QUESTIONS`).
형식: `{ "ask": [{ "q": "질문", "expect": ["기대 문자열", …] }] }`.
v4 선택 필드: `type`(유형), `gold`(`[{source, sourceId}]` — 검색 지표의 정답 근거), `minSteps`, `stale`(옛 결정 문자열), `unanswerable`.
`gold` 의 `CHAT_MESSAGE` sourceId 는 메시지 ID 다. 없는 필드는 무시되므로 기존 파일이 그대로 돈다.

`BENCH_BUDGET_KRW` 는 `results.jsonl` 합계(답변 + 심판)부터 센다. 재개해도 이어서 센다. 판단은 질문 1건 단위라
상한을 넘는 마지막 1건(답변 + 심판)은 나간다. 임베딩 단가는 `config.ts` 의 `EMBEDDING_PRICE_USD_PER_M` (확인 필요).

WeKnora 이식 검색기(`wk/`)는 R2 부터 검색 단계에서 `gemini-3.5-flash-lite` 를 부른다. 그 원가는 검색 평가에선
ledger 의 retrieval 줄에, 생성 평가에선 행의 `costKrw` 에 더해진다. `wk/setup.sql` 은
`docker exec -i omnis-db-local psql -U omnis -d omnis_wklab < bench/wk/setup.sql` 로 한 번 건다 — 키워드가 전부
세 글자 이상일 때만 인덱스를 타고(두 글자 패턴은 trigram 이 안 나온다) 그 밖엔 순차 스캔이다. 청크 8천여 건에서 둘 다 100ms 안쪽이다.
