---
kind: snapshot
status: active
canonical: tests/scenario/full.spec.ts
last_verified: 2026-09-10
---

# 2026-09-10 — 도입 시나리오 전체 (킥오프 → 옴니스 AI 질의) 실측

작업지시: 벤치(9-09)에서 고른 조합 — **Gemini 3.8 Flash(thinking low) + 도구 라우팅 + 하이브리드 검색** — 을
main 에서 브랜치(`feat/omnis-ask-route`)를 파 구현하고, 9-08 의 4명 동시 킥오프 시나리오에 "옴니스 AI 로
회사에 대해 질의" 를 이어 붙인 하나의 시나리오로 돌려 토큰·지연·정확도를 남긴다.

## 구현한 것

| 무엇 | 어디 |
|---|---|
| Gemini 네이티브 함수 호출 루프 (thoughtSignature 되돌림, 사용량 기록, 503/429 재시도) | `lib/ai.ts` `runGeminiToolLoop` |
| 도구 라우팅 askOmnis — search_knowledge 는 직접(출처 수집), 나머지는 MCP 의 `runTool` | `lib/omnis-ask.ts` `askOmnisRoute` |
| 하이브리드 검색 (벡터 20 + 키워드 ILIKE 20 → RRF) | `lib/embeddings.ts` `retrieveHybrid` |
| 되돌리기 | `OMNIS_ASK_MODE=baseline` (이전 방식 그대로 남겨 둠) · 모델 `OMNIS_ASK_MODEL` (기본 gemini-3.8-flash) |
| 응답에 `meta` (모델·호출 수·토큰·단계별 ms·도구 자취) | 화면은 안 쓰고 e2e·벤치가 읽는다 |
| 벤치 `native` 방법 — 프로덕션 경로 그대로 재기 | `bench/methods.ts` |

MCP 의 `ask_omnis` 도 같은 함수라 함께 바뀐다. 전량 요약(업무 593건)은 더 이상 프롬프트에 들어가지 않는다.

## 시나리오 (tests/scenario)

| 파일 | 무엇 |
|---|---|
| `_kickoff.ts` | 9-08 킥오프 본문을 함수로 (`runKickoff`). `kickoff.spec.ts` 는 이를 부른다 |
| `_omnis-ask.ts` | 여러 사람이 동시에 `/omnis/ask` 에서 묻는 단계 (`runOmnisAsk`). 화면 시간·서버 meta·근거 적중·심판 점수, 보고서 저장 |
| `omnis-ask.spec.ts` | 질의만 (4명 동시, 16문항) |
| `full.spec.ts` | **킥오프 → 방금 한 일 4문항 + 회사 16문항** |

질문 파일은 `~/work/omnis-import/eval/omnis-ask-260910.json` (저장소 밖, `E2E_OMNIS_QUESTIONS`).
9-07 실측 10문항 + 집계·현황 6문항(지연 업무·내 업무·상표·특허·재고·견적). 지연·내 업무는 실행 시점에 `/api/tasks` 로 기대값을 만든다.
보고서는 `tests/scenario/reports/<태그>-full-omnis-ask.md|json` (git 밖).

```
BASE_URL=http://localhost:3001 npx playwright test --project=scenario tests/scenario/full.spec.ts
BASE_URL=http://localhost:3001 npx playwright test --project=scenario tests/scenario/omnis-ask.spec.ts
```

## 실측 (2026-09-10, 로컬 :3001 · 로컬 DB 스냅샷 · Gemini 실호출 · 심판 gemini-2.5-pro)

### 전체

| 단계 | 시간 | Gemini 호출 | 토큰 (입력 / 출력 / thinking) | 원 |
|---|--:|--:|---|--:|
| 킥오프 (4명: 지시 3건 · 보고·완료 5건) | 79s | structureTask 3 · rebuildTask 5 | 28,436 / 1,054 / 7,970 | 약 43 |
| 옴니스 질의 20문항 (4명 동시, 각 5문항) | 113s (동시 구간) | omnisAsk.route 52 (문항당 2.6) | 151,624 / 9,852 / 0 | 208 (10.4/문항) |

