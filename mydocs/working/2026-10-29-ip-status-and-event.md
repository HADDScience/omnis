---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-29-ip-status-and-event.md
last_verified: 2026-11-04
---

# 지식재산권 상태 5개 + 사건 — 결과

계획: `mydocs/plans/2026-10-29-ip-status-and-event.md`

이 저장소는 공개다. 건별 전환 표와 운영 데이터 수치는 저장소 밖 보고서에 두었다.

## 시험 환경 (2026-11-04)

- 운영 `ip` 스키마를 읽기 전용 세션으로 덤프해 로컬 격리 DB 에 복원했다. 시험 뒤 DB 와 덤프를 지운다.
- 격리 DB 는 main 의 마이그레이션 전부를 적용한 뒤 `ip` 스키마만 사본으로 바꿨다.
  `ip` 가 참조하는 사용자는 id 만 같은 임시 행으로 넣었다.

## 마이그레이션 결과

| 확인 | 결과 |
|---|---|
| 적용 전 `rebuild_ledger` | 다른 칸 0행 |
| `migrate deploy` (뒤 마이그레이션이 이미 적용된 상태) | 이 한 건만 적용 |
| 표대로 상태 전환 · 상태 밖의 칸(이름 · 번호 · 날짜) | 전 건 일치 · 변화 없음 |
| 적용 뒤 `rebuild_ledger` | 다른 칸 0행 |
| 진행 기록의 `status` 비어 있는 행 | 0 |

## 되돌리기

```
덤프 복원 + _prisma_migrations 행 삭제 → 표 md5 · 칸 · 함수 · 제약 · 건별 대장이 적용 전과 동일
중간 실패(P3018) → 표·칸이 하나도 남지 않음. 다시 deploy 는 P3009 로 멈춤
원인 수정 + migrate resolve --rolled-back + deploy → 첫 결과와 동일
```

제자리에서 되돌리는 SQL 은 없다. 새 사건(우선심사신청 등)은 옛 단계에 해당 값이 없어 그대로 옮길 수 없다.
덤프 복원은 백업 뒤에 쓴 기록을 잃으므로, 복원 전에 코드를 먼저 되돌린다.

## 마이그레이션과 머지 사이

옛 코드가 새 스키마에서 돌 때 대장 값으로 옛 단계를 쓰면 외래키에 걸려 거부된다. 값이 틀어지지는 않는다.
옛 양식이 상태 이름 중 「출원전」·「거절」을 단계로 보내도 거부된다. 그래서 적용 뒤 머지까지의 간격을 짧게 잡는다.

## 검증 (합친 뒤, 격리 DB)

```
$ pnpm run verify
✖ 40 problems (0 errors, 40 warnings)

$ pnpm run build
exit 0

$ npx tsx --test lib/ip/status-compat.test.ts
pass 7, fail 0

$ npx tsx scripts/verify-ip-dates.ts
53 통과 · 0 실패 (변경은 되돌렸다)

$ npx tsx scripts/verify-ip-mcp.ts
실패: 43 passed, 1 failed     # viewer 의 쓰기는 거절된다

$ npx tsx scripts/verify-ip-api.ts
실패: 13 passed, 3 failed     # 구성원 아님 403 · 내 역할 viewer · viewer 쓰기 403
```

실패 4건은 모두 main 의 `getIpAccess`(`lib/ip-data.ts`)가 권한을 낮춘 결정과 시험 기대값이 어긋난 것이다.
그 결정 뒤 두 스크립트가 고쳐지지 않았고, 이 브랜치의 상태 전환과는 무관하다. 기대값은 건드리지 않았다.

`verify-ip-import.ts` 는 17 통과 · 3 실패다. 실패는 2026-09-02 기준 고정 행 수(`members`·`progress_entries`·`member_prefs`)다.

`/ip` 를 헤드리스 브라우저로 확인했다. 건수 칸과 필터 칩이 상태 5개로 나오고 페이지 오류와 5xx 는 없었다.
진행 양식을 열어 사건 슬라이더를 눌러 보는 것은 하지 못했다.

## 운영에 남은 일 (작업지시자 승인 필요)

1. 직전 백업 다시 뜨기 → `prisma migrate deploy`(이 워크트리에서)
2. PR 머지(운영·데모 배포)
3. 번호 칸이 잘못된 거절 건: `correct_ip` 로 정정
4. 운영에서 `rebuild_ledger` 동일성 확인
