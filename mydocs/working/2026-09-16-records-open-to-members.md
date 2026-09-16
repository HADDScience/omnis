---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-16-records-open-to-members.md
last_verified: 2026-09-16
---

# 2026-09-16 — 연혁을 구성원 전체가 남기고 고치게 (검증)

선행: [2026-09-16-company-records-edit.md](2026-09-16-company-records-edit.md) (PR #31 · `50d37a8`)

## 왜

PR #31 을 배포하고 다른 세션이 MCP 로 연혁 8건(BIO KOREA 날짜 · MERCK 350 · BIO USA 상태 ·
G-Bio Funding Lab · 누락 4건)을 넣으려다 전부 거절됐다 — 「관리자만 연혁을 남기거나 고칠 수 있습니다」.

관리자만 열어 두면 **사건을 겪은 사람이 남기지 못한다.** 결국 한 사람에게 몰리고, 지금처럼
나중에 메일 1,087통과 엑셀을 뒤져 복원하게 된다. 작업지시자 결정으로 추가 · 수정 · 삭제를
구성원 전체에게 열었다(2026-09-16). 누가 바꿨는지는 활동 기록에 남아 되돌릴 수 있다.

## 무엇

| 어디 | 전 | 후 |
|---|---|---|
| `POST /api/company/records` | 관리자만 | 로그인한 구성원 |
| `PATCH`·`DELETE /api/company/records/[id]` | 관리자만 | 로그인한 구성원 |
| 화면 `/omnis/records` | 관리자에게만 버튼 | 로그인하면 보인다 |
| MCP `save_company_record` | 관리자만 | 구성원 |
| MCP `delete_company_record` | 없음 | **새로 추가** — 중복 줄 정리용 |
| MCP `list_company_records` | id 없음 | 줄 끝에 `id …` — 없으면 고칠 줄을 `get_context` 로 한 건씩 캐야 했다 |

## 실측 — 로컬 dev(3005) · DB `omnis_chat_check`

API (노혜린 MEMBER):

```
POST   /api/company/records        201  {"id":"c68aa8b1-…"}
PATCH  상태 수정                    200  {"changed":["상태"]}
DELETE                             200  {"ok":true}
POST   (비로그인)                   401  인증 필요
```

MCP (사원1 MEMBER · runTool 직접 호출):

```
1) 구성원 추가   남겼습니다 — [주요] MCP 구성원 권한 시험 · 2026.09.16 · 완료
2) 목록에 id     있음 (cfb3665e…)
3) 구성원 삭제   지웠습니다 — [주요] MCP 구성원 권한 시험
4) 남았나        0
5) 없는 id       없는 연혁입니다
```

```
$ npm run verify
✖ 42 problems (0 errors, 42 warnings)   # 경고는 전부 기존 dashboard · tasks 파일의 미사용 변수
```

## 남는 것

- 연혁 25건 중 근거가 분명한 9건은 다른 세션이 MCP 로 넣을 수 있게 됐다. 중복 2건
  (K-스타트업 본선 진출 2025-07-01 · 화성특례시장 표창 2025-12-15)은 `delete_company_record` 로 정리한다.
- 판단이 필요한 나머지(날짜 불일치 6건 · PT-09 출원 여부 · 선정 결과 2건 · 기사 제목 · 오기 의심)는
  근거가 나오기 전에는 손대지 않는다.
