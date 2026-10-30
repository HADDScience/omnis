---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-30-photo-followup.md
last_verified: 2026-10-30
---

# 사진 검색 후속 — 사진 묶음 · 카톡 사진 설명 · 운영 검색

브랜치 `fix/omnis-photo-answer`. 사용자 지시의 여섯 항목을 이어 진행했다.
push·PR·머지는 아직 하지 않았다. 운영 검색 원문과 스크린샷에는 사내 자료가 있어
저장소 밖 `~/work/omnis-import/photo-followup-261030/`에 보관한다.

## 사진 묶음 화면

실제 로컬 앱(`localhost:3104`)에서 로그인 세션을 만들고, 운영 사진을 읽어 PC·폰 화면을 확인했다.
10개 출처를 단 시험용 답글은 로컬 임시 방에 만들었으며 확인 뒤 방·글·질문 기록을 삭제했다.
운영에 시험용 방이나 사진을 만들지 않았다.

- 1440·375·320·280·240·200px에서 9개 타일 + `+1`, 확대, 다음 단추, 왼쪽 화살표 키, Escape 닫기를 확인했다.
- 처음 뷰어 버튼 26~29px → 폰에서 이전/다음/닫기/원본 열기 모두 44px 이상으로 수정했다.
- 200px에서 세 타일의 최소 터치 폭 때문에 묶음이 9px 잘리는 것을 확인했다.
  묶음 자체 폭이 140px 미만일 때 줄을 접게 해 해결했다. 보통 폭의 3장 줄은 유지한다.
- 로컬 썸네일: HTTP 200 · `image/webp`. 로컬 스냅샷 사진은 운영 NAS 경로를 읽어야 한다.
  기본 `_dev/files` 경로로는 404여서 검증 서버에만 운영 NAS 경로를 지정했다. DB는 로컬을 유지했다.
- 사진 내용·스크린샷: `album-{폭}.png`, `viewer-{폭}.png`, `album-results.json`.

별도로 로컬 `/omnis/ask` 실제 입력창에 **“부스 운영하는 사진 찾아줘”**를 입력해 모델과 검색을 호출했다.
HTTP 200, PHOTO 근거 20개 중 답이 인용한 **5장**이 한 묶음(3+2)으로 표시됐고 5장 모두 로드됐다.
PC·폰 화면은 `live-album-1440.png`, `live-album-375.png`, 응답은 `local-live-answer.json`에 보관했다.
이 질문 기록은 로컬 DB에만 남았다. 운영 질의 10개와는 다른 확인이다.

실측 명령:

```text
pnpm exec tsx --env-file=.env ~/work/omnis-import/photo-followup-261030/check-album.mts
각 폭: tiles=9, loaded=9, small=0, overflow=false, next=true, previous=true
photoHttp=200, type=image/webp
```

## 기존 사진 처리 — 구독 한도로 중단

운영 DB 대상은 Neon 호스트임을 확인한 뒤 실행했다. 사진 처리 지시는 이번 사용자 요청에 따른다.

```text
pnpm exec tsx scripts/photo-backfill.ts --target prod --dry
대상 1146장 · prod · claude sonnet · 동시 3

pnpm exec tsx scripts/photo-backfill.ts --target prod --workers 3
대상 1146장 · prod · claude sonnet · 동시 3
[Claude 실행 실패 반복 → 중단]

env -u ANTHROPIC_API_KEY -u CLAUDECODE claude -p --model sonnet --allowedTools Read --output-format json 'Reply only OK'
is_error: true
result: You've hit your 5-hour limit · resets 1pm (Asia/Seoul)
```

이 실행에서 설명 완료가 늘지 않았다. API 과금으로 바꾸지 않았다.
실패를 사진마다 반복하던 기존 경로는 공용 CLI 함수로 옮기면서 한도 감지 후 중단하도록 바꿨다.
변경 뒤 실제 1장 실행으로 exit 1과 한도 오류를 확인했다:

```text
pnpm exec tsx scripts/photo-backfill.ts --target prod --limit 1 --workers 1
1/1 (성공 0 · 못 읽음 0 · 실패 1)
끝 — 성공 0 · 못 읽음 0 · 실패 1
ClaudePhotoLimitError: Claude 구독 사용 한도에 도달했습니다. 초기화 뒤 다시 실행하세요.
```

별도 집계에서 설명은 있는데 PHOTO 색인이 없는 1장을 발견해 `syncEmbeddings("PHOTO", id)`로 복구했다.
사내 검증 스크립트 `repair-photo-index.mts` 출력:

```text
운영 설명 있는 사진 중 색인 누락 1장
색인 복구 1/1
```

