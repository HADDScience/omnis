---
kind: snapshot
status: active
canonical: mydocs/plans/2026-11-11-ai-usage-survey.md
last_verified: 2026-11-11
---

# AI 활용 설문 — 결과 (2026-11-11)

계획: [`plans/2026-11-11-ai-usage-survey.md`](../plans/2026-11-11-ai-usage-survey.md)

## 게이트

```
$ pnpm run verify
✖ 37 problems (0 errors, 37 warnings)        # 경고는 전부 기존 파일. 새 파일에서 난 것 없음

$ pnpm run test:unit
ℹ tests 673 · pass 673 · fail 0               # 그중 lib/ai-survey 36건

$ BASE_URL=http://localhost:3111 pnpm exec playwright test tests/feature/settings-ai-survey.spec.ts --project=feature --retries=0
  ✓ 구성원 — 눌러서 답하고 이어 하고 제출한다 (17.4s)
  ✓ 거부 — 폼에 없는 보기 · 지난 질문에 대한 응답 · 제출 뒤 응답 (3.0s)
  ✓ 관리자만 결과를 본다 — 회사 전체 추정 · 사람별 원문 · 대기 시간 (23.0s)
  3 passed (44.0s)
  # 로컬 next dev(NEXT_PUBLIC_IS_DEMO=true · OMNIS_AGENT_FAKE=1), 전용 DB omnis_survey. 전체 e2e 는 CI 에 맡겼다

$ ROUTES="/settings/ai-survey,/settings/ai-survey/results" node scripts/narrow-audit.mjs
· 320 · 280 · 240 · 200px 모두 overflow=0 bleed=0 clip=0 ellip=0   # tiny=2 는 데모 배너(기존)
```

## 로컬 실측 — 실제 모델(gpt-6.1-sol · 추론 low)

next dev · 로컬 DB(omnis_survey) · 설문 3건(폰 2 · PC 1) · 질문 30개, 모두 모델이 만든 질문. 결과 화면 「대기 · 비용」 탭의 값이다.

| 무엇 | 표본 | 중앙값 | 90% |
|---|---|---|---|
| 첫 질문 — 글자가 보이기까지(화면) | 3 | 2.0초 | 5.4초 |
| 첫 질문 — 폼이 뜨기까지(화면) | 3 | 3.0초 | 6.8초 |
| 첫 질문 — 첫 글자(서버) | 3 | 2.0초 | 2.9초 |
| 다음 질문 — 글자가 보이기까지(화면) | 27 | 1.7초 | 2.1초 |
| 다음 질문 — 폼이 뜨기까지(화면) | 27 | 3.0초 | 3.8초 |

- 첫 질문 90% 값이 큰 것은 서버를 띄운 직후 첫 요청(next dev 가 그 자리에서 컴파일, 화면 6.3초)이 표본 3개에 들어서다. 그 뒤 두 번은 화면 2.0초 · 1.5초.
- 비용: 모델 호출 30번 · 77.8원 — 한 번에 2.6원, 설문 한 건(10턴) 약 26원. 입력 캐시 87%(입력 48,452 중 42,039).
- 운영(Vercel) 값은 재지 않았다 — 머지 뒤 결과 화면 같은 탭에 쌓인다.

## 로컬에서 찾아 고친 것

- 슬라이더를 처음 누르면 누른 자리가 아니라 0 이 들어갔다 — 「맨 왼쪽 값도 답으로 받기」 를 버블 단계에서 받아 슬라이더가 정한 값을 덮었다. capture 로 옮겼다.
- 쓰는 날이 있는데 하루 0시간이면 강도가 「없음」 이 됐다 → 「가벼움」.
- 200px 에서 충족도 이름이 말줄임으로 잘렸다 → 줄을 바꾼다.

## 남은 것

- 등급 경계 · 「가벼움 = 2,200만」 · 작업 크기 보정 계수는 이 작업에서 둔 값이다 — 작업지시자 확인 필요.
- 구성원에게 설문을 알리는 길(알림 · 채팅 안내)은 만들지 않았다. 진입은 마이 → 사용량의 「설문 하기」 뿐이다.
- 운영 DB 마이그레이션(`20261111120000_ai_survey`)은 적용하지 않았다 — 머지 전에 먼저.
