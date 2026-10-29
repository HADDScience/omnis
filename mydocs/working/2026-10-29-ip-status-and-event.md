---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-29-ip-status-and-event.md
last_verified: 2026-10-29
---

# 지식재산권 상태 5개 + 사건 — 결과 (2026-10-29)

계획: `mydocs/plans/2026-10-29-ip-status-and-event.md`

## 시험 환경

운영 `ip` 스키마를 읽기 전용으로 덤프(`~/work/omnis-import/ip-status-backup/ip-before-261029.dump`, 권한 600)해
로컬 시험 DB(`omnis_ipstatus`, `omnis_ipstatus2`)에 복원했다. 진행 기록 194행, 마지막 기록 2026-10-29 08:53 UTC.

## 마이그레이션 전 기준선

옛 함수로 `rebuild_ledger()` → 대장과 다른 칸 0행.

## 마이그레이션 결과 (운영 사본, `prisma migrate deploy`)

```
 status |                         string_agg
--------+-------------------------------------------------------------
 거절   | TM-08
 등록   | PT-07,PT-08,TM-04,TM-05,TM-06,TM-07
 출원   | PT-01,PT-02,PT-04,PT-05,PT-06,PT-09,PT-10,TM-11,TM-13,TM-17
 포기   | TM-09,TM-12,TM-14,TM-16
 출원전 | PT-11,PT-12,TM-10,TM-15,TM-18,TM-19
```

이전 값: TM-08 거절확정 · TM-09·12·14·16 포기·중단 · PT-11·TM-15 출원준비 · PT-12·TM-10·TM-19 검토의견 ·
TM-18 아이디어 · 나머지는 같은 이름(출원·등록). 출원일·등록일·번호·마지막 진행일은 바뀌지 않았다.

마이그레이션 뒤 새 함수로 `rebuild_ledger()` → 대장과 다른 칸 **0행**(27건). 진행 기록 194행 모두 status 가 채워졌다.

## 검증

```
$ npx tsx scripts/verify-ip-dates.ts        # DATABASE_URL=…/omnis_ipstatus
53 통과 · 0 실패 (변경은 되돌렸다)

$ npx tsx scripts/verify-ip-mcp.ts          # dev 서버 :3050 → omnis_ipstatus
통과: 44 passed, 0 failed

$ npx tsx scripts/verify-ip-api.ts          # 같은 서버, 임시 SSO 키
16개 항목 ✓ — 끝의 임시 계정 삭제가 Notification 외래키(RESTRICT)에 걸려 예외로 끝난다.
이번 변경과 무관하다(임시 사용자에게 알림이 생기는 기존 동작).

$ pnpm run verify
✖ 37 problems (0 errors, 37 warnings)   # 경고는 전부 이번에 손대지 않은 파일
$ npx eslint <이번 커밋이 바꾼 .ts>      # 경고·오류 0
$ pnpm run build                         # 운영 env 없는 워크트리, 로컬 DB
[exited with code 0]
```

`verify-ip-dates.ts` 에 새로 넣은 것: 상태를 옮기지 않는 사건(우선심사신청·의견제출통지·출원공고·거절결정),
출원한 건의 검토의견이 상태를 되돌리지 않음, 번호 자동 전환과 그때 날짜가 비는 것, 출원번호 형식이 아닌 값(사건번호),
TM-08 모양의 번호 정정, 재계산 동일성, 거부되어야 하는 것 4가지, 옛 단계 번역 16가지.

## 운영에 남은 일 (작업지시자 승인 필요)

1. 직전 백업 다시 뜨기 → `prisma migrate deploy`(이 워크트리에서)
2. PR 머지(운영·데모 배포)
3. TM-08: `correct_ip` 로 app_no ← 40-2025-0124087, reg_no 비움
4. 운영에서 `rebuild_ledger` 동일성 확인