최종 집계: 전사방 유효 사진 **1,684장 · 설명 완료 538장 · 미설명 1,146장 · PHOTO 색인 538장 · 설명 완료 중 색인 누락 0장**.
구독 초기화 뒤 backfill을 다시 실행해야 한다. `describedAt`이 비어 있는 것만 처리하므로 설명 완료분은 건너뛴다.

## 카톡 이식 사진 설명

`첨부 → 사진 설명 → 임베딩`의 7단계로 늘렸다.

- `ingest()`의 세션 목록은 과거 마스터 전체다. 이를 사진 대상으로 쓰면 다른 CSV의 사진까지 처리하므로,
  이번 CSV를 다시 읽어 메시지 원본 키로 사진을 제한한다.
- 전사방의 PNG/JPEG/WebP만 설명한다. 삭제된 메시지·DM·비사진은 제외한다.
- Claude 구독 sonnet, 동시 최대 3개. 앱의 API 키와 `CLAUDECODE`를 자식에 넘기지 않는다.
- backfill과 이미지 축소·프롬프트·CLI 오류 처리를 공유한다. 임시 이미지는 성공/실패 모두 삭제한다.
- 설명은 공용 `savePhotoDescription`으로 저장하고, 사진 색인은 마지막 임베딩 단계에서 처리한다.
  `--no-embed`는 사진에도 적용된다. 설명이 이미 있어도 이번 CSV의 사진 ID를 마지막 단계에 넘겨 색인 실패를 재시도할 수 있다.
- `--dry`는 사진 파일·모델을 열거나 DB에 쓰지 않고 대상만 집계한다.
- 실패하면 종료 상태를 실패로 남기고 같은 CSV 재실행으로 미설명분을 이어 처리한다. 구독 한도에 닿으면 대기열을 멈춘다.

## 운영 검색 질의 10개

운영 `https://omnis.haddscience.com`에 로그인된 Chrome 탭에서 같은 오리진의
`POST /api/omnis/ask`를 호출했다. 쿠키나 인증 비밀을 추출하지 않았다.
공개 저장소에는 질문·답변의 연락처나 사내 세부 내용을 싣지 않고 주제와 계측만 남긴다.
원문 질문·답·출처 ID·순위: `prod-search-results.json`.

앞 8개는 기존 실험 `gt.json`의 test 중 실제 사진 첫 8개(합성 민감정보 표본 제외)의 첫 질의다.
정답 사진이 아직 미설명이어도 표본에서 빼지 않았다. 마지막 2개는 부스 사진과 명함 전화번호 사진이다.

| # | 질의 주제(요약) | HTTP | PHOTO 근거 수 | 정답 설명 완료 | 정답 PHOTO 순위 | 지연 ms |
|---|---|---:|---:|---|---:|---:|
| 1 | 수상 기사 대화 캡처 | 200 | 1 | 아니오 | 없음 | 22,751 |
| 2 | 행사 홍보 참여 건수 | 200 | 5 | 예 | 1 | 9,138 |
| 3 | 주차 할인 매뉴얼 | 200 | 3 | 아니오 | 없음 | 17,083 |
| 4 | 교육 포스터 | 200 | 12 | 아니오 | 없음 | 22,648 |
| 5 | 비즈니스 모델 슬라이드 | 200 | 13 | 아니오 | 없음 | 13,965 |
| 6 | 바이오 교류회 포스터 | 200 | 5 | 아니오 | 없음 | 8,867 |
| 7 | 실증 발표 기대효과 페이지 | 200 | 2 | 아니오 | 없음 | 21,064 |
| 8 | 시장규모 TAM/SAM/SOM | 200 | 7 | 아니오 | 없음 | 8,287 |
| 9 | 부스 운영 사진 | 200 | 8 | 해당 없음 | — | 11,586 |
| 10 | 명함 전화번호 사진 | 200 | 5 | 해당 없음 | — | 8,135 |

HTTP 200은 검색 품질 통과를 뜻하지 않는다. #4는 답변 도구 단계 한도로 답을 정리하지 못했다.
#1·#6·#7 등은 업무 첨부 경로를 통해 해당 파일을 답에 언급했지만 정답 사진의 PHOTO 근거는 없었다.
정답이 있는 8개 중 설명 완료 표본은 1개뿐이며 그것만 PHOTO 1위로 반환됐다.
미처리 1,146장 설명과 색인을 끝낸 뒤 같은 10개로 다시 확인해야 한다.
마지막 두 질의가 반환한 사진 전부의 의미상 적합도는 별도 채점하지 않았다.

운영 사진 썸네일도 실제 요청으로 확인했다:

```text
운영 사진 HTTP 200 · image/webp
```

## 품질 게이트

