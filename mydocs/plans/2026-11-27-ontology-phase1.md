---
kind: decision
status: active
canonical: AGENTS.md
last_verified: 2026-11-27
---

# 공통 층(유형 정의 · 통합 지식) 1단계 (2026-11-27)

옴니스의 맞춤 화면(지식재산권 · 국가과제 · CRM · 연혁)은 저마다 테이블 · 도구 · 색인 규칙을 따로 갖고 있다.
1단계는 그 위에 **유형 정의 · 근거 · 값 이력 · 공통 색인 · 일반 도구**를 한 겹 얹는다. 저장은 지금 테이블을 그대로 쓰고,
맞춤 화면 코드는 고치지 않는다.

이 문서는 저장소 밖 설계 보고서(2026-11-26)를 공개 저장소에 맞게 옮긴 것이다. 회사 데이터 · 사람 이름 ·
운영 실측 건수 · 거래처 이름은 뺐다. 비용 계산의 근거 수치도 저장소 밖 보고서에만 있다.

## 요약

1. **선택지는 「정의는 공통, 저장은 그대로」 다.** 공통 층은 기존 테이블 위에 「테이블에 기대는 유형」(`storage: "table"`)으로 얹는다.
   회사가 화면에서 유형을 만드는 `generic` 저장은 2단계로 미루되, 표 모양은 그것을 받을 수 있게 짠다.
2. **새 표는 9개, 기존 표 변경은 `EmbeddingChunk` 칼럼 2개와 enum 값 1개다.**
   - 정의: `ObjectType` · `ObjectField` · `OptionValue` · `ActionType` · `ObjectTypeVersion`
   - 근거 · 이력 · 제안: `Evidence` · `ObjectRevision` · `Proposal`
   - 변경 이벤트: `ObjectChange`(transactional outbox, DB 트리거가 채운다)
   - 새 표의 상태 칸은 Postgres enum 대신 text + CHECK 로 둔다(enum 값 바꾸기가 마이그레이션을 무겁게 만든다).
3. **변경 이벤트는 DB 트리거로 받는다.** 맞춤 화면 · 이식 스크립트 · `ip` raw SQL 이 어디서 쓰든 같은 트랜잭션 안에서
   `ObjectChange` 한 줄이 남는다. 화면 코드를 고치지 않고 이벤트를 얻는 방법은 이것뿐이다.
4. **도구는 「핵심 도구 항상 + 검색 상위 N」 으로 간다.** 일반 도구(`describe_type` · `list_objects` · `get_object` ·
   `propose_object` · `run_action`)를 더하고, 질문 경로에 싣는 도구를 20개 안팎으로 줄인다. 바꾸기 전후에 질문 세트
   회귀 시험(저장소 밖)을 돌린다.
5. **AI 제안은 새 `Proposal` 표 하나로 옮긴다**(결정 기록 Q1). 옛 제안 표 둘(`RecordProposal` · `CardProposal`)과
   판단 화면도 바꾼다.
6. **멀티테넌트는 「회사마다 Neon 프로젝트」 로 정해 두고, 1단계에서는 아무것도 나누지 않는다.** `tenantId` 칼럼을 만들지
   않는다. 요청 밖에서 도는 새 코드만 `runForTenant()` 껍데기로 감싼다.
7. **PR 은 P0~P11 로 나눈다.** 마이그레이션이 있는 PR 은 P2 · P3 · P4 · P9 · P10 이다. 모든 PR 은 「맞춤 화면 경로 diff 0」
   (아래 「맞춤 화면 경로」)과 해당 화면 e2e 통과를 확인 기준으로 둔다.

---

## 1. 목표 · 비목표

### 1단계에서 하는 것

| # | 목표 | 끝났다고 보는 기준 |
|---|---|---|
| G1 | 기존 테이블 중 공통 유형을 단계적으로 레지스트리에 등록한다. 첫 셋은 `record` · `grant_decision` · `org` | 세 유형이 `describe_type` · `list_objects` · `get_object` 로 MCP · 앱 AI 에서 읽힌다 |
| G2 | 유형 · 칸 · 선택지 키를 고정하고 표시 이름과 나눈다 | 레지스트리 시험이 키 형식 · 중복 · 칼럼 매핑을 막는다 |
| G3 | 근거(`Evidence`)와 값 이력(`ObjectRevision`)을 쌓는다 | 연혁 제안 흐름이 근거를 `Evidence` 에 남긴다. 이식 스크립트의 사람 손질 보호가 `ObjectRevision` 을 먼저 본다 |
| G4 | 맞춤 화면에서 고친 것이 색인에 따라온다 | 등록 유형의 행을 화면에서 고치면 `ObjectChange` → `EmbeddingChunk` 가 갱신된다 |
| G5 | 질문 경로 도구를 줄인다 | 회귀 시험 허용률 ≥ 98%, 질문당 첫 호출 입력 토큰 ≤ 8,000 |
| G6 | AI 제안을 한 흐름으로 합친다 | 연혁 · 카드 · 새 유형 제안을 한 목록에서 판단하고, 자동 승인 기준을 유형마다 설정으로 둔다 |
| G7 | 공개 범위를 근거에서 물려받고 AI 는 좁히기만 한다 | 음성 권한 시험(§2-4)이 CI 에서 돈다 |

### 1단계에서 하지 않는 것 (막히지 않게 준비만 한다)

| 비목표 | 하지 않는 까닭 | 지금 해 둘 준비 |
|---|---|---|
| 멀티테넌트(회사 둘 이상) | 회사가 하나다. 두 번째 회사가 정해지면 시작한다 | `runForTenant()` 껍데기, 캐시 키 규칙, 제품 기본 유형 키를 회사 사이에 같은 값으로 둔다(§2-7) |
| `generic` jsonb 저장(코드 없이 만드는 유형) | 두 번째 회사나 첫 「코드 없이 만드는 유형」 요구가 올 때 넣는다 | `ObjectType.storage` 에 `generic` 자리, `ObjectRevision.value` · `Proposal.payload` 를 칸 키 → 값 jsonb 로, `schemaVersion` 칸 |
| 외부 SDK(뷰 · Action · 장부) | 안정되기 전에는 저장소 안에 둔다 | 일반 도구와 Action 정의가 SDK 의 바탕이다. 유형 · 칸을 키로만 부르게 한다 |
| 회사가 정의를 고치는 화면 | 1단계 정의는 코드가 정본이다(결정 기록 「(가) FDE 가 정의」) | `ObjectType.origin`(product/company)과 버전 표. 정의는 사람이 읽기 쉬운 데이터로 둔다 |
| 칸 단위 권한 | 넣는 순간 임베딩 · 요약으로 샌다 | 공개 범위를 행 단위 토큰 배열로 두고, 같은 범위 칸끼리만 색인한다 |
| 재분류 · 「기타」 표류 지표 | 분류 실적이 없다 | `Proposal.schemaVersion` · `typeKey = "other"` 를 남겨 둔다 |
| 맞춤 화면을 공통 층 위로 옮기기 | 조건: 기능을 잃지 않는다 | 없음. 2단계 이후 화면별로 따로 판단한다 |

---

## 2. 처음부터 정할 7가지

### 2-1. 유형 · 칸 · 선택지의 바뀌지 않는 키 + 표시 이름

