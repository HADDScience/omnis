카카오톡 업무 대화를 업무 카드로 구조화하는 작업이다. 실서비스의 `structureTask`와 같은 계약을 따른다.

맨 아래 `## 입력` 에 JSON 이 있다. 구조:
- `context.projects` — 기존 프로젝트 목록 `{id, name, productName}`. **이 회사에서 프로젝트는 과제 단위다**(정부지원과제·교육프로그램·행사 등).
- `context.products` — 제품 목록 `{id, name}`
- `context.members` — 팀원 정식 이름 배열
- `context.priorTasks` — 앞선 라운드에서 이미 만든 업무 `{name, project, date}`. 같은 업무의 연속인지 판단할 때 참고한다.
- `context.omnisCards` — 옴니스 지식 카드 제목 (비어 있을 수 있다)
- `sessions` — 시간순 세션 배열 `{id, start, messages:[{t,u,m}]}`

**세션을 시간순으로 하나씩 처리하되, 앞서 처리한 세션의 결과를 이어받아라.** 앞 세션에서 신규 프로젝트를 제안했다면 뒤 세션은 같은 프로젝트를 다시 제안하지 말고 그 이름을 그대로 쓴다.

각 세션마다 아래 객체를 만들어 배열로 출력한다. **입력의 모든 세션에 대해 하나씩** 만들어야 한다 (세션 수: {{COUNT}}).

```json
{
  "id": "<입력 id 그대로>",
  "name": "업무명",
  "background": "배경 2~3문장",
  "checklist": ["단계1", "단계2"],
  "projectId": "<context.projects 의 id>" 또는 null,
  "newProject": { "name": "새 과제명", "purpose": "", "goal": "" } 또는 null,
  "productId": "<context.products 의 id>" 또는 null,
  "priority": "LOW" | "NORMAL" | "HIGH",
  "ownerHints": ["정우창", "박소정"],
  "deadlineHint": "2026-03-14" 또는 null,
  "status": "TODO" | "IN_PROGRESS" | "DONE",
  "confidence": "high" | "low"
}
```

규칙 — 엄격히 지킬 것:

1. **name**: 무엇을 하는 일인지 드러나는 **명사구, 20자 이내**. 호명("우창아~~")·인사·이메일·전화번호로 시작하지 마라. 첫 메시지를 그대로 베끼지 마라. 예: `CHAMP+ 2차면접 발표자료 준비`, `3D 프린터 CAD 몰드 설계`.

2. **projectId / newProject**: 먼저 `context.projects`에서 찾아라. 과제명이 길어도 핵심어(예: "바이오아이코어", "디딤돌", "광교 바이오허브")로 대조하면 대부분 매칭된다. **정말 없을 때만** `newProject`를 제안하고, 그때도 과제 단위 이름으로 짓는다. 둘 다 채우지 마라. 프로젝트와 무관한 일상 업무면 둘 다 null.

3. **ownerHints**: 이 지시를 수행할 사람의 **정식 이름 배열**. 여러 명에게 향한 지시("인턴들 각자", "학생분들")면 해당하는 사람을 **모두** 넣어라. 발화하지 않았어도 지시 대상이면 포함한다. 인턴은 박소정·주용석·주진호이고 정우창은 사원이다. 대상을 특정할 수 없으면 빈 배열.

4. **deadlineHint**: 대화에 **명시된 기한만** `start` 날짜 기준으로 절대 날짜(YYYY-MM-DD)로 환산. 없으면 반드시 null. 지어내면 화면에 잘못된 "지연"으로 표시된다.

5. **status**: 완료가 명확히 확인될 때만 `DONE`. 착수 신호만 있으면 `IN_PROGRESS`. 판단이 안 서면 `TODO`.

6. **checklist**: 대화에서 실제 요구된 행동만 2~5개. 없는 절차를 지어내지 마라. **담당자별로 쪼개지 마라** — 한 업무에 하나의 목록이다.

7. **priority**: 긴급·중요 표현이 있으면 HIGH, 통상은 NORMAL.

주의:
- `Photo`, `File:` 은 첨부 표시일 뿐 내용이 없다. 이를 근거로 완료를 판정하지 마라.
- 한국어로 쓴다.
- 출력은 **순수 JSON 배열**. 마크다운 코드블록으로 감싸지 마라. 다른 설명을 붙이지 마라.

## 입력

{{INPUT}}
