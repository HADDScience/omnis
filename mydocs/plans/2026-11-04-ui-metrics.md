---
kind: decision
status: active
canonical: mydocs/plans/2026-11-04-ui-metrics.md
last_verified: 2026-11-04
---

# UI 변경 적응 부담 측정

빠른 배포로 화면이 자주 바뀔 때 사람이 적응에 어려움을 겪는지 배포 단위로 잰다. 범위는 작업지시자 지시(2026-11-04) 그대로다.

**2026-11-04 작업지시자: 설문은 더 고민하기로 하고 수집만 진행한다.** `UI_SURVEY_ENABLED` 를 꺼서 화면이 묻지 않고, `GET /api/ui-metrics/survey` 도 물을 배포를 돌려주지 않는다(열어 둔 탭의 옛 빌드가 띄우지 못하게). 표 · 답 저장 API · 집계 화면은 남겨 두었다. 아래 설문 항목은 다시 켤 때의 설계다.

## 무엇을 모으나

| 이벤트 | 값 | 어디서 |
|---|---|---|
| `room_open_to_send` | 방을 연 뒤 첫 전송까지 ms(30분 초과는 버림) | `chat-panel` · `omnis-room` 보내기 |
| `attach_failed` | HTTP 상태 | `reportIncident` |
| `attach_retry` | — | 실패 뒤 10분 안에 다시 올릴 때 |
| `menu_open` · `menu_dismiss` · `menu_act` | — | `DropdownMenu` 의 `onOpenChange` 사유 |
| `plus_open` · `plus_dismiss` · `plus_act` | — | 같은 자리, 트리거가 입력창 ＋ 일 때 |
| `shortcut.{id}` | — | `useShortcut` |

행에는 사용자 ID · 이름 · 숫자 · 경로 형태 · 배포 커밋만 있다. `lib/ui-metrics/rules.ts` 의 스키마가 지킨다: 모르는 칸이 있으면 묶음을 통째로 거절하고, 이름은 목록 안에서만, 경로는 아는 칸 말고 전부 `:id` 로 바꾼다(서버에서 한 번 더).

## 결정

- **커밋은 화면이 그려진 빌드의 값이다.** 열어 둔 탭은 옛 빌드일 수 있어 서버의 `VERCEL_GIT_COMMIT_SHA` 가 아니라 빌드 때 번들에 넣은 값을 보낸다(`next.config.mjs`).
- **타이머가 없다.** 20건이 차거나 탭을 숨길 때만 보낸다. 자리를 비운 탭은 요청이 없어 Neon 을 깨우지 않는다. 실패하면 버린다.
- **배포 시각은 표에서 얻는다.** 커밋별 첫 기록 시각을 배포 시각으로 친다. 배포 표를 따로 두지 않으려는 것이다. 배포 당일 아무도 안 쓰면 다음 날이 기준이 된다.
- **설문 대상은 하나다.** 어제까지 처음 쓰인 배포 중 이 사람이 써 본 가장 새 배포만 본다. 답하거나 닫으면 옛 배포로 넘어가지 않으므로 하루 한 번을 넘지 않고, 7일이 지나면 묻지 않는다. 닫음도 행으로 남겨 기기가 달라도 다시 묻지 않는다.
- **설문 확인은 하루 한 번.** 접속 · 탭 복귀 때 이 기기에서 오늘 확인했는지 보고 한 번만 묻는다. 온보딩 · 앱 설치 권유가 떠 있거나 입력칸에 쓰던 글이 있으면 띄우지 않고 다음 복귀로 미룬다.
- **운영에서만 켠다.** `VERCEL_ENV=production` 이고 데모가 아닐 때. 프리뷰가 운영 DB 를 볼 수 있어서다. e2e · CI 는 `NEXT_PUBLIC_UI_METRICS=1` 로 켠다.
- **정리는 `cron/daily` 에서.** 크론을 더 두면 Neon 을 한 번 더 깨운다. 사용 기록만 90일이고, 점수 · 한 줄은 배포 간 비교를 위해 남긴다.
- **입력창 파일을 고치지 않는다.** `room-composer.tsx` · `message-input.tsx` 무변경. ＋ 메뉴는 `DropdownMenu` 가 트리거의 `aria-label="추가"` 로 가른다.

## 알려진 한계

- 폰의 ＋ 는 PR #144 부터 `ComposerPlusSheet` 다. `plus_*` 를 시트와 `ComposerPlus` 에 이었다. PC 메뉴는 `DropdownMenu` 그대로다.
- 코드 변경이 없는 배포(문서만)에도 설문이 나간다.
- 데모 e2e 는 첨부가 꺼져 있어 첨부 실패 · 재시도는 단위 시험으로만 잰다.