킥오프 원가는 GeminiUsage 표에서 뽑았다 (2.5-flash: 입력 $0.30 · 출력 $2.50). rebuildTask 가 thinking 을 켜고 돌아
5건에 7,970 토큰 — 킥오프 비용의 3/4 이다. 질의는 3.8-flash 할인가($0.75 / $3.75).

### 옴니스 질의 20문항

| 문항 | 오류 | 근거 적중 | 심판 평균 | 만점 | 환각 | 화면 p50 | 화면 p90 | 서버 p50 | 원/문항 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 20 | 0 | 92% | 1.85 | 17 | 1 | 6.3s | 13.3s | 4.8s | 10.4 |

| 누가 | 질문 | 근거 | 심판 | 화면 | 서버 | 호출 | 도구 | 원 |
|---|---|--:|--:|--:|--:|--:|---|--:|
| 정우창 | [09100209] 킥오프에서 대표님이 잡은 컨셉이 뭐였어? | 2/2 | 2 | 8.8s | 3.7s | 2 | search_knowledge | 4.64 |
| 노혜린 | [09100209] 뉴로힐 검사 키트 사양서는 몇 세트 기준으로 정리했어? | 1/1 | 2 | 8.1s | 3.1s | 2 | search_knowledge | 4.5 |
| 김아리 | [09100209] 자가검사 앱 화면 프로토타입은 어디까지 됐어? | 2/2 | 2 | 8.6s | 3.6s | 2 | search_knowledge → list_tasks | 5.57 |
| 허채정 | [09100209] 치매진단플랫폼 과제 킥오프 업무는 어떻게 됐어? 누가 뭘 했어? | 3/3 | 2 | 13.4s | 8.2s | 3 | search_knowledge → list_tasks → get_task | 10.05 |
| 정우창 | 아떼셀 로고는 어느 안으로 정했어? | 2/2 | 2 | 3.1s | 3.0s | 2 | search_knowledge | 5.21 |
| 김아리 | 케이바이오랩스 검수사진이랑 거래명세서 건은 어떻게 됐어? | 3/3 | 2 | 9.2s | 9.0s | 4 | search_knowledge → list_tasks → get_task → get_task | 16.85 |
| 허채정 | 애드힐 로고 D 도안화 어디까지 진행됐어? | 2/4 | 1 | 7.4s | 7.2s | 4 | search_knowledge → list_tasks → get_task → get_task | 13.64 |
| 정우창 | 중학생 박람회 체험 프로그램 준비물이 뭐야? | 3/3 | 2 | 5.3s | 5.2s | 2 | search_knowledge | 5.05 |
| 노혜린 | 발명특허대전 출품 신청은 누가 뭘 했고 마감이 언제였어? | 3/3 | 2 | 13.3s | 13.1s | 5 | search_knowledge → list_tasks → get_task → get_task | 17.84 |
| 김아리 | 스티커랑 스탠드 제작 결과 어땠어? 긴 스티커는 어디에 쓰기로 했어? | 1/3 | 1 | 3.3s | 3.2s | 2 | search_knowledge | 4.53 |
| 정우창 | 애드젤 2ml 완제품 재고랑 DNA 원료 재고 얼마 남았어? | 2/2 | 2 | 3.2s | 3.0s | 2 | crm_overview | 5.45 |
| 노혜린 | 다다사이언스 물품 사진 합성 건에서 어떤 품목들이 있었어? | 2/2 | 2 | 6.3s | 6.2s | 3 | search_knowledge → get_task | 9.14 |
| 허채정 | 대표님이 8월 말에 추가로 신청하자고 한 상표가 뭐야? | 2/2 | 1! | 9.3s | 9.1s | 2 | search_knowledge → ip_overview | 8.51 |
| 김아리 | 8월 25일 광교 현장 실사 브리핑은 누가 몇 시에 하기로 했어? | 3/3 | 2 | 6.1s | 6.0s | 2 | search_knowledge | 4.77 |
| 노혜린 | 등록된 상표가 몇 건이고 어떤 것들이야? | 3/3 | 2 | 4.1s | 3.9s | 2 | ip_overview | 5.18 |
| 허채정 | 홈페이지에 최근 올린 기사 두 건이 뭐야? | 2/2 | 2 | 5.0s | 4.7s | 3 | search_knowledge → get_task | 7.68 |
| 김아리 | 내가 담당하고 있는 진행 중 업무 목록 알려줘 | 3/3 | 2 | 9.8s | 8.6s | 3 | list_tasks → list_tasks | 27.72 |
| 김아리 | 한국뇌연구원에 나간 견적이 몇 건이고 합계가 얼마야? | 2/2 | 2 | 3.6s | 3.5s | 2 | find_org | 5.44 |
| 허채정 | 지금 지연된 업무가 몇 건이고 어떤 것들이야? 전부 알려줘 | 4/4 | 2 | 15.0s | 14.7s | 3 | list_tasks → list_tasks | 40.96 |
| 허채정 | 우리가 등록받은 특허는 몇 건이고 뭐야? | 3/3 | 2 | 5.0s | 4.8s | 2 | ip_overview | 5.2 |


