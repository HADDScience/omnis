# bench/wk-real — 실물 WeKnora 대조

계획: [`mydocs/plans/2026-10-06-weknora-lab.md`](../../mydocs/plans/2026-10-06-weknora-lab.md) 단계 4.
Tencent WeKnora **v0.8.2** 공개 이미지를 로컬 Docker 로 띄우고, Omnis 실험 DB(`omnis_wklab`)와 같은 범위의 말뭉치를 넣는다.
그다음 bench 의 같은 문항으로 부른다.

| 파일 | 역할 |
|---|---|
| `client.ts` | WeKnora API 공통 (상태 파일 · JSON · multipart · SSE). 요청에 `Accept-Language: ko-KR` 을 붙인다 |
| `setup.ts` | 계정 → 모델(채팅·임베딩) → 지식베이스 → API 키. 다시 돌려도 있는 것은 다시 만들지 않는다 |
| `export.ts` | `omnis_wklab` → Markdown 말뭉치 + `manifest.json` (DB 는 읽기만) |
| `ingest.ts` | 말뭉치 → KB 업로드, 파싱·임베딩·요약이 끝날 때까지 폴링. 수치를 출력하고 ledger 에 `wk-real-ingest` 를 적는다 |
| `bench.ts` | 방법 `weknora-rag` · `weknora-agent` (methods.ts), 검색기 `WK-real` · `WK-real-chunk` (retrieval-eval.ts) |

사내 데이터가 들어간다. 말뭉치·상태 파일·Docker 볼륨은 모두 로컬에만 둔다. git 에는 넣지 않는다.

## 0. 경로 (.env)

워크트리 `.env` 에 세 줄이 있어야 한다. 값은 git 밖 폴더다.

```
WK_LAB_DIR=<스크래치>/wk-lab         # state.json (계정·API 키·모델·KB id), 로그
WK_CORPUS_DIR=<스크래치>/wk-corpus   # *.md + manifest.json
WEKNORA_BASE_URL=http://localhost:8581
```

## 1. 띄우기

WeKnora 클론(`bccb4b1`, 스크래치 `ext/WeKnora`)에서 띄운다. **빌드 스크립트·Makefile·install 스크립트는 쓰지 않는다.**
공개 이미지 `wechatopenai/weknora-{app,ui,docreader}:v0.8.2` 만 pull 한다.

```bash
cd <스크래치>/ext/WeKnora
# .env 와 docker-compose.override.yml 은 아래 "원본과 다른 설정" 대로 만든다 (이미 있음)
docker compose pull redis frontend postgres app
docker compose up -d --no-deps postgres redis
docker compose up -d --no-deps app          # docreader 없이 — 아래 참고
docker compose up -d --no-deps frontend
docker compose ps
curl -s http://localhost:8581/health        # {"status":"ok"}
```

- 프로젝트 이름 `weknora-lab`, 컨테이너 `WeKnora-{app,frontend,postgres,redis}`, 볼륨 `weknora-lab_*`.
- 호스트 포트: UI **8580**, app **8581**. ParadeDB·Redis 는 호스트에 열지 않는다.
- 기본 profile 만 쓴다. minio·neo4j·langfuse·sandbox·searxng 는 띄우지 않는다.

### docreader 를 띄우지 않은 이유

colima 의 Docker 디스크(`/var/lib/docker`, 20GB)에 남은 자리가 7.7GB 였다. app·ui·paradedb·redis 를 받고 나니 3.1GB 가 남았다.
docreader v0.8.2 는 압축 상태로만 1.45GB(arm64)다. LibreOffice·JDK·Python 이 들어 있어 풀면 몇 GB 가 더 든다.
그래서 받지 않았다. 다른 프로젝트의 이미지·볼륨은 지우지 않는다.

Markdown 은 docreader 를 거치지 않는다. 확장자 md 는 Go 안의 simple 파서로 간다(`internal/infrastructure/docparser/builtin_converter.go`).
KB 설정에도 `parser_engine_rules: md → simple` 로 못박았다. 이번 말뭉치에는 영향이 없다.
2단계(첨부 PDF·hwpx)에서 WeKnora 로 첨부를 파싱하려면 docreader 가 필요하다. 그때는 디스크를 늘려야 한다.

