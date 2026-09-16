---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-16-company-records-edit.md
last_verified: 2026-09-16
---

# 2026-09-16 — 연혁을 화면과 MCP 에서 고칠 수 있게 (검증)

## 왜

연혁(`CompanyRecord`) 170건에 쓰는 길이 **이식 스크립트뿐이었다.** 화면은 읽기 전용,
API 없음, MCP 도 `list_company_records` 만. 다른 세션이 메일·엑셀과 대조해 찾아낸
고칠 것 25건을 반영하려면 운영 DB 를 직접 만지는 수밖에 없었다.

업무 카드 「주요 사건 발생 시 Omnis 에 실시간 등록하는 프로세스 도입」 도 같은 뿌리다 —
사건이 생긴 자리에서 바로 남길 길이 있어야 연혁이 낡지 않는다.

## 무엇

| 파일 | 무엇 |
|---|---|
| `lib/schemas/company.ts` | `CompanyRecordSchema` · `RecordForm` · `RECORD_FIELD_LABEL` · `RECORD_KIND_LABEL`(브라우저도 쓰므로 여기로 옮김) |
| `lib/company-edit.ts` | `recordData`(폼 → DB 값, 기간 표기 자동 생성) · `recordDedupeKey`(이식 스크립트와 **같은 규칙**) |
| `app/api/company/records/route.ts` | `POST` — 관리자만, 중복이면 409 |
| `app/api/company/records/[recordId]/route.ts` | `PATCH` · `DELETE` — 관리자만, 바뀐 칸을 활동 기록에 남김 |
| `components/company/record-editors.tsx` | 추가 · 수정 · 삭제 창. 종류에 따라 묻는 칸이 달라진다(지원사업은 과제번호·지원금, 수상은 상격) |
| `app/(main)/omnis/records/page.tsx` | 관리자에게 「연혁 추가」 와 줄마다 「고치기」 |
| `lib/company-tools.ts` · `lib/omnis-mcp.ts` | MCP `save_company_record` — 화면과 같은 스키마 · 같은 멱등 키 · 같은 활동 기록 |

`source` 는 「옴니스」로 넣는다 — 엑셀에서 이식한 줄과 화면에서 남긴 줄을 나중에 가릴 수 있게.
고칠 때는 원래 출처를 건드리지 않는다.

## 품질 게이트

```
$ npm run verify      # typecheck → lint
✖ 42 problems (0 errors, 42 warnings)   # 경고는 전부 기존 dashboard · tasks 파일의 미사용 변수
```

## 실측 — 로컬 dev(3004) · DB `omnis_chat_check`

API (김아리 ADMIN · 노혜린 MEMBER):

```
POST   /api/company/records                     201  {"id":"ad9dfb57-…"}
POST   같은 내용 다시                            409  같은 연혁이 이미 있습니다
PATCH  /api/company/records/ad9dfb57-…          200  {"changed":["상태","비고"]}
PATCH  종료일 < 시작일                           400  종료일이 시작일보다 앞섭니다
POST   (노혜린)                                  403  관리자만 연혁을 남길 수 있습니다
DELETE (노혜린)                                  403  관리자만 연혁을 지울 수 있습니다
DELETE (김아리)                                  200  {"ok":true}
DELETE 없는 줄                                   404  없는 줄입니다
```

DB 에 실제로 들어간 줄 — 기간 표기가 날짜에서 자동으로 만들어졌다:

```
코아스템켐온 X 하드사이언스 업무협약(MOU) 체결 | 2026.06.04 | 진행중 | 옴니스 | 수정 확인

ActivityLog
company.record.created | {"kind":"MILESTONE","startsOn":"2026-06-04"}
company.record.updated | {"changed":["상태","비고"]}
```

MCP `save_company_record` (runTool 직접 호출):

```
1) 관리자 추가   남겼습니다 — [수상] MERCK 350 미래 연구자 상 · 2026.08.31 · 완료
2) 준 칸만 수정  고쳤습니다 — … · 진행중
3) 안 보낸 칸 보존 {"prize":"미래 연구자상","periodRaw":"2026.08.31"}   ← status 만 보냈는데 상격·기간 그대로
4) 일반 사용자    관리자만 연혁을 남기거나 고칠 수 있습니다
```

## 아직 안 한 것

- **연혁 25건 반영은 하지 않았다.** 근거가 분명한 9건과 사람이 판단해야 하는 16건(중복 4쌍 · 날짜 불일치 6건 ·
  출원 여부와 선정 결과 4건 · 기사 제목 1건 · 오기 의심 1건)이 섞여 있다. 배포 뒤 화면에서 사람이 고른다.
- 화면 클릭 확인은 못 했다 — 브라우저가 다른 세션에 잡혀 있어 API 와 MCP 함수로 확인했다.