```text
pnpm run verify
$ tsc --noEmit
$ eslint
37 problems (0 errors, 37 warnings)
exit 0

pnpm exec tsx --test lib/photo-cli.test.ts lib/photo-album.test.ts lib/photo-text.test.ts
tests 10 / pass 10 / fail 0

pnpm exec tsx scripts/verify-photo-import.ts
✓ dry: 이번 CSV 전사방 사진만 선택 · DM/삭제/비사진/다른 CSV 제외 · 저장 없음
✓ 잘못된 JSON 저장 거부 · 설명 저장 시 임베딩 생략
✓ 재실행: 설명 완료 사진은 NAS/Claude 호출 없이 건너뛰고 색인 대상 ID를 유지
```

CLI 시험은 가짜 `claude` 실행 파일로 키 제거·임시 파일 삭제·한도 오류·비정상 종료·빈 응답 거부를 확인한다.
로컬 DB 검증은 임시 행을 만들고 끝에 지운다. 외부 모델·임베딩 API를 호출하지 않는다.

최종 빌드는 운영 환경 파일 링크를 제거하고 로컬 `.env`만 있는 상태에서 실행했다.
빌드 뒤 CLI 재개를 위해 `../omnis-local/.env.production.local` 링크를 복원했다.
검증용 링크는 이번 작업에서 만든 것이며 원본 운영 환경 파일은 수정하지 않았다.

```text
pnpm run build
✓ Compiled successfully in 15.2s
✓ Generating static pages using 11 workers (75/75) in 330.6ms
exit 0
```

정확한 빌드 시간과 전체 경로 목록은 `build.log`에 있다. 기존 CSS `::highlight` 최적화 경고 2개가 있다.
사진 변경은 UX 규칙 11~30을 점검했다. 신규 뷰어 조작은 키보드·모바일 터치로 확인했고,
사진 저장/파싱은 기존 Zod 경로를 유지한다. 아래 전체 화면 실패 때문에 UX 게이트 전체 통과로 기록하지 않는다.

```text
AUDIT_TOKEN=<로컬 세션> BASE_URL=http://localhost:3104 ROUTES=/chat/<임시방> node scripts/narrow-audit.mjs
320px overflow=0 bleed=0 clip=11 ellip=11 tiny=10
280px overflow=0 bleed=0 clip=11 ellip=11 tiny=10
240px overflow=0 bleed=0 clip=2 ellip=2 tiny=10
200px overflow=0 bleed=0 clip=2 ellip=2 tiny=10
잘리거나 넘친 화면: 4 / 4
exit 1
```

남은 잘림은 기존 방 제목/부제와 참고자료 제목의 `truncate`다. 200px 사진 묶음 자체 잘림은 수정 뒤 사라졌다.
작은 타깃 10개는 기존 본문 각주 버튼(13~20px)이다. 새 뷰어의 4개 조작은 모두 44px 이상이다.
전체 검사 실패를 면제하지 않았으며 공유 방 헤더·각주 UI까지 이번 변경에서 임의로 확대하지 않았다.

```text
pnpm run test:e2e:local
46 passed / 1 skipped / 1 failed (4.6m)
실패: onboarding 장면 순서 — /omnis 이동 대기 timeout

pnpm run test:e2e:local -- --grep '장면 순서대로'
46 passed / 1 skipped / 1 failed (3.9m)
실패: tasks-overview 캔버스 업무 더블클릭 — /tasks에서 UUID 상세로 이동하지 않음
```

두 번째 명령은 옵션 앞의 `--`가 러너까지 전달돼 의도한 단일 시험 대신 전체 48개를 다시 실행했다.
온보딩 시험은 두 번째 실행에서 통과했지만 다른 실패가 생겼으므로 전체 E2E 통과로 간주하지 않는다.
독립 임시 DB 두 개는 실행기가 삭제했고 로그는 사내 결과 폴더의 두 E2E 로그 및 각 로그에 적힌 임시 경로에 있다.

로컬 커밋:

- `d906a0b`: 기존 사진 묶음 구현(이전 세션).
- `f8e4eb7`: 사진 묶음의 좁은 화면 잘림·뷰어 터치 타깃 수정 및 후속 계획.
- `f7eade0`: 카톡 설명 단계·공용 구독 CLI·한도 중단 및 거부 사례 검증.

## 남은 승인·작업

1. Claude 구독 초기화 후 1,146장 설명·색인을 이어 처리하고 같은 운영 질의를 재실행한다.
2. 좁은 화면 전체 검사와 E2E의 미통과 항목을 해소해야 push할 수 있다. 검사를 통과로 취급하거나 생략하지 않았다.
3. push·PR·머지는 사용자 승인 전이다. PR 본문 초안은 사내 결과 폴더에 준비한다.
4. 삭제할 완료 워크트리 두 경로가 확인되지 않아 삭제하지 않았다. `omnis-photo-search`의 PR #121 병합과 깨끗한 상태는 확인했다.