## 2. 설정

```bash
npx tsx bench/wk-real/setup.ts
```

| 항목 | 값 | 비고 |
|---|---|---|
| 채팅 | `gemini-3.8-flash` (gemini 공급자, 네이티브 generateContent) | 생각 수준은 요청마다 `reasoning_effort` 로 준다. bench 의 `@low` → `low` |
| 임베딩 | `gemini-embedding-001` **768 차원** | 공급자 `openai` + base_url `…/v1beta/openai`. 이유는 아래 |
| 리랭크 | **없음** | WeKnora 의 Gemini 공급자는 KnowledgeQA·Embedding 만 지원한다. 다른 벤더를 붙이지 않았다. 검색은 rerank 없이 융합(RRF) 순서 그대로 온다 (v0.8.2 응답에는 `meta.rerank` 가 없다) |
| KB | `omnis-wklab`, document | 하이브리드(벡터+키워드) 기본값, 청킹 `strategy: auto` · 512 / 80, md → simple, 요약 생성 기본값(켬, 요약 모델 = 채팅 모델) |
| API 키 | full_access 1개 (`omnis-bench`) | 평문은 `state.json` 에만 있다 |

**임베딩 768 차원.** v0.8.2 의 gemini 공급자는 차원을 `embedContentConfig.outputDimensionality` 에 넣는다.
Gemini API 는 이 자리를 무시하고 3072 차원을 돌려준다. base_url 을 `/openai` 로 바꿔도 같은 네이티브 경로를 탄다.
2026-10-06 에 직접 확인한 결과는 아래와 같다.

| 호출 | 차원 |
|---|--:|
| Gemini 직접 — `embedContentConfig.outputDimensionality: 768` | 3072 |
| Gemini 직접 — 요청 최상위 `outputDimensionality: 768` | 768 |
| Gemini 직접 — OpenAI 호환 `dimensions: 768` | 768 |
| WeKnora gemini 공급자 → 색인 | 3072 |
| WeKnora generic 공급자 → 색인 | 실패 (400, `truncate_prompt_tokens` 를 Gemini 가 거부) |
| WeKnora openai 공급자 + Gemini OpenAI 호환 경로 → 색인 | **768** |

모델과 키는 같다. 어댑터(프로토콜)만 다르다.

**언어.** 요청 헤더가 없으면 요약이 중국어로 나왔다. 서버 기본 언어가 zh-CN 이기 때문이다.
그래서 클라이언트가 모든 요청에 `Accept-Language: ko-KR` 을 붙인다. 서버의 `WEKNORA_LANGUAGE` 는 건드리지 않았다.

## 3. 말뭉치 내보내기 · 넣기

```bash
npx tsx bench/wk-real/export.ts     # → $WK_CORPUS_DIR
npx tsx bench/wk-real/ingest.ts     # 이어서 돌리면 이미 올린 문서는 건너뛴다
```

- **범위**: `EmbeddingChunk` 에 행이 있는 소스만 넣는다. Omnis 검색 색인과 범위가 같다. 카톡 이식 제외 대상은 색인에도 없어서 자동으로 빠진다.
- **문서 단위**
  - 업무 1건이 문서 1개다. 업무 필드, 체크리스트, 그 업무의 채팅 스레드(색인된 메시지만, 시간순)를 담는다.
  - 업무 밖 채팅은 방 × 날짜(KST)로 묶어 문서 1개로 만든다.
  - 지식재산권·주간보고·옴니스 카드는 1건이 문서 1개다. 본문은 색인 청크 그대로 쓴다.
- **대조 표식**
  - 문서 첫 줄에 `omnis:<SOURCE>:<sourceId>` 를 적는다. 채팅 묶음은 `omnis:CHAT_DAY:<날짜>` 다.
  - WeKnora 의 knowledge `metadata` 에는 `omnis_kind · omnis_source · omnis_source_id · omnis_message_count` 를 넣는다. 이 값은 검색 결과로만 돌아오고 모델 프롬프트에는 들어가지 않는다.
  - 포함 메시지 id 목록과 줄 앞머리는 `manifest.json` 에 둔다.