| 대상 | 키 형식 | 바꿀 수 있는 것 | 바꿀 수 없는 것 | 지우기 |
|---|---|---|---|---|
| 유형 | `^[a-z][a-z0-9_]{1,39}$`. 제품 기본 유형은 접두어 없이(`record`). 회사가 만든 유형은 `c_` 로 시작하고(2단계), 제품 기본 유형은 `c_` 로 시작할 수 없다 | `label` · `labelPlural` · `llmDescription` · 예시 | `key` · `storage` · `backing` | `hiddenAt` 으로 숨긴다. 행 · 제안 · 근거가 0건일 때만 지운다 |
| 칸 | 같은 형식, 유형 안에서 유일 | `label` · `llmDescription` · `filterable` · `maxLength`(늘리기만) | `key` · `dataType` · `optionSetKey` · `refTypeKey` | 값 · 사람 손질이 모두 0건이면 지운다. 아니면 숨긴다 |
| 선택지 | 같은 형식, 묶음(`setKey`) 안에서 유일 | `label` · `sortOrder` | `key` | 그 값을 쓰는 행이 0건일 때만 지운다. 아니면 숨긴다 |

- 타입을 바꾸고 싶으면 새 칸을 만들고 이관 작업(버리기 · 옮기기 · 캐스팅 · backfill)을 돌린다.
- 깨지는 변경인지는 칸마다 「값 있음」 「사람 손질 있음」 건수로 가른다. 둘 다 0 이면 자유롭게 바꾼다.
- **기존 Postgres enum · text 값은 그대로 둔다.** 선택지 키에 원래 값을 대어 둔다. 예: `RecordKind.GRANT` ↔ `record_kind.grant`
  (`legacyValue = "GRANT"`). 공통 층의 입출력은 언제나 소문자 키이고, 기존 도구에 넘길 때만 원래 값으로 바꾼다.
- 표시 이름은 한국어, 키는 영어 소문자다. 화면 · 도구 응답 · 프롬프트는 표시 이름을, SDK · 저장 · 시험은 키만 쓴다.

### 2-2. 정의 버전과 값의 `schemaVersion`

| 무엇 | 어떻게 |
|---|---|
| 정의 정본 | 1단계는 코드다(`lib/objects/types/*.ts`). `pnpm run objects:sync` 가 DB 의 정의 표로 옮긴다. 배포 절차에서 `db:deploy` 다음에 돈다 |
| 버전 | 정규화한 정의의 해시(`defHash`)가 바뀌면 `version` 을 1 올리고 `ObjectTypeVersion` 에 전체 정의를 남긴다 |
| 깨지는 변경 | 칸 삭제 · 숨김, 선택지 숨김, 필수로 바꿈, `maxLength` 줄임이면 `breaking = true`. upcaster 가 있어야 시험을 지난다 |
| 값의 버전 | `Proposal.schemaVersion` · `ObjectRevision.schemaVersion` 에 그때의 유형 버전을 남긴다. `table` 유형의 행 자체는 Prisma 스키마가 모양을 정하므로 버전 칸을 두지 않는다 |
| 옛 버전 값 읽기 | `upcast(typeKey, fromVersion, payload)`. 판단 대기 중인 제안이 옛 버전이면 보여 줄 때와 승인할 때 올린다. 올릴 수 없으면 `stale` 로 바꾸고 다시 묻는다 |
| Prisma 스키마와 대조 | 시험이 Prisma DMMF 를 읽어 `table` · `ledger` 유형의 칼럼 매핑이 실제로 있는지, 타입 · 필수 여부가 맞는지 본다. 매핑한 칼럼을 지우거나 타입을 바꾸는 마이그레이션은 이 시험에서 걸린다 |

### 2-3. 값 이력(AI 원안 / 사람 / 원천) + `Evidence`

**`ObjectRevision` — 칸 하나가 언제 누구 손으로 무엇이 됐나**

| `authorKind` | 언제 남나 |
|---|---|
| `ai` | AI 제안이 자동 승인으로 반영될 때(`proposalId` 로 잇는다) |
| `human` | 공통 층(제안 승인 · `run_action`)에서 사람이 쓸 때. 원안을 고쳐 승인하면 고친 칸만 `human` |
| `screen` | 맞춤 화면에서 고친 것을 `ObjectChange` 로 알게 됐을 때 |
| `source` | 이식 스크립트가 쓸 때. 스크립트는 연결마다 `SET LOCAL omnis.actor_kind = 'source'` 를 건다 |

- 트리거가 `current_setting('omnis.actor_kind', true)` 를 읽어 `ObjectChange.actorKind` 에 남긴다. 값이 없으면 `screen` 이다.
  그래서 맞춤 화면 코드는 고치지 않는다. 이식 스크립트는 한 줄씩 고친다(스크립트는 맞춤 화면이 아니다).
- 사람 손질 보호는 `humanTouched(typeKey, objectIds, fieldKeys)` 한 함수로 모은다. 국가과제 이식의 ActivityLog 검색은
  이 함수의 옛 자료 대체 경로로 남긴다.
- 되돌리기는 이력 행에 `revertedAt` 을 찍고, 바로 앞 값을 Action 으로 다시 쓰는 것이다.

```prisma
model ObjectRevision {
  id            String    @id @default(uuid())
  typeKey       String
  objectId      String
  /// null 이면 대상 전체(create · delete)
  fieldKey      String?
  /// create | update | delete | widen | revert
  op            String
  value         Json?
  prevValue     Json?
  schemaVersion Int
  /// ai | human | screen | source
  authorKind    String
  actorId       String?
  proposalId    String?
  changeId      BigInt?
  createdAt     DateTime  @default(now())
  revertedAt    DateTime?
  revertedById  String?

  @@index([typeKey, objectId, fieldKey, createdAt])
  @@index([proposalId])
}
```

**`Evidence` — 이 값은 어느 원문 어디에서 나왔나**

| 규칙 | 내용 |
|---|---|
| 위치는 서버가 찾는다 | AI 는 칸마다 `{ value, messageId, quote }` 를 낸다. 서버가 그 원문에서 `quote` 를 찾는다(공백 · 줄바꿈 정규화). 못 찾으면 그 칸을 버린다. 모델이 센 글자 위치는 믿지 않는다 |
| 근거 없는 제안은 만들지 않는다 | 지금 `sourceRefs` 가 비면 만들지 않는 규칙을 그대로 쓴다 |
| 거꾸로 찾기 | `(sourceKind, sourceId)` 색인. 원문을 지우거나 가리면 그 원문을 가리키는 근거에 `goneAt` 을 찍고 `quote` 를 비운다. 그 근거에서 나온 값을 재검토 목록에 올린다 |
| 인용 복사 | 원문 조각을 300자까지 복사한다(결정 기록 Q7). 원천이 사라지면 비운다 |
| 공개 범위 스냅숏 | 근거를 잡을 때 원천의 공개 범위 토큰(§2-4)을 함께 남긴다 |

