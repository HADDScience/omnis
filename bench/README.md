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
npx tsx bench/run.ts --models gemini-3.8-flash@low --methods wk-agent,native --ids v4-mh-01,v4-un-01  # ReAct 에이전트 vs 현행, 문항 id 로 고르기
npx tsx bench/run.ts --models gemini-3.8-flash@low --methods weknora-rag,weknora-agent --ids v4-mh-01  # 실물 WeKnora (wk-real/README.md 로 먼저 띄운다)
BENCH_JUDGE=claude-sonnet-cli npx tsx bench/run.ts --models gemini-3.8-flash@low --methods wk-agent --limit 10  # 심판을 Claude 구독으로
npx tsx bench/rejudge.ts bench/results/<run> --judge claude-sonnet-cli [--methods a,b] [--limit N] [--out <폴더>]  # 저장된 근거로 다시 채점
```

| 파일 | 역할 |
|---|---|
| `config.ts` | 모델 축 · 요금표 · 심판 모델 · 환율 |
| `providers.ts` | Gemini · Anthropic · OpenAI 호환 어댑터, 사용량·재시도 |
| `context.ts` | 벡터/하이브리드 검색 · 현황 요약 · 통째 말뭉치 (프로덕션 함수 재사용, 시간 측정) |
| `tools.ts` | route 용 도구 (MCP 읽기 도구 + ip_overview) · JSON 프로토콜 |
| `methods.ts` | baseline · vector · hybrid · stuff · route |
| `judge.ts` | 근거 적중 + 심판 모델 0·1·2 점. `judgeMany` 는 구독 심판이면 문항을 묶어 한 호출로 채점 |
| `claude-cli.ts` | 구독 심판 호출 — `claude -p` 헤드리스, ANTHROPIC_API_KEY 를 지워 구독 인증 강제 |
| `rejudge.ts` | 결과 행에 저장된 `evidence` · `judgeInput` 으로 다른 심판에게 다시 채점 → `<run>-rejudge-<judge>/` (원본 그대로) |
| `run.ts` | 그리드 실행, `results/<run>/results.jsonl` (재개 가능) |
| `report.ts` | `summary.md` · `summary.csv` (유형별 표 포함. `type` 없는 문항은 regression) |
| `questions.ts` | 질문 파일 읽기. 선택 필드 `type` · `gold` · `minSteps` · `stale` · `unanswerable` |
| `retrieval-eval.ts` | 생성 없이 검색만 평가 — 검색기 레지스트리, Recall@8 · MRR · NDCG@10 · ms → `retrieval.jsonl` · `retrieval-summary.md` |
| `wk/search.ts` | WeKnora 검색 기법 이식 R1a~R4 (가중 RRF · 질의 이해 · 키워드 확장 · LLM 리랭크 + MMR · 부모 확장). 검색기(`R1a-trgm`…`R4-parent`)와 방법(`wk-r1a`…`wk-r4`)이 같은 함수를 쓴다 |
| `wk/keyword.ts` · `wk/llm.ts` | 키워드 점수(pg_trgm · BM25 근사) · 검색 단계 flash-lite 호출(재작성 · 리랭크) |
| `wk/setup.sql` | **로컬 실험 DB 전용** trigram GIN 인덱스. Prisma 마이그레이션이 아니다. 운영에 돌리지 않는다 |
| `agent/` | WeKnora 식 ReAct 에이전트 `wk-agent` — `loop.ts`(최대 20회 · 결과 6천 자 자르기 · 6만 토큰 넘으면 오래된 결과 한 줄 압축) · `tools.ts`(search_knowledge=R2 · grep_chunks · read_document · list_documents · todo_write + Omnis 읽기 도구 허용 목록) · `prompt.ts` · `stats.ts`(반복·도구·재검색·한도 — native·route 도 같은 식). `WK_AGENT_MAX_ITER` · `WK_AGENT_SEARCH=r1a\|r2\|r3` 로 덮는다 |
| `wk-real/` | **실물 WeKnora**(로컬 Docker v0.8.2) 대조 — `setup.ts`(계정·모델·KB·API 키) · `export.ts`(omnis_wklab → Markdown 말뭉치, Omnis 색인과 같은 범위) · `ingest.ts`(적재·폴링·ledger `wk-real-ingest`) · `bench.ts`(방법 `weknora-rag`·`weknora-agent`, 검색기 `WK-real`·`WK-real-chunk`). 띄우기·지우기 절차는 [`wk-real/README.md`](wk-real/README.md) |
| `ledger.ts` | `results/ledger.jsonl` 비용 장부 (run · 검색 평가 원가 누적). `npx tsx bench/ledger.ts` 로 합계 |

키: `.env` 의 `GEMINI_API_KEY`(있음). Anthropic 은 `ANTHROPIC_API_KEY`, OpenAI 호환은
`OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY`. 없는 벤더는 자동으로 건너뛴다.
DB 는 `DATABASE_URL`. 벤치는 읽기만 하지만, 검색이 질문 임베딩을 만들 때 `GeminiUsage` 에 행이 남는다.

`results/` 는 git 에 넣지 않는다 (답변 본문에 사내 대화가 그대로 들어간다). 질문 파일도 같은 이유로
저장소 밖 `~/work/omnis-import/eval/scenarios-260907.json` 이 기본이다 (`--questions` · `BENCH_QUESTIONS`).
형식: `{ "ask": [{ "q": "질문", "expect": ["기대 문자열", …] }] }`.
v4 선택 필드: `id`(있으면 qid · `--ids` 로 고른다. 없으면 A1, A2 …), `note`(출제 메모 — 심판 과정 점수에 준다), `type`(유형), `gold`(`[{source, sourceId}]` — 검색 지표의 정답 근거), `minSteps`, `stale`(옛 결정 문자열), `unanswerable`.
`gold` 의 `CHAT_MESSAGE` sourceId 는 메시지 ID 다. 없는 필드는 무시되므로 기존 파일이 그대로 돈다.

`BENCH_BUDGET_KRW` 는 `results.jsonl` 합계(답변 + 심판)부터 센다. 재개해도 이어서 센다. 판단은 질문 1건 단위라
상한을 넘는 마지막 1건(답변 + 심판)은 나간다. 임베딩 단가는 `config.ts` 의 `EMBEDDING_PRICE_USD_PER_M` (확인 필요).

WeKnora 이식 검색기(`wk/`)는 R2 부터 검색 단계에서 `gemini-3.5-flash-lite` 를 부른다. 그 원가는 검색 평가에선
ledger 의 retrieval 줄에, 생성 평가에선 행의 `costKrw` 에 더해진다. `wk/setup.sql` 은
`docker exec -i omnis-db-local psql -U omnis -d omnis_wklab < bench/wk/setup.sql` 로 한 번 건다 — 키워드가 전부
세 글자 이상일 때만 인덱스를 타고(두 글자 패턴은 trigram 이 안 나온다) 그 밖엔 순차 스캔이다. 청크 8천여 건에서 둘 다 100ms 안쪽이다.

심판(`judge.ts`)은 도구 루프 방법(native · route · wk-agent)에 **과정 점수 0~2** 를 더 매긴다 — 도구 순서·`minSteps`·`gold`(본 것/못 본 것)·`note` 를 주고
필요한 근거를 다 찾아 이었는지 본다. 같은 호출이라 심판 호출 수는 그대로다. 유형 규칙: `unanswerable` 은 없다/모른다면 2 · 지어내면 0(환각),
`stale` 은 옛 값을 현재 값으로 말하면 0, `ambiguous` 는 되묻거나 가정을 밝히면 2. 과정 점수가 없는 옛 행은 표에서 빈칸이다.

**심판 선택** — `BENCH_JUDGE` 로 고른다: `gemini-2.5-pro`(기본) · `gemini-3.8-flash` · `claude-sonnet-5`(API 키, 과금) ·
`claude-sonnet-cli` · `claude-haiku-cli`. 뒤 둘은 작업지시자의 Claude 구독으로 Claude Code 헤드리스(`claude -p`)를 부른다 —
청구가 없어 심판 원가는 0 으로 적고, API 요금표 환산액은 행의 `judgeNotionalUsd` 와 summary 상단 줄에 따로 남긴다.
생성 모델(Gemini)과 다른 계열로 채점하려는 목적도 있다. 문항 `BENCH_JUDGE_BATCH`(기본 10)개를 한 호출로 묶고
`BENCH_JUDGE_CONCURRENCY`(기본 2)개 묶음을 동시에 보낸다. `.env` 의 `ANTHROPIC_API_KEY` 는 호출 직전에 env 에서 지운다 —
남아 있으면 claude 가 그 키로 API 를 불러 과금된다. 매 호출의 `apiKeySource` 가 `none` 이 아니면 오류로 멈춘다.
**구독 사용량은 평소 Claude Code 쓰는 한도와 같은 통을 쓴다** (5시간 창). 큰 재채점을 돌리면 그 창 안에서
대화형 작업이 막힐 수 있고, 반대로 한도에 걸리면 채점이 멈춘다 — 그때는 채점한 행을 남기고 멈추므로 한도가 풀린 뒤
같은 명령(run 은 같은 `--run`, rejudge 는 같은 인자)으로 이어 돌린다. 행마다 `judgeModel` 을 남기고, 한 표에 심판이
섞이면 `summary.md` 에 경고 줄이 붙는다 — 심판이 다른 점수끼리 비교하지 않는다. `evidence` · `judgeInput` 저장은
2026-10-07 본측정 뒤부터라 그 전 행은 rejudge 가 건너뛴다.
