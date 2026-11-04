---
kind: decision
status: active
canonical: mydocs/plans/2026-11-04-active-assignees.md
last_verified: 2026-11-04
---

# 담당자 후보는 재직자만

작업지시자 요청(2026-11-04). 결과와 실측: [`../working/2026-11-04-active-assignees.md`](../working/2026-11-04-active-assignees.md).

## 재직 기준

`User.isActive = true` **이고** `StaffProfile.employment ≠ FORMER`. 인력 표가 없는 계정은 isActive 만 본다.
판정은 `lib/active-members.ts` 한 곳. 스키마는 바꾸지 않는다 — 근거가 이미 있고 운영에서 두 칸이 어긋나는 사람이 없다.

계정(로그인)과 인력 표(재직 기록)는 관리 경로가 달라, 어느 한쪽만 고쳐도 후보에서 빠지게 둘 다 본다.

## 정한 동작

1. **새로 고르는 것만 막는다.** 이미 담당 · 지시자인 퇴사자의 행과 화면 이름은 그대로다
2. **편집 화면에는 이 업무에 걸린 퇴사자만 「· 과거 구성원」 으로 남긴다.** 빼면 칩이 사라져 다른 칸만 고쳐도 담당에서 조용히 빠진다.
   한 번 빼고 저장하면 다시 넣을 수 없다
3. **서버도 막는다.** 화면을 거치지 않은 요청(API · MCP)도 같은 기준이다. 판정은 「이번에 새로 들어온 사람」 만 본다
4. **필터** — 담당 칩(`?assignee=`)은 재직자만. 과거 담당 업무는 목록 보기 검색칸(이름 검색)과 MCP `list_tasks assignee` 로 찾는다.
   퇴사자 칩을 남기면 「고를 수 있는 사람」 처럼 보이고, 옛 업무를 사람별로 볼 일은 드물어 검색으로 충분하다고 봤다

## 범위 밖

지식재산권 담당(`app/api/ip/members` — 이미 isActive), 인력 표 화면, 알림 수신 대상, 과거 기록 이식(`import-tools`).