```prisma
model Evidence {
  id          String    @id @default(uuid())
  proposalId  String?
  proposal    Proposal? @relation(fields: [proposalId], references: [id], onDelete: SetNull)
  typeKey     String
  objectId    String?
  fieldKey    String?
  /// chat_message | task | weekly_report | file | ip_communication | email | import_row
  sourceKind  String
  sourceId    String
  spanStart   Int?
  spanEnd     Int?
  /// 원문 조각(최대 300자). 원천이 사라지면 비운다
  quote       String?
  quoteHash   String
  visibility  String[]  @default([])
  capturedAt  DateTime  @default(now())
  goneAt      DateTime?

  @@index([sourceKind, sourceId])
  @@index([typeKey, objectId])
  @@index([proposalId])
}
```

옛 제안 표를 `Proposal` 로 옮기므로(Q1 (b)) 설계 보고서 초안의 `Evidence.legacyProposal` 칸은 두지 않는다. 대신 `Proposal.legacyRef`(`record:<id>` · `card:<id>`, 유일)를 P3 에 두어 P7 이전을 다시 돌려도 겹치지 않게 한다. 이전 방법은 P7 에서 정한다.

`Proposal` 의 칸(P3): `typeKey` · `op`(create · update) · `objectId` · `status`(pending · accepted · rejected · auto_applied · superseded · stale) · `payload`(칸 키 → 값) · `original`(AI 원안) · `edited` · `title` · `reason` · `confidence` · `schemaVersion` · `visibility` · `needsWiden` · `autoGroup` · `trigger` · `triggerRef` · `supersededById` · `decidedById` · `decidedAt` · `revertedAt` · `legacyRef`. 옛 두 표의 칸은 이 안에 들어간다(연혁 `grade` · `confidential` 은 `payload`, 카드 `content` 는 `payload`).

### 2-4. 공개 범위 상속 + 음성 권한 시험

**표현: 「모두 만족해야 볼 수 있는 조건」 토큰 배열** (결정 기록 Q4 — 이 여섯 가지로 시작한다. 늘리려면 작업지시자 승인)

| 토큰 | 뜻 | 원천 |
|---|---|---|
| (빈 배열) | 재직 구성원 누구나 보고, 외부 자료에도 쓸 수 있다 | `RecordVisibility.PUBLIC` |
| `internal` | 재직 구성원은 보지만 외부 자료에 쓰지 않는다(대외비) | `RecordVisibility.INTERNAL` |
| `group:ip` | 지식재산권 구성원만 | `ip.members` |
| `group:hr` | 채용 담당만 | 채용 도구의 권한 |
| `group:admin` | 관리자만 | `User.role = ADMIN` |
| `room:<id>` | 그 방 참여자만 | `ChatRoomMember`. 전사방은 토큰을 붙이지 않는다 |

- 볼 수 있는 조건은 `토큰 ⊆ 보는 사람의 토큰` 이다. 두 방의 글에서 나온 지식은 `[room:A, room:B]` 로, 두 방에 모두 든 사람만 본다.

| 규칙 | 내용 |
|---|---|
| 기본값 | 제안의 공개 범위 = 근거들의 `visibility` 를 합친 것 |
| AI 는 좁히기만 | AI 는 토큰을 더할 수만 있다. 서버가 `AI 결과 ⊇ 근거 합` 을 검사한다 |
| 넓히기는 사람만 | 뺄 토큰을 모두 가진 사람만 승인한다. `ObjectRevision.op = "widen"`. 자동 승인은 넓히지 못한다 |
| 유형의 고정 범위 | 업무 · 지식 카드는 전사 공개가 전제다(`visibilityPolicy: "fixed"`). 근거가 방 한정이면 `needsWiden` 으로 늘 사람이 본다 |
| 칼럼이 있는 유형 | `record` 는 `visibility` 칼럼과 `internal` 토큰을 서로 바꾼다(`visibilityPolicy: "column"`) |
| 색인 | `EmbeddingChunk.visibility` 칼럼에 같은 토큰을 둔다. 공개 범위가 다른 칸은 한 조각에 섞지 않는다 |
| 집행 위치 | `lib/objects/access.ts` 의 `canSee(caller, tokens)` 한 곳. 1단계는 애플리케이션에서 집행하고 DB RLS 는 쓰지 않는다 |

**음성 권한 시험 — 「이 사람에게는 안 보여야 한다」** (`omnis_test` DB, 모델 호출 없이 `lib/agent/fake-model.ts`)

| 시험 사용자 | 심어 둔 대상 | 안 보여야 하는 경로 |
|---|---|---|
| 방 X 비참여자 | 방 X 글이 근거인 제안 · 지식 | `list_objects` · `get_object` · `search_knowledge` · 질문 경로 · MCP · 제안 목록 · 이웃 · 임베딩 검색 |
| IP 비구성원 | `trademark` · `patent` · `ip_progress` | 위와 같다 + `describe_type` 결과에 유형 자체가 없어야 한다 |
| 일반 구성원 | `group:hr` 지원자, `group:admin` 설정 | 위와 같다 |
| 퇴사자 | 전부 | 위와 같다 |
| 외부 자료 생성 경로 | `internal` 연혁 | 기업현황카드 · IR 내보내기 결과 |

- 「건수 0」 만 보지 않고, 응답 본문에 심어 둔 고유 문자열이 없는지도 본다(요약 · 각주로 새는 것).
- 새 유형을 등록하면 이 표에 한 줄을 더하지 않고는 레지스트리 시험을 지나지 못하게 한다.

### 2-5. 장부는 전용 테이블

장부(`storage: "ledger"`): `stock_move` · `production` · `tax_invoice` · `payment` · `company_year` · `ip_progress`.

| 규칙 | 내용 |
|---|---|
| 저장 | 전용 테이블만. `generic` 유형에 금액 · 수량 칸을 두지 못하게 레지스트리 시험이 막는다 |
| 금액 · 수량 | 금액은 정수 원 `BigInt`, 수량은 `Decimal` |
| 쓰기 | Action 으로만. 한 DB 트랜잭션 안에서 돌고, 실패하면 전부 되돌린다. `maxRows` 로 한 번에 고칠 행 수를 제한한다 |
| AI | 장부 유형은 자동 승인을 켤 수 없다 |
| 확정 · 잠정 · 계획 | 근거 등급이 다른 값은 합계에서 섞지 않는다. 합계는 유형별 요약 함수가 만든다 |
| 기존 지우기 도구 | 그대로 둔다. 지우기 Action 은 위험 등급 `destructive` 로 두고 질문 경로에는 열지 않는다 |

### 2-6. 일반 도구 + 도구 검색

| 규칙 | 내용 |
|---|---|
| 유형 × 동작 도구를 찍어내지 않는다 | 새 유형은 일반 도구의 `type` 인자 값으로만 늘어난다 |
| 질문 경로는 「핵심 + 검색 상위 N」 | 핵심 9개는 늘 싣고, 나머지는 질문 임베딩과 도구 임베딩의 코사인 상위 11개. 합 20개 |
| 도구 수 상한 | 레지스트리 시험이 센다. 질문 경로 ≤ 24, 전체 ≤ 120(Vertex 요청당 128개 상한에 여유 8) |
| 스키마 변환은 한 곳 | 정의 → 도구 스키마는 `geminiSchema()` 한 곳만 지난다. Gemini 가 조용히 무시하는 제약은 서버가 다시 검사한다 |
| 설명은 필수 | `llmDescription` 과 예시 1개 이상이 없으면 등록되지 않는다 |
| 회귀 시험 | 도구 · 설명 · 프롬프트를 바꾸는 PR 은 질문 세트 회귀 시험을 돌리고 결과 표를 PR 에 붙인다(§7-5) |

