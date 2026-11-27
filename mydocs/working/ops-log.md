---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-22-ops-metrics.md
last_verified: 2026-11-27
---

# 운영 장부 — 가동률 · 주간 에러 · 월 비용

12월 말까지 3개월치 운영 실측을 남기는 곳이다. 왜 이렇게 남기는지는 [`../plans/2026-10-22-ops-metrics.md`](../plans/2026-10-22-ops-metrics.md).
사용·AI 호출 지표는 여기 적지 않는다 — `KpiDaily` 가 매일 쌓는다(`scripts/kpi-export.ts --compute`).

**사람 이름 · 업무명 · 채팅 원문은 적지 않는다.** Vercel 에러의 표본 메시지에 업무명이 섞여 나오니 묶음 이름까지만 옮긴다.

## 기록하는 법

| 언제 | 무엇 | 어떻게 |
|---|---|---|
| 매주 월요일 | 지난주(월~일, KST) 런타임 에러 | Vercel MCP `get_runtime_errors` (since/until 로 그 주를 준다. 7일이 지나면 사라진다) 또는 대시보드 Observability → Errors. 묶음 이름 · 건수 · 처음/마지막(UTC) · 경로를 아래 표에 |
| 매월 초 | 지난달 가동률 · 장애 | `npx tsx scripts/uptime-report.ts --from YYYY-MM-01 --to YYYY-MM-말일` 의 출력 세 줄을 아래 표에. Actions 실행 기록은 90일 뒤 사라질 수 있다 |
| 운영에 반영할 때마다 | 백업 시점 · 마이그레이션 · 머지 · 배포 | 아래 「운영 반영」 표에 한 줄. 마이그레이션이 있으면 **적용 직전** 운영 Neon 시각과 `pg_current_wal_lsn()` 을 읽기 전용 질의로 남긴다(Neon 시점 복구 기준). 배포 ID 는 `vercel api "/v6/deployments?projectId=omnis-hadd&target=production&teamId=…"` |
| 매월 초 | 지난달 인프라 비용 | GCP · Neon · Vercel 콘솔의 청구서 금액. **출처를 같이 적는다** — 청구서 금액인지, 배분 결정인지 |

## 가동률 · 장애 (월)

`uptime` 워크플로가 30분마다 `/login` · `/api/health` 를 친다. 머지 뒤부터 쌓인다.
가동률 분모는 실제로 돈 회차다(GitHub 예약 실행은 늦거나 건너뛸 수 있다). 30분보다 짧은 장애는 놓칠 수 있다. DB 가용성은 재지 않는다.

| 달 | 센 회차 | 성공 | 가동률 | 장애 | 복구 시간 | 비고 |
|---|---|---|---|---|---|---|

## 런타임 에러 (주)

| 주 (KST) | 묶음 | 건수 | 처음 ~ 마지막 (UTC) | 경로 | 비고 |
|---|---|---|---|---|---|
| 10/15~10/21 | Gemini 일일 토큰 한도 초과 (embedTexts.RETRIEVAL_QUERY) | 4 | 10-19 02:08 ~ 04:49 | /api/ip-mcp | 코드 상한 100만 토큰/일. 장애 후보 — 아래 |
| 10/15~10/21 | Gemini 일일 토큰 한도 초과 (omnisAsk.route) | 3 | 10-19 02:07 ~ 02:08 | /api/ip-mcp | 같은 원인 |
| 10/15~10/21 | Gemini 일일 토큰 한도 초과 (column/drafts) | 1 | 10-19 06:48 | /api/website/column/drafts | 같은 원인 |
| 10/15~10/21 | record-proposals 추출 실패 (TimeoutError) | 3 | 10-20 01:48 ~ 10-21 01:20 | Vercel 표기 /api/website/media/… | AI 호출 타임아웃. 경로는 Vercel 이 붙인 값이라 실제 호출 지점과 다를 수 있다 |
| 10/15~10/21 | ai/draftCardUpdate 초안 실패 (TimeoutError) | 1 | 10-20 01:48 | 〃 | 같은 시각 타임아웃 |
| 10/15~10/21 | ai/detectKnowledge 판정 실패 (TimeoutError) | 1 | 마지막 10-20 01:48 | 〃 | 같은 시각 타임아웃 |
| 10/15~10/21 | DeprecationWarning DEP0169 `url.parse()` | 1 | 마지막 10-20 07:57 | /api/ip-mcp | 경고. 장애 아님 |

