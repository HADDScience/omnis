---
kind: decision
status: active
canonical: mydocs/manual/maintenance-switch.md
last_verified: 2026-11-06
---

# 점검 스위치 수행 계획

작업지시자 요청(2026-11-06): 장애 · 핫픽스 때 재배포 없이 몇 초~1분 안에 띄우는 점검 스위치를 Global Config 로.

## 범위

- 값 `maintenance = { mode: off|banner|maintenance, message, updatedAt }`. 없음 · 못 읽음 → off
- maintenance: proxy 가 화면 요청을 정적 점검 페이지(503 + Retry-After)로. 상태 확인 · 정적 자원 · 관리자 우회 쿠키는 통과
- banner: 맨 위 띠. 열린 화면도 1분 안에(`/api/status` 폴링, DB 안 씀). 유리 nav 와 겹치지 않게
- `scripts/maintenance.sh` 로 켜고 끄기, 사용법 `mydocs/manual/maintenance-switch.md`
- 로컬은 환경변수로 흉내, 관련 spec 만 실행, verify 통과

## 범위 밖 (지휘 세션이 사용자 확인 후)

- Vercel 스토어 생성 · 프로젝트 연결 · 환경변수 추가 · 머지

## 결정

- Hobby 읽기 한도(월 100,000) 때문에 인스턴스 메모리 캐시(proxy 30초, status 5초 + CDN 20초)
- API 는 proxy 에 태우지 않는다 — 채팅 3초 폴링 때문에 함수 호출이 거의 두 배가 된다. 열린 화면은 상태 확인으로 새로고침되어 멈춘다