### 2-7. 멀티테넌트: 회사마다 Neon 프로젝트, DB 연결을 한 곳에서 고르는 층을 준비

| 준비 | 내용 | 나중에 바뀌는 곳 |
|---|---|---|
| `lib/tenant.ts` | `currentTenant()` 는 늘 `"default"`, `runForTenant(tenant, fn)` 은 지금 `fn()` 을 그냥 부른다 | AsyncLocalStorage + 회사별 클라이언트 Proxy(추정 — 짜 보지 않았다) |
| 요청 밖 진입점 | 공통 층이 새로 만드는 cron · outbox 소비 · `objects:sync` · 분류 실행을 `runForTenant` 로 감싼다. 기존 cron · 스크립트는 건드리지 않는다 | 회사 목록을 도는 바깥 반복만 더한다 |
| `prisma` 직접 import 유지 | 새 코드도 `import { prisma } from "@/lib/db"` | 같은 길로 Proxy 를 탄다 |
| 모듈 전역 캐시 금지 | 정의 · 도구 임베딩 캐시 키는 `회사 + defHash + 코드 버전` | 그대로 |
| 유형 키 공유 | 제품 기본 유형 키는 모든 회사에서 같다. 회사가 만든 유형은 `c_` 로 시작해 겹치지 않는다(Q10) | 회사 DB 마다 `objects:sync` |
| 회사 ID 칼럼 | 만들지 않는다 | 만들지 않는다 |
| 마이그레이션 | 트리거 · 함수도 `prisma/migrations` 안 raw SQL 로만 둔다 | 회사 DB 마다 `migrate deploy` |

---

## 3. 유형 레지스트리

### 3-1. 정의 표 (Prisma 초안 — P2 에서 확정)

```prisma
model ObjectType {
  /// 바뀌지 않는 키. ^[a-z][a-z0-9_]{1,39}$. 회사가 만든 유형은 c_ 로 시작
  key              String    @id
  label            String
  labelPlural      String?
  /// product | company(2단계)
  origin           String    @default("product")
  /// table | ledger | generic(2단계)
  storage          String
  /// table · ledger: "public.CompanyRecord" · "ip.trademarks"
  backing          String?
  version          Int       @default(1)
  defHash          String
  llmDescription   String
  examples         Json
  /// fixed | inherit | column
  visibilityPolicy String
  visibilityFixed  String[]  @default([])
  aiPropose        Boolean   @default(false)
  autoApply        Json?
  links            Json      @default("[]")
  hiddenAt         DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  fields   ObjectField[]
  actions  ActionType[]
  versions ObjectTypeVersion[]
}

model ObjectField {
  id             String     @id @default(uuid())
  typeKey        String
  type           ObjectType @relation(fields: [typeKey], references: [key])
  key            String
  label          String
  /// text | longtext | number | money_krw | date | datetime | bool | option | multi_option | ref | person | file | url
  dataType       String
  optionSetKey   String?
  refTypeKey     String?
  /// file 칸: { multiple, accept: ["image/*", "application/pdf"] }
  fileRule       Json?
  /// 공통 틀 칸: title | startsOn | endsOn | owner | org | visibility
  frame          String?
  /// table · ledger: 기대는 칼럼
  column         String?
  readOnly       Boolean    @default(false)
  required       Boolean    @default(false)
  filterable     Boolean    @default(false)
  sortable       Boolean    @default(false)
  aiExtract      Boolean    @default(false)
  llmDescription String?
  maxLength      Int?
  sinceVersion   Int        @default(1)
  hiddenAt       DateTime?

  @@unique([typeKey, key])
}

model OptionValue {
  id          String    @id @default(uuid())
  setKey      String
  /// 묶음 이름표(묶음 안 모든 줄이 같다)
  setLabel    String
  key         String
  label       String
  sortOrder   Int       @default(0)
  /// 기존 enum · text 값 — "GRANT", "PREPARING"
  legacyValue String?
  hiddenAt    DateTime?

  @@unique([setKey, key])
  @@unique([setKey, legacyValue])
}

model ActionType {
  id            String     @id @default(uuid())
  typeKey       String
  type          ObjectType @relation(fields: [typeKey], references: [key])
  key           String
  label         String
  /// create | update | upsert | delete | transition | custom (upsert — 기존 도구 하나가 「id 있으면 고치고 없으면 만든다」 일 때)
  kind          String
  /// 감싼 기존 도구(runTool 이름)
  tool          String?
  argMap        Json
  inputSchema   Json
  /// read | write | ledger | destructive
  risk          String
  /// card | param (lib/tools/registry.ts 와 같은 뜻)
  confirm       String?
  expose        Json
  maxRows       Int        @default(1)
  transactional Boolean    @default(true)
  aiAutoApply   Boolean    @default(false)
  sinceVersion  Int        @default(1)
  hiddenAt      DateTime?

  @@unique([typeKey, key])
}

model ObjectTypeVersion {
  id          String     @id @default(uuid())
  typeKey     String
  type        ObjectType @relation(fields: [typeKey], references: [key])
  version     Int
  defHash     String
  definition  Json
  breaking    Boolean    @default(false)
  summary     String
  publishedAt DateTime   @default(now())

  @@unique([typeKey, version])
}
```

- 값 칸(`storage` · `dataType` · `kind` · `risk`)의 CHECK 제약은 마이그레이션 SQL 에 직접 쓴다.

### 3-2. 칸 타입

타입마다 일상어 이름표를 함께 둔다(결정 기록 「(가)」 — 나중에 AI 대화 · 폼이 같은 정의를 만들 수 있게).

| 키 | 이름표 | 값 | 비고 |
|---|---|---|---|
| `text` | 짧은 글 | 문자열 | |
| `longtext` | 긴 글 | 문자열 | 서식이 있으면 마크다운 |
| `number` | 숫자 | 정수 · 소수 | 수량은 `Decimal` |
| `money_krw` | 금액(원) | 정수 원 | 원화 아닌 금액은 1단계 미지원 — 필요할 때 「통화+금액」 타입을 더한다 |
| `date` · `datetime` | 날짜 · 날짜와 시각 | | |
| `bool` | 예/아니오 | | |
| `option` · `multi_option` | 고르기 · 여러 개 고르기 | 선택지 키 | 기존 enum · text 는 `legacyValue` 로 잇는다 |
| `ref` | 다른 항목 | 대상 ID | 반복되는 줄(견적 품목 등)은 칸이 아니라 하위 유형 + `ref` 로 둔다 |
| `person` | 사람 | 사용자 ID | |
| `file` | 파일 | 옴니스 `File` ID | 칸마다 여러 개 허용 여부(`multiple`) · 받을 종류(`accept`)를 정한다. 이미지는 사진 설명 · 글자 인식 색인에 들어가고 AI 추출의 근거가 된다. 공개 범위는 칸 범위를 따른다 |
| `url` | 링크 | 문자열 | 형식 검사(http · https), 링크로 표시 |

- 계산값(잔액 · 합계 · D-day)은 저장하지 않고 읽을 때 계산한다.
- 위치 · 기간 길이 같은 드문 값은 1단계에서 `text` · `number` 로 둔다.