10/15~10/21 합계: 7묶음 · 14건. 2026-10-22 에 Vercel MCP `get_runtime_errors`(since 2026-10-14T15:00Z, until 2026-10-21T15:00Z)로 옮겼다.

### 장애 기록

자동 장부(uptime)가 생기기 전에 에러 묶음에서 찾은 것. 「장애」는 사용자 기능이 실패로 끝난 경우다.

| 시각 (UTC) | 무엇 | 영향 | 끝 | 근거 |
|---|---|---|---|---|
| 10-19 02:07 ~ 늦어도 10-20 00:00 | Gemini 일일 토큰 상한 100만 도달 (에러 메시지의 분모) | AI 질문 · 검색 임베딩 · 칼럼 초안 호출이 거절됐다 (8건, 마지막 06:48) | 상한은 서버 시각 0시에 풀린다 — `lib/gemini-usage.ts` 가 `startOfDay(new Date())` 로 세고 Vercel 함수는 UTC 다(한국 09시). 그 사이 언제 다시 됐는지는 기록이 없다 | 위 표의 한도 초과 묶음 3개 |

화면 오류는 `/api/errors` 가 GitHub 이슈로도 남긴다(`lib/github-issue.ts`, 운영에 `GITHUB_ISSUE_TOKEN` 이 있을 때). 9/28 이후 이 저장소 이슈는 0건이다(2026-10-22 `gh issue list --search "created:>=2026-09-28"`).

## 인프라 비용 (월)

| 달 | 항목 | 금액 | 출처 |
|---|---|---|---|
| 상한 | GCP (Gemini 포함) | 40,000원 | **배분 결정** 2026-10-07 — 회사 인프라 월 상한 50,000원 중. 청구액이 아니다 |
| 상한 | Neon | 10,000원 | **배분 결정** 2026-10-07 — 같은 상한 중. 청구액이 아니다 |
| 2026-09 | GCP · Neon | (미기록) | 콘솔 청구서에서 옮긴다 |
| 2026-09 · 10 | Vercel | 0원으로 보인다 | 청구 API `GET /v1/billing/charges` 가 `costs_not_found` (2026-10-21). 무료 플랜으로 본다 — 대시보드에서 확인 필요 |
| 2026-10 | GCP · Neon · Vercel | (11월 초에) | |

## 운영 반영 (배포 · 마이그레이션)

2026-11-27 에 10/22 이후 분을 git log · 작업 보고서로 되짚어 채웠다. 순서는 **운영 `db:deploy` → 머지 → 배포**다.
「백업 시점」은 마이그레이션 직전 운영 Neon 의 시각(UTC)과 LSN 이다. 되돌릴 때 Neon 콘솔의
Restore(시점 또는 LSN)로 이 시점의 브랜치를 만든다.

### 11/26 ~ 11/27 — 자세히

