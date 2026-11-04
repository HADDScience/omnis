---
kind: snapshot
status: active
canonical: mydocs/plans/2026-11-04-large-upload.md
last_verified: 2026-11-04
---

# 큰 첨부 구현 결과 (2026-11-04)

계획: [`plans/2026-11-04-large-upload.md`](../plans/2026-11-04-large-upload.md)

## 시험 환경

프리뷰의 `DATABASE_URL` 이 운영과 같은 행이라 프리뷰에서 기능을 켜면 운영 DB 에 쓴다. 그래서 켠 상태의 시험은
로컬 서버(`next start`) + 격리 DB + Blob dev 스토어 + NAS `_dev` 시험 폴더로 돌렸다. 브라우저는 headless Chromium.
**함수는 맥에서 돌았다.** Vercel 위 Workflow · 웹훅 · 서울 함수 경로는 이 시험에 들어 있지 않다.

## 결과

| 시험 | 결과 |
|---|---|
| `pnpm run verify` · 단위 464건 | 통과 |
| CI verify · e2e(꺼짐) | 통과. e2e 165 통과, 17 건너뜀 |
| 프리뷰(꺼짐) `POST /api/uploads` 외 3곳 | 전부 404 |
| 켬: 올리는 동안 다음 글 전송 · 곧바로 열기 · Range 206/416 · 권한 401/404 · VERIFIED · 15분 뒤 재대조 · 임시본 삭제 | 통과 |
| 켬: 새로 고침 뒤 재개 | 통과. 끊기 전 끝난 조각 1, 이어서 보낸 조각 2 |
| 켬: 멈추기 → 글 · 파일 되돌림 | 통과 |
| 켬: HTML → attachment · octet-stream · nosniff | 통과 |
| 켬: 거부 — 4MB 이하 400, 300MB 초과 413, 위조 · 남의 세션 410, 안 올린 세션 409, 크기 다름 422 + 임시본 삭제, 서명 없는 웹훅 400 | 통과 |
| 크론: 서버 재시작으로 멈춘 VERIFIED 3건 다시 시작 → 15분 뒤 삭제 | 통과 (`stale 3, restarted 3`) |
| 크론: 행 없는 8일 지난 임시본 삭제, 행 있는 것은 유지 | 통과 (`removedOrphans 1`) |

### 300MB 1회 (합성 파일, 320px 폰 에뮬레이션, 동시 2조각)

| 항목 | 값 |
|---|---|
| 맥 → Blob 업로드 | 254초 |
| 복사 10단계(맥 → NAS, 서울 함수 아님) | 517초, 단계당 약 52초 |
| VERIFIED 뒤 /raw 전체 받기 | 188초, sha256 일치 |
| 임시본 삭제 | VERIFIED 15분 14초 뒤 |

## 시험에 들어 있지 않은 것

- iPhone 실기(화면 끄기 · Wake Lock · 복귀 재개). Chromium 에뮬레이션은 iOS 동작을 보여 주지 않는다.
- Vercel 위 복사 Workflow · Blob 웹훅 실제 호출(서명 없는 요청의 거부만 봤다).
- NAS 장애 · 해시 불일치 · 디스크 가득 참 · 알림 발송: 단위 시험으로 흐름만 봤다. 실제 NAS 를 끄지 않았고 메일은 보내지 않았다.
- 저장 합계 · 월 합계 상한의 거절.