### 3-3. 코드 쪽 정의 모양 (정본)

```ts
// lib/objects/types/record.ts — 데이터만. prisma 를 들이지 않는다(lib/tools/registry.ts 와 같은 원칙)
export const recordType = defineType({
  key: "record",
  label: "연혁·실적",
  storage: "table",
  backing: "public.CompanyRecord",
  llmDescription: "회사가 겪은 대외 사건 한 건 — 지원사업 선정, 수상, 학회·전시, MOU, 인증 취득 …",
  examples: [{ text: "올해 받은 수상 정리해줘" }],
  visibilityPolicy: "column",
  fields: [
    { key: "title", label: "제목", dataType: "text", frame: "title", column: "title", required: true },
    { key: "kind", label: "종류", dataType: "option", optionSetKey: "record_kind", column: "kind", required: true },
    // …
  ],
  actions: [
    { key: "save", label: "남기기 · 고치기", kind: "upsert", tool: "save_company_record", risk: "write" },
    { key: "delete", label: "지우기", kind: "delete", tool: "delete_company_record", risk: "destructive" },
  ],
})
```

### 3-4. 저장 방식

| 방식 | 1단계 | 값이 사는 곳 | 읽기 | 쓰기 |
|---|---|---|---|---|
| `table` | 함 | 기존 테이블 | 유형별 reader 가 기존 테이블을 읽어 칸 키로 바꾼다 | **기존 runTool 을 Action 으로 감싼다.** 공통 층이 직접 UPDATE 하지 않아 확인 코드 · `confirm` · 권한 검사가 그대로 걸린다 |
| `ledger` | 함 | 전용 테이블 | `table` 과 같다. 합계는 유형별 요약 함수 | 한 트랜잭션 Action 만. 자동 승인 금지 |
| `generic` | 2단계 | 공통 행 표(공통 틀은 칼럼, 유형별 칸은 `data jsonb` + `schemaVersion`) | 공통 reader | 공통 Action |

- 기존 도구가 없는 동작은 1단계에서 Action 으로 만들지 않는다. 필요하면 먼저 기존 도구를 만든다(같은 규칙을 두 번 짜지 않는다).

---

## 4. 기존 테이블 분류

| 분류 | 개수 | 예 | 판단 기준 |
|---|---|---|---|
| 공통 유형(table) | 26 | 업무 · 프로젝트 · 지식 카드 · 기관 · 연락처 · 견적 · 샘플 · 출고 · 연혁 · 인증 · 국가과제 결정 · 공고 · 상표 · 특허 | 사람이 「○○ 찾아줘」 라고 부를 대상이고, 자기 ID 로 가리킬 수 있다 |
| 장부(ledger) | 7 | 재고 이동 · 생산 · 세금계산서(+품목) · 결제 · 연도별 재무 · IP 진행 기록 | 금액이나 수량을 더해 합계를 내거나, 상태를 다시 계산하는 근거 행이다 |
| 내부 · 시스템 | 73 | 인증 · 알림 · 사용량 · 설정 · 색인 · 제안 표 · 하위 표 · 근거 원천(채팅 메시지 · 파일) | 지식으로 찾지 않거나, 부모 유형의 칸으로만 보이거나, 권한 · 근거의 원천이다 |

(Prisma 모델 85개 + `ip` 테이블 21개, 2026-11-26 기준.)

| 순서 | 유형 | PR |
|---|---|---|
| 1 | `record` · `grant_decision` · `org` | P1 |
| 2 | `task` · `project` · `card` · `contact` · `product` · `quote` · `sample` · `shipment` · `certification` · `grant_notice` · `member` · `trademark` · `patent` | P5 다음, 유형마다 작은 PR |
| 2 (장부) | `stock_move` · `tax_invoice` · `payment` · `ip_progress` | P10 |
| 3 | 나머지(`weekly_report` · `website_post` · `inquiry` · `company_profile` · `company_year` · `staff` · `market_company` · `calendar_event` · `job_application` · `production` · `ip_communication` · `ip_action`) | 2단계 |
| 새 유형 | `agreement`(계약 · 협약) | 아래 「다음 단계 메모」 |

- 채팅 메시지는 유형으로 등록하지 않는다. 지식으로 정리되기 전의 재료이고, `Evidence` 의 원천이다.
- 우선순위 기준(결정 기록): 과제 신청서 · 사업계획서에 쓰이는 회사 정보(기본정보 · 연혁 · 매출 · 인증 · 인력 · 지식재산권 · 제품 · 협력 실적)를 먼저 정리한다.

---

## 5. AI 제안 통합

| 단계 | 하는 일 | 모델 | 버리는 조건 |
|---|---|---|---|
| A. 거르기 | 시스템 글, 20자 미만, 인사 · 이모티콘만 있는 글, 이미 근거로 쓴 메시지를 뺀다 | 없음(규칙) | — |
| B. 유형 고르기 | 방 · 날짜 묶음(최대 40건)마다 `{ reason, typeKey \| "none" \| "other", op, targetHint, messageIds, title, confidence }`. 이유 칸을 먼저 쓰게 한다. 유형 목록을 프롬프트 앞에 고정해 암묵 캐시를 탄다 | lite | `none`. 근거 메시지 ID 가 묶음에 없음 |
| C. 칸 채우기 | 후보마다 그 유형의 `aiExtract` 칸만 `{ value, messageId, quote }` | flash | `quote` 를 원문에서 못 찾은 칸. 필수 칸이 빠진 후보 |
| D. 같은 것 찾기 | 유형별 `dedupe` 함수. 같은 것이 있으면 `op: update` 로 바꾸거나 옛 제안을 `superseded` 로 | 없음 | — |
| E. 공개 범위 | 근거 토큰을 합친다. 유형 고정 범위보다 좁으면 `needsWiden` | 없음 | — |
| F. 저장 | `Proposal` 과 `Evidence` 를 함께 쓴다 | — | — |
| G. 판단 · 자동 승인 | 사람이 한 목록에서 채택 · 수정 · 거절한다. 유형의 `autoApply` 기준을 넘은 묶음만 자동 반영한다 | — | — |

- 모델 구성은 결정 기록 Q8: 단계 B lite + 단계 C flash, AI 예산 항목 `classify` 월 상한 $3.
- 출력 토큰 상한은 단계 B 1,024, 단계 C 768. 잘린 응답은 다시 보내지 않고 버린다(한국어 반복 루프).
- `"other"` 는 저장하지 않고 주마다 건수만 센다. 새 유형을 만들 근거가 된다.
- **옛 제안 표는 `Proposal` 로 옮긴다**(Q1 (b)). P7 이 옛 PENDING 행 이전과 연혁 · 카드 제안 판단 화면 교체를 함께 한다.
- **첫 새 분류는 연혁 · 실적(`record`) 추가다**(Q2). 채팅 · 메일에서 수상 · 선정 · 전시 참가 · MOU 체결 · 인증 취득 같은
  회사 실적이 생기는 순간을 잡아 연혁 추가를 제안한다.

---

## 6. 공통 색인 · 그래프 동기화

### 6-1. 변경 이벤트 얻는 방법