| 머지 (KST) | PR · 커밋 | 마이그레이션 | 백업 시점 (UTC) · LSN | 운영 배포 | 비고 |
|---|---|---|---|---|---|
| 11-26 18:25 | #273 `8cade97` | `20261126180000_job_posting_meta` (새 표 하나) | 09:24:51 · `0/4D28BD90` | `dpl_72ewsHk9ove5UN348ZyqJuUXQbfq` | 적용 뒤 `migrate status` 84개 up to date |
| 11-26 19:17 | #276 `41b3411` | 없음 | — | `dpl_55gWDNteR6XVm6jcMNC9g5cz48Pn` | `--match-head-commit` 스쿼시. `/api/errors` 시험 보고 1건(로그만) |
| 11-26 22:19 | #274 `d2a3142` | `20261126190000_grant_stages_v2` (enum → text · CHECK · 칸 추가) | 13:18:52 · `0/4D67F318` | `dpl_7NUEWH3urZQceZ7ExFhSj3WdZ1MN` | deploy 22:19:07~11 KST, 머지까지 약 25초. 그 사이 옛 코드의 쓰기는 없었다. 데모 DB 이름 함정 → `migration-traps.md` |
| 11-26 22:55 | #275 `f213254` | `20261126180000_workbench` (AiUsage 칸 둘 · 새 표 · OAuth client 한 줄) | 13:55:18 · `0/4D6FFA10` | `dpl_G4CdYAGt7uAdYv2PiCiuaZuFvhKj` | 같은 시각 접두의 `job_posting_meta` 가 먼저 적용돼 있어 `status` 로 미적용 1건만 확인. 환경변수를 넣은 뒤 같은 코드로 재배포 두 번(`dpl_642YbrFpijnRg7Jtiu3sRc6qRamf` · `dpl_GJ4EvJmPDyF7EeY9crvC8SVp8kwD`) |
| 11-27 10:33 | #278 `759b18a` | 없음 (문서) | — | `dpl_9KuoYGF6a9CEoxSVkgMmRoox75xW` | |
| 11-27 10:33 | #279 `051e630` | 없음 | — | `dpl_BNS91Lx6MnUHyiePwawxgKGkTSJP` | |
| 11-27 10:33 | #280 `5444d2a` | 없음 | — | `dpl_3tmP43twzvevjWShs4LeaU3nGL9x` | |
| 11-27 10:33 | #281 `4feac4b` | 없음 | — | `dpl_F42K8VFmRnUBWcY8unV4w2EWjpoE` | 카톡 이식 도구라 배포와 별개로 이식 체크아웃을 main 으로 옮겨야 켜진다 |
| 11-27 13:39 | #282 `683db8f` | `20261127200000_object_definitions` (새 표 다섯) + `objects:sync --apply --prod` | 04:22:55 · `0/4E21A0D8` | `dpl_EEEWv3DptViznzMbgKcHv1rm5LrU` | deploy 04:23:03~09 UTC. 첫 sync(04:23:23)는 `P2028` 로 통째로 되돌려졌다 — 아래 함정. timeout 60초로 고쳐 04:39:31 에 82건 11초, 다시 건식 0건. 배포 뒤 error · fatal · 5xx 0건 |

### 10/22 ~ 11/25 — 마이그레이션이 든 머지

배포 ID 는 Vercel 팀 이동(11/18) 전 것이 지금 팀 API 에 없어 11/24 부터만 적었다. 백업 시점은 보고서에 남은 것만 적었다.