- **비용**: 요약(LLM)은 앱 로그 `[LLM Usage] purpose=document_summary` 줄의 실제 토큰을 합친다. 임베딩 토큰은 API·DB·로그 어디에도 없어서
  글자 수/4 로 추정한다. 둘을 합쳐 ledger 에 run `wk-real-ingest` 로 적는다.
  처음에는 요약도 글자 수/4 로 추정했다(출력 3.7만 토큰, 1,104원). 로그로 실측하니 출력이 41만 토큰, 합계 3,289원이었다. 요약 출력에 생각 토큰과 프로필 JSON 이 든다.

## 4. bench

```bash
npx tsx bench/retrieval-eval.ts --questions <v4 파일> --retrievers R0-hybrid,WK-real --repeat 1
BENCH_BUDGET_KRW=300 npx tsx bench/run.ts --models gemini-3.8-flash@low --methods weknora-rag,weknora-agent --questions <v4 파일> --ids v4-mh-01,v4-ag-01,v4-ex-01
```

**방법**

- `weknora-rag`: `POST /knowledge-chat`. 내장 빠른 답변(`builtin-quick-answer`)이 질의 재작성·확장, 검색, 생성까지 한다.
- `weknora-agent`: `POST /agent-chat`. 내장 스마트 추론(`builtin-smart-reasoning`, ReAct)이 돈다.
  **지금은 돌지 않는다.** v0.8.2 는 `search_knowledge` 도구를 쓰는 에이전트에 rerank 모델을 반드시 요구한다
  (`session_agent_qa.go`: `rerank model is not configured: please set rerank_model_id on the agent`). Gemini 계열 rerank 모델이 없어 막혔다.
- 내장 에이전트 두 개에는 `model_id`(채팅 모델)와 `web_search_enabled=false` 만 넣었다(setup.ts). 비어 있으면 「chat model is not configured」로 거절한다.
  나머지(임계값·반복 한도 50·도구·프롬프트)는 내장값 그대로다.
- 두 방법 모두 이 KB 만 쓰고 `web_search_enabled=false` 로 부른다. 웹검색 공급자도 등록하지 않았다.
- WeKnora 프롬프트는 그대로 둔다. 실물을 대조하는 것이기 때문이다.
  그래서 답 형식(인용 표기·머리말·길이)이 Omnis 팔과 다르다. 블라인드 A/B 에서 이 차이로 팔이 드러날 수 있다.

**결과 기록**

- `refs`·`seen`: 참조 청크를 문서 메타로 Omnis (source, sourceId) 에 대응시킨다. `seen` 은 청크 단위다.
- `evidence`: 참조 청크 본문이다. 결과당 3천 자, 전체 1만 2천 자로 자른다.
- 사용량은 다음 순서로 찾고, 어디서 왔는지 결과 행 `note` 에 적는다.
  1. WeKnora 앱 로그의 `[LLM Usage] … session_id=<세션>` 줄 합계 — 질의 재작성(`query_rewrite`)과 답변(`knowledge_qa`)이 따로 찍힌다.
     빠른 답변은 SSE 에도 DB(`messages.usage` 가 NULL)에도 사용량을 남기지 않아서, 한 턴의 LLM 호출을 다 담는 곳은 로그뿐이다
  2. SSE `complete.usage` (스마트 추론의 턴 합계)
  3. WeKnora DB `messages.usage`
  4. 글자 수/4 추정
- WeKnora 안의 질문 임베딩 호출은 어디에도 토큰이 남지 않아 원가에 들지 않는다 (질문 1건에 수십 토큰 — 0.01원 아래).

**검색기**

- `WK-real`: `POST /knowledge-search` 상위 10 청크를 문서 단위로 펼친다. 대표 소스와 포함 소스 전부를 그 순위에 넣는다.
- `WK-real-chunk`: 같은 결과를 청크 단위로 펼친다. 청크 본문에 줄 앞머리가 보이는 메시지만 넣는다.