| 방법 | 맞춤 화면 코드 | `ip` raw SQL · 스크립트 | 같은 트랜잭션 | 판단 |
|---|---|---|---|---|
| **DB 트리거 → `ObjectChange`** | 안 고친다 | 잡힌다 | 그렇다 | 고른다 |
| Prisma `$extends` 질의 훅 | 안 고친다 | 못 잡는다 | 아니다 | 빠지는 쓰기가 생긴다 |
| ActivityLog | 안 고친다 | 일부 | 아니다 | 빠진다 |
| 논리 복제(CDC) | 안 고친다 | 잡힌다 | — | 늘 붙어 있는 소비자가 필요해 Neon compute 가 쉬지 못한다 |

```prisma
model ObjectChange {
  id          BigInt    @id @default(autoincrement())
  tableName   String
  rowId       String
  /// I | U | D
  op          String
  /// U 일 때 실제로 바뀐 칼럼. updatedAt 만 바뀌면 남기지 않는다
  changedCols String[]  @default([])
  /// current_setting('omnis.actor_kind') — 없으면 screen
  actorKind   String    @default("screen")
  txid        BigInt
  createdAt   DateTime  @default(now())
  processedAt DateTime?
  attempts    Int       @default(0)
  lastError   String?

  @@index([processedAt, id])
}
```

- 함수 하나(`omnis_capture_change()`)를 등록 유형의 테이블과 근거 원천 테이블(`ChatMessage` · `File`)에 `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` 로 건다.
- 트리거를 거는 테이블 목록은 레지스트리에서 나온다. 시험이 「등록 유형 ⊆ 트리거 건 테이블」 을 대조한다.

### 6-2. 소비기

| 언제 | 무엇을 | 까닭 |
|---|---|---|
| 매일 cron(`/api/cron/daily`) 끝에 | 남은 변경 전부 + 대조 작업 | 이미 하루 한 번 DB 를 깨운다 |
| 검색 직전 | 처리 안 된 변경 최대 50건, 최대 2초 | 물을 때만 최신이면 된다 |

- 매분 cron 은 돌리지 않는다(Q3). DB 가 쉬지 못해 compute 비용이 몇 배로 는다(추정).
- 처리: `(tableName, rowId)` 로 묶어 마지막 상태만 보고 → 유형의 `toIndexText(row)` → `syncEmbeddings`(해시가 같으면 Gemini 를 부르지 않는다) → `D` 면 `deleteEmbeddings` → `processedAt`.
- 5번 실패하면 멈추고 `lastError` 를 남긴다.
- 근거 원천의 변경(`ChatMessage.deletedAt`, 본문 변경)은 그 메시지를 가리키는 `Evidence` 에 `goneAt` 을 찍는다.
- 기존 직접 `syncEmbeddings*` 호출은 그대로 둔다. 걷어내기는 2단계다.
- 대조 작업(매일): 등록 유형마다 지금 행의 조각 해시와 `EmbeddingChunk.contentHash` 를 비교해 어긋난 행을 다시 넣는다.

### 6-3. `EmbeddingChunk` 바꾸는 것

| 변경 | 내용 | 기존 코드 영향 |
|---|---|---|
| `typeKey String?` | 유형 키. 기존 행 backfill | 없음 |
| `visibility String[] @default([])` | §2-4 토큰 | 없음. 새 일반 검색만 이 칼럼으로 거른다 |
| enum `EmbeddingSource` 에 `OBJECT` | 새 유형 조각은 `source = OBJECT`, `sourceId = "<typeKey>:<id>"` | 기존 검색에는 섞이지 않는다 |

- `ALTER TYPE … ADD VALUE` 는 같은 트랜잭션 안에서 그 값을 쓰지 못한다. enum 추가와 backfill 을 다른 마이그레이션으로 나눈다(`migration-traps.md` 와 P4 에서 대조).
- 그래프: 1단계에서는 `lib/context-graph.ts` 를 고치지 않는다. `get_object(include: ["links"])` 는 레지스트리의 `links` 선언으로 이웃을 읽는다.

---

## 7. 도구 구조

### 7-1. 일반 도구 (새로)

| 도구 | 입력 | 하는 일 | MCP | 앱 AI | 질문 경로 |
|---|---|---|---|---|---|
| `describe_type` | `type?` | 볼 수 있는 유형 목록, 또는 한 유형의 칸 · 선택지 · 연결 · Action | R | R | 핵심 |
| `list_objects` | `type`, `filters[]{field, op, value}`, `sort?`, `limit?`, `cursor?` | `filterable` 칸만 거른다. `op` 는 문자열 enum, `value` 는 늘 문자열(Gemini 정수 enum · 타입 섞임 회피) | R | R | 핵심 |
| `get_object` | `type`, `id`, `include?[]` | 한 대상 전체. 이력 · 근거는 공개 범위로 거른다 | R | R | 핵심 |
| `search_knowledge`(확장) | 기존 + `types?[]` | `OBJECT` 조각을 `typeKey` 로 거른다 | R | R | 핵심 |
| `propose_object` | `type`, `op`, `id?`, `fields{}`, `evidence[]` | 제안만 만든다. 근거 대조를 거친다 | W | W | 없음 |
| `run_action` | `type`, `action`, `input{}`, `confirm?` | `ActionType` 을 거쳐 기존 도구를 부른다. `confirm` 없으면 미리보기 | W | W | 미리보기만 |
| `list_proposals` · `decide_proposal` | | 통합 제안 목록 | R · W | R · W | `list_proposals` 만 검색 후보 |

- 옛 MCP 도구 이름은 계속 둔다(Q6 (c)). 질문 경로에서만 일반 도구로 바꾼다.

### 7-2. 질문 경로: 핵심 도구 + 검색

| 묶음 | 도구 | 개수 |
|---|---|---|
| 핵심 | `search_knowledge` · `get_context` · `list_tasks` · `ip_overview` · `list_calendar` · `company_profile` + `describe_type` · `list_objects` · `get_object` | 9 |
| 검색 상위 N | 나머지 질문 경로 도구에서 코사인 상위 11 | 11 |

- 도구 임베딩은 `"이름: 설명"` + 예시를 `gemini-embedding-001` 로 만들고, 설명 해시가 같으면 다시 만들지 않는다.
- 임베딩이 실패하거나 500ms 를 넘으면 지금처럼 전부 싣는다.
- 스위치 `ASK_TOOL_SELECTION = all | core_search`, 기본 `all`. env 는 새 배포에만 반영된다.

### 7-3. 첫 정리

| 정리 | 바꾼 뒤 | 조건 |
|---|---|---|
| CRM 목록 묶기 | `list_objects(type = quote \| sample \| shipment \| production \| stock_move \| payment)` | 해당 유형 등록 뒤. `list_receivables` 는 계산 결과라 남긴다 |
| CRM 쓰기 미리보기 | `run_action` 미리보기 하나 | 질문 경로에서 실제 불린 건수를 센 뒤 정한다(Q5) |
| 제안 목록 | `list_proposals` | P7 뒤 |

### 7-4. 회귀 시험