| 머지 (KST) | PR · 커밋 | 마이그레이션 | 백업 시점 (UTC) · LSN | 운영 배포 |
|---|---|---|---|---|
| 11-26 09:06 | #266 `5a0f21b` | `20261125200000_grant_notices` · `20261125210000_grant_files` | 11-26 00:05:58 · `0/4CAEB680` | `dpl_FV4hWkhtmFDUM8Wub7m5C9Q6H9uv` |
| 11-25 19:03 | #263 `5c22057` | `20261125150000_crm_gel_types` · `…150100_crm_gel_types_data` · `…150200_crm_gel_ml_only` | 11-25 10:02:43 · `0/4C9ED668` | `dpl_7eTtXAxG31gxBTTH6kdRCDSox5Q5` |
| 11-25 18:19 | #264 `4c09055` | `20261125180000_grants_certs` | 11-25 09:18:25 · `0/4C957CC8` | `dpl_6PjNPfZ99FM67R8d4hQ58RMB8vjC` |
| 11-25 11:06 | #242 `7a7fbd9` | `20261125120000_chat_message_revision` | 기록 없음 | `dpl_CdvqA7nQXKmAoWxugVJF4td88Esq` |
| 11-24 16:50 | #258 `5341e46` | `20261124120000_job_applications` | 11-24 07:45:34 · `0/4B7474C0` (전체 덤프도 남김) | `dpl_EsN2HEGEYbTgyXkDBoy8eJFe7vf5` · `dpl_2cAjD5bDCWRBuqhUqb6RbvRAirTd` |
| 11-12 16:33 | #223 `bf1fd7a` | `20261112120000_onboarding_version` | 기록 없음 | 팀 이동 전 |
| 11-12 13:24 | #196 `f0bd996` | `20261111120000_session_share` | 기록 없음 | 〃 |
| 11-12 12:31 | #201 `469be2b` | `20261111150000_ip_case_images` | 기록 없음 | 〃 |
| 11-11 17:06 | #204 `46b4053` | `20261111180000_ai_survey_history` | 기록 없음 | 〃 |
| 11-11 13:36 | #194 `185785e` | `20261111120000_ai_survey` | 기록 없음 | 〃 |
| 11-11 11:38 | #190 `ee73036` | `20261110180000_omnis_mention_session` | 기록 없음 | 〃 |
| 11-10 15:38 | #187 `3eb74f9` | `20261110150000_file_r2_object` | 기록 없음 | 〃 |
| 11-10 11:57 | #183 `a729d57` | `20261110120000_app_setting` | 기록 없음 | 〃 |
| 11-10 10:55 | #181 `23662d0` | `20261110000000_feature_requests` | 기록 없음 | 〃 |
| 11-04 17:38 | #158 `536e2eb` | `20261104120000_file_transfer` | 기록 없음 | 〃 |
| 11-04 15:58 | #119 `5c602c3` | `20261029100000_ip_status_and_event` | 기록 없음 | 〃 |
| 11-04 10:41 | #145 `75751cb` | `20261104000000_ui_metrics` | 기록 없음 | 〃 |
| 11-03 13:43 | #137 `0612ffb` | `20261103000000_external_speaker` | 기록 없음 | 〃 |
| 10-31 21:20 | #134 `ac9fbc8` | `20261031000000_chat_message_changed_client` | 기록 없음 | 〃 |
| 10-30 17:34 | #133 `5824658` | `20261030120000_push_presence` | 기록 없음 | 〃 |
| 10-30 15:16 | #128 `df6b2a7` | `20261030010000_file_private_owner` | 기록 없음 | 〃 |
| 10-30 13:20 | #125 `8df4f49` | `20261030000000_agent_run_stopped` | 기록 없음 | 〃 |
| 10-29 23:00 | #121 `b9ec313` | `20261029060000_photo_description` | 기록 없음 | 〃 |
| 10-29 18:17 | #118 `179e2b0` | `20261029050000_push_prefs` | 기록 없음 | 〃 |
| 10-29 15:24 | #111 `8dff8c8` | `20261028010000_chat_room_kinds` 외 6개(agent_runtime · agent_run_sources · chat_folders · chat_folder_rules · chat_people_rooms · chat_room_hidden) | 기록 없음 | 〃 |
| 10-28 17:29 | #107 `1449d85` | `20261028100000_ip_explicit_dates` | 기록 없음 | 〃 |
| 10-28 13:39 | #105 `ff0a3ac` | `20261028000000_calendar_works_sync` | 기록 없음 | 〃 |
| 10-27 15:32 | #102 `0a17780` | `20261027000000_external_org_category` | 기록 없음 | 〃 |

마이그레이션 없는 머지는 git log 가 기록이다(`git log --first-parent origin/main`). 10/22 ~ 11/27 사이 main 첫 부모 커밋은 168개다.
