---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-06-record-proposals.md
last_verified: 2026-10-06
---

# 연혁 제안 — 구현 · 실측

계획: [`../plans/2026-09-30-record-proposals-and-card-categories.md`](../plans/2026-09-30-record-proposals-and-card-categories.md) 1~3단계.
입력 범위는 채팅 · 업무만(NAS 제외, 2026-10-02 작업지시자).

## 만든 것

| 무엇 | 어디 |
|---|---|
| `RecordProposal` 표 · `CompanyRecord.visibility`(PUBLIC/INTERNAL) · 기존 대외비 1건 백필 | `prisma/migrations/20261006000000_record_proposals` |
| 추출 · 중복 대조 · 대외비 신호 · 정확도 · 자동 전환 · 채택/제외/되돌리기 | `lib/record-proposals.ts` |
| 업무 완료 시 · 매일 19:10 UTC 전날 26시간 채팅 | `lib/task-update.ts` · `lib/notifications.ts` · `app/api/cron/record-proposals` · `vercel.json` |
| 확인 화면 — AI 제안 「연혁」 탭 | `components/company/record-proposal-list.tsx` · `app/(main)/omnis/proposals` |
| MCP `list_record_proposals` · `decide_record_proposal`, `save_company_record` 에 visibility | `lib/omnis-mcp.ts` · `lib/company-tools.ts` |
| 연혁 편집 창 공개범위 · 목록 「대외비」 표시 · MCP 목록 ⚠ 표시 | `components/company/record-editors.tsx` · `app/(main)/omnis/records` |

자동 등록 기준: 상세 연혁(일반 등급) · 대외비 아님 · 그 종류에서 사람 판단 20건 이상 · 원안 채택 90% 이상 · 최근 3건 연속.
기업현황카드 후보(주요 등급)와 대외비는 정확도와 관계없이 사람이 본다. 되돌리지 않은 자동 등록은 사람 판단으로 세지 않는다.

## 실측 — 6개월치 채팅을 하루 단위로 (크론과 같은 방식)

로컬 복사 DB(운영 원문 스냅샷 2026-10-01)에서 사람이 고른 연혁 27건(source 「옴니스」)을 빼 두고
2026-04-01 ~ 09-30 채팅 9,544건을 하루씩 돌려, 그 기간의 정답 19건을 다시 찾는지 봤다.

```
                 제안  정답 19건 중  대외비(인비트로큐)  특허 후보  남은 중복
1차 (규칙 그대로)  40    11 (58%)     놓침                 5건        8쌍
2차 (규칙 고침)    42    14 (74%)     잡음                 0건        2묶음 (GBSA 수상 4 · KOLS 3)
```

1차에서 드러나 고친 것 — 커밋 `5277474` · `ef81787`

- 기관 위촉 멘토(수원대 · WISET) · 업무 교육 · 세미나 참석이 「개인 활동」으로 빠졌다 → 포함
- 특허 출원 · 등록이 「주요」로 올라왔다 → 지식재산권 표가 정본이라 제외
- 인비트로큐 MOU 의 「아직비밀」은 나흘 앞선 **다른 업무**(「광교 방문 준비」, 상대를 「IVQ」로 적음)에 있었다 →
  앞 45일 비밀 표시를 고유 낱말(「인비트로큐」)로 이어 대외비로 올린다
- 같은 사건이 표현 · 날짜(발표일/시상일)를 달리해 두세 번 올라왔다 → 같은 종류는 겹침 0.2(±7일) · 0.45(±45일)
- 2차에서 9/30 「연혁 업데이트」 보고의 대외비 표기가 같은 글에 적힌 홈페이지 오픈 · 인턴십 협약까지 번졌다 →
  연혁을 다루는 대화는 비밀 신호에서 뺀다

2차에서도 놓친 5건: 여성기업 전자입찰 교육(05-07) · 오가노이드 워크숍(07-10) · AI시그널톡톡(07-22) ·
NAMs 웨비나(08-25) · IQB 세미나(09-01). 그날 대화에 참석 사실이 짧게만 있거나 없다.

정답 밖 제안 가운데는 실제 사건으로 보이는 것이 있다 — G-Bio Funding Lab 최종 선정(09-02) · 메디바이오 협약(04-24) ·
화성지산학위원 위촉. 연혁 표에 아직 없는 것인지 사람이 볼 몫이다.
날짜가 틀리는 경우가 있다 — 화성지산학위원 위촉(실제 01-29)을 대화한 날(08-27)로 적었다. 「고쳐서 채택」 몫이다.

사용량: 1회 추출 = 입력 약 7.6천 토큰 · 출력 약 330 토큰(gemini-3.6-flash). 6개월치 한 번에 약 130회.
운영에서는 하루 1회 + 업무 완료마다 1회다.

## 검증

```
npx tsx scripts/verify-record-proposals.ts      # 37건 전부 통과 (거부 사례 19건)
pnpm run verify                                  # 오류 0 (경고 43 — main 과 같다)
BASE_URL=http://localhost:3108 pnpm exec playwright test tests/feature/record-proposals.spec.ts
                                                 # 1 passed — 대외비 채택 → [내부용·대외비] · INTERNAL · 「주요」, 제외 → REJECTED
narrow-audit /omnis/proposals?tab=records        # 320 · 240px 넘침 0 · 잘림 0 · 44px 미만 0
                                                 # 200px 잘림 1 은 헤더 제목(모든 화면 공통, 기존)
```

화면에서 직접 확인: 채택 · 고쳐서 채택(edited=true 로 남음) · 제외 · 되돌리기(만든 연혁 삭제 + REJECTED · revertedAt).

## 남은 것

- 운영 반영: 마이그레이션(운영 DB 먼저) → 머지. 크론은 `CRON_SECRET` 이 이미 있어 그대로 돈다
- 중복 2묶음 — 날짜가 비거나 기관 표기가 다른 같은 수상 · 행사. 사람이 제외하면 다음부터 「이미 올린 제안」으로 걸러진다