| 무엇 | 어디서 | 언제 |
|---|---|---|
| 정적 검사: 경로별 도구 수 상한, 유형 설명 · 예시, `geminiSchema()`, 음성 권한 시험 | CI `pnpm test:unit` | 모든 PR |
| 질문 세트 회귀 | 로컬 수동 `pnpm run eval:tools -- --questions <경로>` | 도구 · 설명 · 질문 경로 프롬프트 · 스키마 변환을 바꾸는 PR. 결과 표를 PR 본문에 |
| 통과 기준 | 허용률 ≥ 98%, 정답 후보 포함률 ≥ 97%, 첫 호출 입력 토큰 ≤ 8,000(core_search) | |

- **질문 세트는 저장소에 넣지 않는다**(Q9). 실제 질문은 가려도 회사 일이 드러난다. 측정 스크립트만 `scripts/eval-tools.mts` 에 넣고, 질문 파일 경로는 실행할 때 받는다.
- Gemini 키는 로컬 개발 키를 쓰고, 운영 사용량 기록을 거치지 않는다.

---

## 8. 단계별 작업 계획 (PR 단위)

운영 DB 에 `migrate deploy` 를 먼저 적용하고 그다음 머지한다. 운영 DB 쓰기와 배포는 작업지시자 승인 뒤에 한다.

| PR | 범위 | 마이그레이션 | 운영 반영 | 되돌리기 | 검증 |
|---|---|---|---|---|---|
| **P0** | 이 문서 | 없음 | 문서 | revert | frontmatter |
| **P1** | `lib/objects/` 데이터 모듈: `defineType`, 유형 3개(`record` · `grant_decision` · `org`), 선택지(enum · text 매핑), Action 정의(기존 도구 이름만). DMMF 대조 시험 · 키 형식 시험 | 없음 | 코드만, 동작 변화 없음 | revert | `pnpm run verify` · `test:unit`. 아무 데서도 import 하지 않음 · 맞춤 화면 diff 0 |
| **P2** | 정의 표 5개 + `objects:sync` + 맞춤 화면 경로 CI 검사(`scripts/guard-custom-screens.txt`) | 새 표만(`20261127200000_object_definitions`, 다시 돌려도 되게) | `db:deploy` → `objects:sync -- --apply --prod` → 머지 | `prisma/rollbacks/20261127200000_object_definitions.down.sql`(표와 마이그레이션 기록 줄을 지운다 — `migrate resolve --rolled-back` 은 성공한 마이그레이션에 통하지 않는다) | sync 두 번째가 변화 0(멱등) |
| **P3** | `Evidence` · `ObjectRevision` · `Proposal` + `lib/tenant.ts` 껍데기(`objects:sync` 를 감싼다) | 새 표만(`20261127230000_object_evidence`, 다시 돌려도 되게). 기존 표로 가는 외래키는 두지 않는다 — 사람 · 원천이 지워져도 판단 기록이 남게 | `db:deploy` → 머지 | `prisma/rollbacks/20261127230000_object_evidence.down.sql`. P2 되돌리기보다 먼저 돌린다(ObjectType 을 가리킨다) | verify · test:unit · 로컬 복제 DB 에서 CHECK · 외래키 · 되돌리기 왕복 |
| **P4** | `ObjectChange` + 트리거 + 등록 3유형 테이블과 `ChatMessage` 에 트리거. `EmbeddingChunk.typeKey` · `visibility` · enum `OBJECT`(마이그레이션 둘). 소비기, backfill | **기존 표에 트리거 · 칼럼** | `db:deploy` → backfill → 머지. 쓰기 지연 실측 | 트리거 DROP 마이그레이션 | 로컬 스냅숏에서 맞춤 화면으로 고쳐 조각 갱신 확인. 트리거 전후 쓰기 p50 · p95(기준 +5ms, 추정). 연혁 · 국가과제 · CRM e2e |
| **P5** | `describe_type` · `list_objects` · `get_object` + `canSee` + 음성 권한 시험. MCP · 앱 AI 에만 | 없음 | 머지 · 배포 | registry 줄 삭제 | 음성 시험 · 도구 수 상한 |
| **P6** | 질문 경로 「핵심 + 검색」, 도구 임베딩, `scripts/eval-tools.mts`, `askTier` | 없음 | 머지(기본 `all`) → 회귀 통과 → env `core_search` → 재배포 | env `all` | 회귀 표를 PR 에 |
| **P7** | 제안 통합: 옛 제안 표 → `Proposal` 이전(Q1 (b)), 연혁 · 카드 제안 판단 화면 교체, `auto-apply.ts` 일반화, 서버 쪽 인용 대조, `/proposals` 통합 목록, `list_proposals` · `decide_proposal` | 있음(이전) | `db:deploy` → 이전 → 머지 | 이전 전 백업 · 옛 표는 한동안 남긴다 | 이전 건수 대조. 제안 화면 e2e 를 새 화면에 맞게 고친다 — **맞춤 화면 diff 0 의 예외**(제안 화면 경로) |
| **P8** | 새 분류(단계 A~G)를 `record` 추가 하나로(Q2), `OMNIS_CLASSIFY = off \| dry \| on`, AI 예산 항목 `classify` | 없음 | `dry` 1주 → 비용 · 건수 보고 → 승인 → `on` | env `off` | dry 결과 30건 표본을 사람이 본다 |
| **P9** | 유형 2순위 등록(작은 PR 여러 개) + 트리거 + CRM 목록 묶기 | 유형마다 트리거 | P4 와 같은 순서 | 유형마다 revert | 음성 시험 한 줄 · 해당 화면 e2e · 회귀 |
| **P10** | `run_action` · `propose_object`, 장부 유형 등록 | 트리거 | P4 와 같다 | revert | 장부 Action 이 기존 도구와 같은 행을 내는지. 미리보기 · 확인 코드 · `confirm` |
| **P11** | 이식 스크립트에 `SET LOCAL omnis.actor_kind = 'source'`, `humanTouched()` 로 사람 손질 보호 일반화 | 없음 | 머지. 다음 이식 때 건식 먼저 | revert | 사람이 고친 과제 하나를 두고 건식 이식이 덮지 않는지 |

### 맞춤 화면 경로

모든 PR 은 아래 경로의 diff 가 0 이어야 한다. 걸리면 PR 본문에 까닭을 적는다(P7 의 제안 화면처럼 계획에 적힌 예외만).
목록은 2026-11-27 `origin/main` 기준이다. 경로 끝의 `**` 는 그 아래 전부다.

| 화면 | 페이지 | API | 컴포넌트 |
|---|---|---|---|
| 지식재산권 | `app/(main)/ip/**` | `app/api/ip/**` · `app/api/ip-mcp/**` | `components/ip/**` |
| 국가과제 | `app/(main)/omnis/grants/**` | `app/api/grants/**` | `components/grants/**` |
| CRM | `app/(main)/crm/**` | `app/api/crm/**` | `components/crm/**` |
| 연혁 · 회사 정보 | `app/(main)/omnis/records/**` · `app/(main)/omnis/company/**` | `app/api/company/**` | `components/company/**` |
| AI 제안(P7 에서 바꾼다) | `app/(main)/omnis/proposals/**` | `app/api/company/record-proposals/**` | `components/omnis/proposal-list.tsx` · `components/company/record-proposal-list.tsx` |