### 읽히는 것

- **방금 한 일을 바로 찾는다.** 킥오프 직후 물은 4문항이 전부 만점. 채팅·업무가 저장될 때 색인되는 경로가 살아 있다.
- **집계 질문이 된다.** 지연 업무 전부(93건, `list_tasks overdue=true`), 내 업무, 상표·특허 건수, 재고, 기관별 견적 — 벤치 10문항에 없던 유형 6개가 모두 만점. 전량 요약 없이 도구로 셌다.
- **화면 시간의 대부분은 서버.** 화면 p50 6.3s 중 서버 4.8s. 서버 안에서는 모델 호출이 거의 전부고 도구(검색·DB)는 0.4~1초. 4명이 동시에 물어도 한 사람 때(벤치 4.9s)와 비슷하다.
- **비싼 문항은 목록이 긴 것.** 지연 업무 93건(41원)·내 업무(28원)는 list_tasks 결과가 커서 입력 토큰이 늘었다. 나머지는 4~17원.
- **틀린 두 문항은 검색 재현율.** 애드힐 로고(2/4)·스티커(1/3)는 첫 검색 8개에 기대 문장이 안 들어왔다. 벤치에서도 같은 문항이 낮았다. 상표 1문항은 심판이 환각으로 봤는데, 답 자체는 근거 2/2 를 맞혔다 — 심판이 도구 결과를 못 보는 한계.
- **이전 실행의 잔재가 DB 에 쌓인다.** 지연 업무 93건 중 다수가 9-08 이후 시나리오가 만든 `[MMDDHHmm]` 업무다. 실측 정확도에는 영향이 없지만 정리 스크립트가 필요하다.

### 현행 대비

| | 현행 (2.5-flash · 전량 요약, 벤치 9-09) | 이번 (3.8-flash low · 라우팅, e2e 9-10) |
|---|---|---|
| 심판 | 1.6 | 1.85 (집계 문항 포함) |
| p50 | 7.9s | 4.8s (서버) |
| 원/문항 | 15.8 | 10.4 |
| 입력 토큰/문항 | 19,820 | 7,581 |

## 남은 것

- rebuildTask·classifyMention 의 thinking 끄기 검토 (킥오프 비용의 3/4).
- 검색 재현율 — 애드힐·스티커 유형. top-K 를 8 → 12 로 늘리거나 시간 가중.
- 시나리오가 만든 업무 정리 스크립트.
- 실사용 배포 뒤 `OmnisQuery` 로 몇 주 관찰 → 회사 청구.
