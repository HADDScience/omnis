---
kind: snapshot
status: active
canonical: import-tools/README.md
last_verified: 2026-11-03
---

# 카톡 참여자 전용 방 · 외부 발화자 이식

코드만 준비했다. 운영 이식은 옮길 방과 제외 줄을 정한 뒤 별도 승인으로 한다.

## 결정

- 계정 없는 사람은 `ExternalSpeaker`(이름 · 소속 · 직급)에 둔다. 로그인 · 비활성 계정을 만들지 않는다.
- `ChatMessage.authorId` 는 필수라 시스템 계정을 두고 `externalSpeakerId` 로 말한 사람을 가리킨다. 안 읽음 수에서는 시스템 글처럼 빠진다.
- 참여자 전용 방은 기본으로 분류 · 구조화 · 카드 연결을 하지 않는다. 카드는 전원이 보기 때문이다.
- 외부 발화자는 전사방에 넣지 않는다.
- 참여자 전용 방의 이식 첨부는 글이 업무 카드에 연결돼도 참여자 전용이다. 글은 카드에 보이지만 첨부는 비참여자의 카드 화면 · `get_task` · 카드 재구성에서 빠진다.
- 사본 짝 맞추기는 방 안으로 한정한다. 나뉘기 전에 사본이 전사방에 들어간 방은 `copiesFrom` 으로 그 방도 본다. 빼면 그 방의 원본이 다시 들어간다.
- 방 · 사람 매핑은 `KAKAO_DATA_DIR/import-config.json` 으로 옮겼다. 이 변경 전 이름은 공개 저장소 이력에 남아 있다.

## 배포 순서

1. 운영 DB 에 `prisma migrate deploy` 를 먼저 적용한다. 새 칼럼을 읽는 코드가 먼저 나가면 채팅 화면이 실패한다.
2. 머지한다.
3. 동기화를 돌리는 곳의 코드를 머지본으로 맞춘다. `import-config.json` 이 없으면 옮길 방이 없다.

## 검증

- `pnpm run typecheck` 통과 · `pnpm run lint` 오류 0, 경고 40 · `pnpm run test:unit` 327 통과 · `pnpm run build` 통과
- `scripts/verify-kakao-hand-copies.ts` 40 통과
- `scripts/verify-external-speakers.ts` 전부 통과. `lib/embeddings.ts` 의 두 조건을 빼면 2건이 실패하는 것을 확인했다.
- `prisma migrate diff` 차이 없음
- 시험 DB + 로컬 빌드 실측: 참여자 API 200, 화면 라벨 표시, 비참여자 메시지 · 검색 API 403, 390px 가로 넘침 없음

실제 카톡 CSV 로 새 코드의 건식 실행은 돌리지 않았다. 운영 이식 전에 돌린다.
