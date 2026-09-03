# 카카오톡 이식 도구

`docs/카톡-이식-설계.md` 의 구현. 순서대로 돌린다.

```bash
export KAKAO_DATA_DIR=~/omnis-import          # 원본 (저장소에 없음)

npx tsx import-tools/create-past-members.ts   # 1. 과거 구성원 계정 (isActive:false)
npx tsx import-tools/import-messages.ts       # 2. 메시지 9,136건
npx tsx import-tools/seed-projects-from-nas.ts # 3. 프로젝트 = NAS 과제 폴더

# 4. 업무 카드 — 순차 구조화 (라운드마다 준비 → Claude → 반영)
for r in $(seq 1 11); do
  npx tsx import-tools/prepare-structuring.ts $r   # in/roundNN.json 생성
  # → Claude 서브에이전트가 out/roundNN.json 을 만든다 (프롬프트는 설계 문서 참조)
  npx tsx import-tools/apply-structuring.ts $r
done
```

## 왜 순차인가

N 라운드는 1..N-1 이 만든 프로젝트·업무를 맥락으로 받는다. 그래야 3월에 생긴
과제에 5월 업무가 붙는다. 병렬로 돌리면 같은 프로젝트가 이름만 다르게 흩어진다.

## 멱등

`ChatMessage.sourceId` / `Task.sourceId` 에 유니크 제약이 걸려 있다.
몇 번을 돌려도 결과가 같고, 중간에 끊겨도 다시 돌리면 이어진다.

되돌리기:
```sql
DELETE FROM "Task"        WHERE "sourceId" LIKE 'kakao-task:%';
DELETE FROM "ChatMessage" WHERE "sourceId" LIKE 'kakao:%';
```

## 하지 않는 것

- 1:1 대화 이식 — ChatRoom 에 접근 통제가 없어 사적 대화가 전원에게 공개된다
- 담당자 추측 — 지시 대상이 아니면 비워 둔다
- 없던 마감일 생성 — 지어내면 화면이 잘못된 "지연" 으로 덮인다
- 이식 중 알림·임베딩·AI 자동 호출