- 확인 명령: `git diff --name-only origin/main...HEAD | grep -E '^(app/\(main\)/(ip|crm|omnis/(grants|records|company|proposals))/|app/api/(ip|ip-mcp|grants|crm|company)/|components/(ip|grants|crm|company)/|components/omnis/proposal-list\.tsx)'` 가 아무것도 내지 않아야 한다.
- CI 검사: `.github/workflows/guard-custom-screens.yml` 이 PR 마다 `scripts/guard-custom-screens.txt` 와 PR diff 를 대조한다(P2). 걸리면 PR 본문에 「맞춤 화면 변경: <까닭>」 한 줄이 있어야 지나간다. P0 · P1 은 위 명령을 PR 본문에 붙였다.
- 화면 동작: `pnpm test:e2e:affected`. 트리거가 들어가는 PR(P4 · P9 · P10)은 그 테이블을 쓰는 화면 e2e 전부.
- 로컬 확인은 `next dev` 로만 한다(`next start` · `build` 는 운영 env 를 읽는다). e2e 는 운영 env 없는 워크트리에서 `omnis_test` DB 로.

---

## 9. 위험

| 위험 | 크기 | 줄이는 방법 |
|---|---|---|
| 트리거가 맞춤 화면 쓰기를 느리게 하거나 실패하게 한다 | 중 | 트리거는 `ObjectChange` INSERT 하나만. 예외를 삼키지 않는다. P4 에서 성능을 잰다. 트리거 DROP 하나로 되돌린다 |
| 트리거가 코드에서 안 보인다 | 중 | 트리거 건 테이블 목록을 레지스트리에서 만들고 시험이 대조한다. `migration-traps.md` 에 한 줄 |
| `Evidence.quote` 에 원문이 남는다 | 중 | 원천이 지워지거나 가려지면 소비기가 `quote` 를 비운다 |
| 사람이 판단을 못 따라간다 | **높음** | 분류는 `dry` 로 시작하고 유형 하나씩만 켠다. 하루 제안 상한을 둔다 |
| 도구 검색이 필요한 도구를 빠뜨린다 | 중 | 핵심 도구 고정, 실패 시 전체 싣기, 정답 후보 포함률을 따로 잰다 |
| 공통 층이 맞춤 화면 규칙을 우회한다 | 높음 | `table` 유형 쓰기는 기존 runTool 로만. 공통 층에는 UPDATE 경로가 없다 |
| 정의를 코드와 DB 두 곳에 둔다 | 낮음 | 정본은 코드. DB 는 `objects:sync` 결과다. 시험이 해시를 대조한다 |
| 옛 제안 표 이전(P7)이 화면을 바꾼다 | 중 | 이전 전 백업, 옛 표를 한동안 남기고 건수를 대조한다 |

## 10. 비용 (추정)

- 분류(Q8 구성)는 묶어서 보내므로 월 몇 달러 아래로 추정한다. 단가는 `lib/ai-pricing.ts`(gemini-3.6-flash 는 아직 단가 미확인)이고, 2027-01 부터 flash 단가가 오른다.
- 새 유형 색인 임베딩은 바뀐 행만 다시 만든다. 도구 임베딩은 질문당 1회.
- 질문 경로를 「핵심 + 검색」 으로 바꾸면 질문당 첫 호출 입력이 크게 준다(저장소 밖 측정, 약 72%).
- 회귀 시험은 한 번에 조건당 약 $1.3 이다.
- cron 을 더하지 않아 Neon compute 는 늘지 않게 짰다.

---

## 11. 결정 기록 (2026-11-26, 작업지시자)

| 결정 | 내용 |
|---|---|
| 유형 정의 사용자 경험 = **(가) FDE 가 정의** | 유형 · 칸 정의는 코드(`lib/objects/types`)와 CLI(`objects:sync`)로만 제공한다. AI 는 후보를 제안만 하고 확정은 PR 로 한다. 비전공 실무자용 화면은 만들지 않는다. 정의는 나중에 AI 대화 · 폼이 같은 정의를 만들 수 있게 사람이 읽기 쉬운 데이터로 둔다(키 자동 생성 가능, 타입마다 일상어 이름표) |
| 칸 타입에 `file` · `url` 추가 | §3-2 |
| 칸 타입으로 못 넣는 데이터 | 반복 줄은 하위 유형 + `ref`, 원화 아닌 금액은 1단계 미지원, 계산값은 저장하지 않는다, 서식 있는 긴 글은 `longtext` 마크다운, 드문 값은 `text` · `number` |
| Q1 옛 제안 표 | **(b) 새 `Proposal` 표로 옮기고 화면도 바꾼다.** P7 범위가 커진다 |
| Q2 첫 새 분류 | **연혁 · 실적(`record`) 추가** |
| Q3 색인 소비 시점 | (a) daily cron + 검색 직전 |
| Q4 공개 범위 토큰 | 여섯 가지 승인 |
| Q5 CRM 쓰기 미리보기 | 질문 경로 사용 건수를 센 뒤 정한다 |
| Q6 옛 MCP 도구 이름 | **(c) 계속 유지** |
| Q7 근거 인용 | (a) 300자까지 복사, 원천이 사라지면 비운다 |
| Q8 분류 모델 · 예산 | (a) B lite + C flash, 월 상한 $3 |
| Q9 회귀 질문 세트 | (a) 저장소 밖, 로컬 수동 |
| Q10 회사가 만든 유형 키 | (a) `c_` 접두어 |
| 우선 정리할 정보 | 과제 신청서 · 사업계획서에 쓰이는 회사 정보 |
| 첫 새 유형 | **계약 · 협약(`agreement`)** — MOU · NDA · 공동연구 · 투자계약. 사업계획서 「협력 실적」 에 쓰인다 |

## 12. 다음 단계 메모 — 계약 · 협약(`agreement`)

- P1 범위 밖이다. P1 은 기존 테이블에 기대는 세 유형만 등록한다. `agreement` 는 기대는 테이블이 없어 `storage: "table"` 로 둘 수 없다.
- 둘 중 하나로 시작한다. (1) 전용 테이블을 새로 만들고 `table` 유형으로 등록한다(마이그레이션 · 기존 도구 먼저 — §3-4 「기존 도구가 없는 동작은 Action 으로 만들지 않는다」). (2) `generic` 저장을 앞당긴다. 1단계 원칙에 맞는 것은 (1)이다.
- 칸은 유형 찾기 시험의 안정 칸부터: 이름(`title`) · 상대(`org`, `ref → org`) · 종류(`option`: MOU · NDA · 공동연구 · 투자 · 기타) · 상태(`option`) · 담당(`person`) · 체결일(`date`). 계약서 원본은 `file`(PDF, 여러 개) 칸으로 둔다.
- 등록 시점은 P5(일반 읽기 도구) 뒤가 맞다. 읽을 길이 생겨야 등록의 쓸모가 보인다.

## 13. 확인하지 못한 것

- 트리거를 건 뒤 쓰기 지연(P4).
- `ALTER TYPE ADD VALUE` 와 Prisma 마이그레이션의 충돌(P4 에서 `migration-traps.md` 와 대조).
- 질문 경로 미리보기 도구가 실제로 불린 건수(Q5 판단 전에 센다).
- `mydocs/tech/auth-architecture.md` 와의 대조. 1단계는 인증을 바꾸지 않는다.
- 회사별 Prisma 클라이언트 Proxy 방법(추정).
