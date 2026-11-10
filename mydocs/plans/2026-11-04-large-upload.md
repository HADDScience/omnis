---
kind: decision
status: active
canonical: mydocs/plans/2026-11-04-large-upload.md
last_verified: 2026-11-04
---

# 큰 첨부(파일당 300MB) 수행 계획

작업지시자 결정(2026-11-04): 임시 저장소에 올리면 완료, NAS 복사는 뒤에서, 외부 임시 저장 수용, 최종 보관은 NAS, PWA 유지.

## 범위

- 4MB 초과 파일만 새 경로. 4MB 이하는 지금 경로 그대로.
- `LARGE_UPLOAD_ENABLED=1` 이 없으면 지금과 같다. 새 API 는 404, 화면 상한 4MB.
- 업로드는 전송 줄 밖에서 돈다. 올리는 동안 채팅 가능 · 다른 방 이동 가능 · 진행률 · 재개.
- 파일은 언제나 `/api/files/{id}/raw` 로 나간다. 임시 저장소 주소를 화면에 주지 않는다.

## 흐름

```
브라우저 → POST /api/uploads            세션(서명) · 클라이언트 토큰. DB 쓰기 없음
        → Blob 비공개 스토어로 조각 전송   16MB 조각, 함수를 거치지 않음
        → POST /api/uploads/complete    크기 대조 → File + FileTransfer → 복사 Workflow 시작  ← 사용자에게 완료
          (웹훅 /api/uploads/webhook 도 같은 일을 한다. 먼저 온 쪽이 처리)
Workflow → 32MB 단계: Blob 범위 읽기 → sha256 → NAS PUT(Content-Range) → NAS 범위 되읽기 → 대조
         → PROPFIND 크기 = File.size → VERIFIED → 15분 → 크기 · 표본 3곳 재대조 → Blob 삭제 → TEMP_DELETED
읽기    → /raw → findVisibleFile → VERIFIED 전 Blob, 뒤 NAS (Range 지원)
```

## 불변식

- `VERIFIED` 는 모든 조각의 되읽기 해시 일치 그리고 전체 크기 일치일 때만 된다(`lib/large-upload/copy-loop.ts`).
- 임시본을 지우는 곳은 `deleteTemp` 하나(올라간 크기가 다른 업로드 거절과, 행 없는 7일 지난 임시본의 크론 정리는 파일 행이 없는 경우다).
- 복사 전에는 임시본이 하나뿐인 원본이다. 어떤 실패에서도 지우지 않는다.
- 응답 헤더는 `lib/file-serving.ts` 규칙 그대로다(#155). 경로마다 다른 규칙을 두지 않는다.

## 11/4 시험을 반영한 결정

| # | 결정 | 근거 |
|---|---|---|
| 1 | 한 파일에 이어 쓴다. 조각 파일 대안은 뺀다 | NAS Content-Range PUT 201 → 204 → 204, 재전송 후 해시 일치 |
| 2 | 복사 단계 32MB, 300MB 는 10단계 | 서울 함수 → NAS 52~67MB/s, 16MB 단계 0.74~0.86초 |
| 3 | 환경변수는 `BLOB_READ_WRITE_TOKEN` 하나. RW 토큰으로 클라이언트 토큰을 만들고 `handleUpload` 로 웹훅 서명을 본다 | 스토어 연결 때 실제로 이것만 생겼다 |
| 4 | `cacheControlMaxAge` 1시간 | 재읽기 때 객체 전체 MISS 를 줄인다. 함수로만 읽어 노출은 늘지 않는다 |
| 5 | 임시본 삭제 직전 크기 · 표본 범위 재대조 | 되읽기가 NAS 캐시일 수 있다 |
| 6 | 복사 동시 2개 유지 | 공용 회선 |
| 7 | 폰: 화면 유지(Wake Lock) · 안내 · 복귀 시 재개 | iOS 는 화면을 끄면 전송이 멈춘다 |

## 단계

1. 스키마 · 규칙 · 세션 · 라우트 · 복사 Workflow · 크론 점검 · 읽기 분기 + 단위 시험
2. 업로드 관리자 · 재개 · 진행 표시 · 화면 4곳 · 폰 대응 · 측정 이벤트
3. e2e(꺼짐: CI / 켜짐: 로컬, dev 스토어 · NAS _dev) · 보고서

## 넣지 않은 것

- MCP `create_upload_link` 의 큰 파일 옵션(설계 8절). 이번 범위 밖이다.
- 관리 화면의 첨부 집계 칸. 이벤트는 쌓이고, 칸은 데이터가 생긴 뒤 만든다.
