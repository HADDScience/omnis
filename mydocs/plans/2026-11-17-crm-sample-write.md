---
kind: decision
status: active
canonical: AGENTS.md
last_verified: 2026-11-17
---

# CRM 샘플 전달 기록 — 옴니스 AI · MCP (#231, 2026-11-17)

## 목표
「거래처에 샘플(제품·수량)을 전달했다」 를 옴니스 AI · MCP 로 CRM 샘플요청에 남긴다. 기능 요청에서 AI 가 기관을 못 찾았고 쓸 도구가 없었다.

## 결정
- **모양은 화면과 같다.** 샘플요청(`CrmSampleRequest`, 발송완료) 한 줄 + 제품·수량이 있으면 샘플 출고(`CrmShipment` kind SAMPLE · DELIVERED) + 재고 출고(`CrmStockMove` OUT). 한 트랜잭션 — `app/api/crm/shipments` 와 같은 까닭. 스키마 변경 없음.
- **기관 찾기**: 기관 표 전체를 읽어 `rankOrgs`(법인 표기 · 띄어쓰기 · 대소문자 무시, 이름 일부 양방향)로 고른다. 여럿 걸리면 고르지 않고 후보를 돌려준다. `find_org` 도 같은 규칙.
- **없는 기관**: 바로 만들지 않는다. 「CRM 에 없습니다 — 새로 만들지 사용자에게 물으세요」 로 거절하고, `create_org=true` 일 때만 만든다.
- **쓰기 전 확인**: 옴니스 AI 는 확인 카드(기존 흐름). MCP 는 확인 카드가 없어 `confirm=true` 없이 부르면 남길 내용만 돌려준다. 에이전트 스키마에서는 `confirm` 을 빼고 실행 때 붙인다.
- **감사 기록**: `ActivityLog` entity `crm.sample`(새 기관이면 `crm.org` 도), userId = 요청한 사람.
- 앞날 · 모르는 제품 · 수량만 있고 제품 없음은 거절.

## 검증
- `lib/crm-sample-rules.test.ts` · `lib/agent/tools-parity.test.ts` (pnpm test:unit)
- `tests/feature/mcp-record-sample.spec.ts` (e2e, 격리 DB)
- `pnpm run verify`
