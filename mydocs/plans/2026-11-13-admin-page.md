---
kind: decision
status: active
canonical: AGENTS.md
last_verified: 2026-11-13
---

# 관리자 페이지 /admin (2026-11-13, 작업지시자 승인)

## 목표
마이 화면 아래 흩어진 관리 링크를 `/admin` 한 곳(관리자만, 그 외 404)으로 묶는다. 메뉴: 사용자 · 운영 · 비용·사용량 · 기록.

## 결정
- 기존 화면은 옮기지 않는다. 본문을 `components/admin/*-section.tsx` 로 떼어 `/settings/*` 와 `/admin/*` 가 같이 쓴다. 기존 주소는 그대로 동작
- 권한: `lib/admin-access.ts` 의 `adminGate` — 화면 404, API 401/403
- 사용자 탭은 보기 + 잠금 해제만. 비활성 · 역할 변경은 넣지 않는다
- 비밀번호 · 해시 · 코드 값은 질의 `select` 에도 오르지 않는다. 메일은 서버에서 가린다(`maskEmail`)
- 잠금 해제 = auth.login `unlock` 줄(성공 `ok` 와 같이 실패 수를 0 으로). `loginAttemptInfo` 가 둘 다 본다. IP 잠금은 사람에 매이지 않아 대상 밖
- 감사 기록은 ActivityLog 재사용. 새 entity `admin`(잠금 해제 · 기능 요청 상태)은 공개 활동 API 에서 뺀다(`PRIVATE_ACTIVITY_ENTITIES`)
- 마지막 로그인은 비밀번호 · 로그인 코드 기준(소셜 로그인은 기록이 없다)
- 스키마 변경 없음
