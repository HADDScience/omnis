---
kind: decision
status: active
canonical: mydocs/plans/2026-09-09-model-method-benchmark.md
last_verified: 2026-09-09
---

# 2026-09-09 — 모델 × 방법론 그리드 벤치마크

작업지시자 결정: 벤더를 먼저 정하지 않는다. 모델과 컨텍스트 방법론을 그리드로 놓고
**비용(원) · 시간(ms) · 품질(점수)** 를 같은 질문으로 재서 데이터를 쌓은 뒤, 싸고 빠르고 정확한
조합을 고른다. 테스트 비용은 작업지시자가 개인 부담하고, 실사용 검증 후 회사에 청구한다.

## 왜

- 옴니스 질문(askOmnis)은 검색 top-8 에 업무 593건 전량 요약을 매번 얹는다. 질문당 15~30원,
  업무가 늘수록 단가가 오르고, 집계 질문은 top-K 에서 새고, 지식 카드는 검색으로만 닿는다
  (분석: 2026-09-08 대화).
- 속도 문제가 있다. 어느 단계(임베딩 호출 · 현황 DB 조회 · 생성)가 느린지 실측이 없다.
- Gemini 2.5 Flash 는 구세대라 언젠가 끝나고, 3.x Flash 는 2027년부터 5배 값이다. 벤더 결정을
  실측 없이 할 이유가 없다.

## 그리드

**모델 축** — `bench/config.ts` 의 `MODELS`. 한 항목 = 모델 ID + 생성 설정(thinking 등). 같은 모델의
thinking 켬/끔은 별도 항목이다. 키가 없는 벤더는 자동으로 건너뛴다.

| 벤더 | 후보 (싼 것부터) | 키 |
|---|---|---|
| Gemini API | gemma-4-26b · gemma-4-31b (무료) · 2.5-flash-lite · 3.1-flash-lite · 2.5-flash (현행) · 3.5-flash-lite · 3.8-flash | `GEMINI_API_KEY` (있음) |
| Anthropic | Haiku 4.5 · Sonnet 5 | `ANTHROPIC_API_KEY` |
| OpenAI 호환 | (선택) Groq 의 Gemma · GPT mini 계열 | `OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY` |

**방법론 축** — `bench/methods.ts`.

| 이름 | 무엇 | 재는 것 |
|---|---|---|
| `baseline` | 지금 askOmnis 그대로. 벡터 top-8 + 업무·IP·CRM 전량 요약 | 현행 기준선 |
| `vector` | 벡터 top-8 만. 요약 없음 | 요약이 얼마나 기여하는지 |
| `hybrid` | 벡터 + 키워드 일치를 RRF 로 합친 top-8. 요약 없음 | 고유명사 질문에서 키워드의 효과 |
| `stuff` | 검색 없이 요약 + 카드 전문 + 최근 60일 채팅을 통째로 | "20만 토큰 아래면 다 넣어라" 의 실제 값 |
| `route` | 도구 호출 루프(최대 5단계). 모델이 search_knowledge · list_tasks · crm_overview 등을 골라 부른다 | 라우팅의 정확도·지연·비용 |
| `native` | 프로덕션 `askOmnisRoute` 그대로 — Gemini 네이티브 함수 호출 + 하이브리드 검색 (9-10 추가) | 실제 배포 경로의 회귀 |

`route` 는 벤더마다 다른 네이티브 함수 호출 대신 **JSON 응답 프로토콜** 하나로 돌린다. Gemma 처럼
함수 호출이 없는 모델도 같은 조건으로 비교하기 위해서다. 네이티브 함수 호출은 다음 축이다.

**질문** — `~/work/omnis-import/eval/scenarios-260907.json` (저장소 밖, 사내 업무가 적혀 있어서). 카톡 이식 실측에 쓴 10문항(근거 문자열 27개).
지원사업·수상 자료는 아직 DB 에 없어 이번 판에는 없다. 모델로 올린 뒤 문항을 더한다.

## 재는 값

| 축 | 어떻게 |
|---|---|
| 비용 | 응답의 usage(입력·출력·thinking·캐시) × `config.ts` 요금표(2026-09-08 공식 페이지) × 환율 `BENCH_KRW_PER_USD`(기본 1,380) |
| 시간 | 단계별 wall-clock: 검색(임베딩 호출 + pgvector) · 컨텍스트 조립(현황 DB 조회) · 생성(호출별) · 합계 |
| 품질 | ① 근거 문자열 적중률(기존 지표) ② 심판 모델이 0·1·2 점 + 환각 여부 (`bench/judge.ts`, 기본 gemini-2.5-pro) |

## 실행

```
npx tsx bench/run.ts --models gemini-2.5-flash,gemini-2.5-flash-lite --methods baseline,route
npx tsx bench/run.ts            # 키 있는 모델 전부 × 방법 전부
npx tsx bench/report.ts bench/results/<run>/results.jsonl
```

결과는 `bench/results/<날짜-시각>/results.jsonl` 에 한 줄씩(모델 × 방법 × 질문) 쌓이고 중단 후 다시
돌리면 이어서 한다. `report.ts` 가 표(`summary.md`)와 CSV 를 만든다.

DB 는 `DATABASE_URL` 을 그대로 쓴다. 벤치가 쓰는 것은 읽기뿐이지만 검색이 질문 임베딩을 만들 때
`GeminiUsage` 에 사용량 행이 남는다 (프로덕션 코드와 같은 경로).

## 범위 밖

- 업무 자동생성(structureTask)·재구성(rebuildTask)의 모델 비교. 다음 판.
- 네이티브 함수 호출, 컨텍스트 캐싱, 임베딩 모델 교체.
- 결과를 보고 코드를 바꾸는 일. 이 판은 데이터를 만드는 것까지다.