## 원본과 다른 설정

| 어디 | 원본 기본 | 여기 | 이유 |
|---|---|---|---|
| `.env` `WEKNORA_VERSION` | latest | v0.8.2 | 고정 |
| `.env` `APP_PORT` · `FRONTEND_PORT` | 8080 · 80 | 8581 · 8580 | 80 은 etf-nginx |
| `.env` `COMPOSE_PROJECT_NAME` | (폴더명) | weknora-lab | 볼륨 이름을 구분 |
| `.env` DB·Redis 비밀번호, JWT · AES · 서명 키 | 예시값/빈값 | 무작위 | — |
| `.env` `TZ` · `LOG_LEVEL` | Asia/Shanghai · debug | Asia/Seoul · info | — |
| `.env` `LANGFUSE_*` | 예시 키가 들어 있음(자동 활성 시도) | 빈 값 + `LANGFUSE_ENABLED=false` | 텔레메트리 끔. 다른 텔레메트리 설정은 없다 |
| `.env` `SSRF_DNS_WHITELIST_ONLY` | false | **true** | 외부 통신 제한 |
| `.env` `SSRF_WHITELIST` | 빈값 | `generativelanguage.googleapis.com` | Gemini 만 |
| `.env` `SSRF_WHITELIST_EXTRA` | searxng,qdrant,milvus,weaviate,doris-fe,doris-be,minio | `docreader` | 내부 서비스만 |
| `docker-compose.override.yml` | `./config/config.yaml` 바인드 | 바인드 없음 → 이미지 안의 v0.8.2 config 사용 | colima 는 /Users 만 VM 에 공유한다. 클론이 /private/tmp 에 있어 바인드가 실패했다 |
| 서비스 | docreader 포함 | docreader 없음 (`--no-deps`) | 디스크. 위 1절 |
| 임베딩 모델 행 | gemini 공급자 | openai 공급자 + Gemini OpenAI 호환 URL | 768 차원. 위 2절 |
| 요청 헤더 | 없음 | `Accept-Language: ko-KR` | 요약·프롬프트 언어 |
| 내장 에이전트 `builtin-quick-answer` · `builtin-smart-reasoning` | `model_id` 없음 · `web_search_enabled: true` | 채팅 모델 id · `false` | 모델이 없으면 거절. 웹검색 끔 |

외부 통신 제한은 **앱 수준 검사**다. WeKnora 가 URL 을 쓰는 경로(모델 base_url, URL 가져오기, 웹 가져오기, MCP 등)에서
화이트리스트 밖 호스트를 DNS 조회 전에 거절한다. 컨테이너의 네트워크 자체를 막지는 않는다.
2026-10-06 확인 결과는 아래와 같다.

| 시도 | 결과 |
|---|---|
| 모델 base_url `https://example.com/v1` | 거절 (「仅允许白名单出站」) |
| 지식 URL 가져오기 `https://example.com/` | 거절 |
| 컨테이너 안에서 `curl https://example.com` | 200 (앱 밖이라 막히지 않음) |

## 지우기 (실험이 끝나면)

```bash
cd <스크래치>/ext/WeKnora
docker compose down -v          # 컨테이너 + weknora-lab_* 볼륨(ParadeDB·Redis·업로드 파일) 삭제
docker image rm wechatopenai/weknora-app:v0.8.2 wechatopenai/weknora-ui:v0.8.2 paradedb/paradedb:v0.22.6-pg17 redis:7.0-alpine   # 원하면
rm -rf <스크래치>/wk-corpus <스크래치>/wk-lab
```

`docker compose down -v` 는 이 compose 프로젝트(`weknora-lab`)의 컨테이너·볼륨만 지운다.
`omnis-db-local` · `omnis-db` · `etf-*` 는 다른 프로젝트라 지워지지 않는다. 그래도 지우기 전에 `docker compose ps` 로 대상을 확인한다.
