---
kind: decision
status: active
canonical: mydocs/plans/2026-11-26-hr-job-interview-meta.md
last_verified: 2026-11-26
---

# 지원서함 — 공고별 면접 일시 · 장소 칸

작업지시자 승인(2026-11-26). 지시서는 `~/work/omnis-reports/brief-hr-job-interview-meta-261126.md` 다.
면접자료 PDF(#271) 표지에 면접 일시 · 장소를 넣으려 했는데, 옴니스에 그 값을 적을 곳이 없었다.

## 결정

- **저장 위치: 새 표 `JobPostingMeta`(key = jobSlug).**
  - 공고 자체(이름 · 마감)는 홈페이지 원문이 정본이다(`lib/hr/jobs.ts`). 그래서 이 표에는 홈페이지에 없는 칸만 둔다.
  - 칸은 면접 일시 목록(JSON), 장소, 방식(IN_PERSON · VIDEO), 화상 링크, 메모다.
  - 줄이 없으면 아직 아무도 적지 않은 것이다. 시드에도 넣지 않는다.
- **일시는 JSON 목록 `[{ date, time, minutesEach? }]` 이다.**
  - 날짜 · 시작 시각, 그리고 선택으로 「한 사람 몇 분씩」을 적는다.
  - 공고 하나에 일시가 여러 개일 수 있고, 따로 조회할 일이 없어 별도 표로 나누지 않았다.
  - 모양 검사는 `lib/schemas/hr-job.ts` 에서 하고, 읽을 때 틀린 줄은 버린다.
- **화면: 공고 보드 머리에서 제자리 편집.**
  - 국가과제 제자리 편집(`feat/grants-inline-edit` 6805892)의 칸 컴포넌트를 쓴다.
  - 그 브랜치가 아직 main 에 없어, 파일 넷을 **바이트 그대로** 가져왔다: `lib/inline-field.ts` · `lib/inline-field.test.ts` · `components/grants/inline-field.tsx` · `components/grants/send.ts`. 두 브랜치가 같은 내용을 더하므로 나중에 합칠 때 충돌이 나지 않는다.
  - 칸 하나씩 PATCH 하고, 고치기 전 값(expect)을 붙인다. 그새 바뀌었으면 409 다.
- **권한:** 채용 담당만 고친다(`isHrReviewer`). 보드 화면부터 채용 담당만 연다.
- **PDF:** 서류 합격 묶음 표지에 값이 있는 칸만 줄로 넣는다. 다 비어 있으면 지금 표지와 같다.
- **도구:**
  - `list_applications` 공고 줄 아래에 면접 정보를 붙인다.
  - `update_job_posting` 을 새로 둔다. 쓰기(계획 → 확인)이고, 채용 담당만, 질문 경로 밖이다.
  - mode 는 문자열 enum(IN_PERSON · VIDEO · NONE)이다. Gemini 스키마 문제(#267 · #268) 때문에 숫자 enum · 빈 문자열 enum 을 쓰지 않는다.

## 단계

1. 표 · 마이그레이션 · 칸 규칙(Zod) · 서버 함수 · PATCH API
2. 보드 머리 제자리 편집 · PDF 표지 · 도구
3. 단위 시험 · e2e(@hr) · 캡처(가짜 데이터) → PR · CI

## 운영 반영(머지 전에)

1. 운영 DB 에 `prisma migrate deploy` 를 돌린다. 새 표 하나만 생긴다.
2. 머지한다.
3. 이번 공고(suwon-anchor-practicum-intern-2026-winter)의 실제 값은 운영 반영 뒤 지휘 세션이 화면 또는 `update_job_posting` 으로 넣는다.

되돌리기: `DROP TABLE "JobPostingMeta";`
