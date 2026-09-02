---
kind: canonical
status: active
canonical: mydocs/tech/ip-schema.md
last_verified: 2026-09-02
---

# 지식재산권 스키마 (`ip`)

**한 줄:** Supabase 에서 옮겨 온 상표·특허 대장. 값어치는 표가 아니라 plpgsql 에 있다.

## 왜 Prisma 모델이 아닌가

`ip` 스키마는 `prisma/schema.prisma` 에 모델로 넣지 않았다.

1. 함수를 그대로 옮기려면 컬럼 이름이 원본과 같아야 했다 (snake_case).
2. Prisma 는 datasource 에 적힌 스키마만 들여다본다. `ip` 는 Prisma 의 시야 밖이라
   `migrate` 가 이 표들을 지우려 들지 않는다.

접근은 전부 raw SQL 이고, 그 SQL 은 `lib/ip-data.ts` 한 파일에 모은다.
다른 곳에서 `ip.` 로 시작하는 쿼리를 쓰지 않는다.

## 도메인 규칙 — 여기가 핵심이다

`ip.apply_progress_entry()` 는 진행 기록 한 줄이 대장을 어떻게 고쳐 쓰는지 정한다.
**출원일과 등록일이 여기서 나온다.** 법정 기한이 걸린 값이다.

| 규칙 | 뜻 |
|---|---|
| `newer` | 대장의 `ref_date` 가 기록의 `occurred_on` 이하일 때만 단계가 바뀐다 |
| `moves` | `source='edit'`(값 정정)이면 단계는 반영하되 **날짜는 움직이지 않는다** |
| 빈 문자열 vs NULL | `''` 는 "지우기", `NULL` 은 "그대로 두기". **이 둘이 다르다** |
| latch | `filed_on`·`registered_on` 은 '출원'·'등록' 단계에서 한 번만 채워지고 이후 유지 |

`ip.rebuild_ledger()` 는 같은 규칙을 출발선(`opening_state`)부터 순서대로 다시 밟아
대장을 처음부터 계산한다. **이 함수가 곧 회귀 시험이다** — 돌렸을 때 대장이 그대로면
데이터와 로직이 온전하다.

> 이 함수들을 TypeScript 로 옮겨 적지 않는다. 규칙 하나를 놓치면 결과가 화면
> 오작동이 아니라 틀린 출원일이다.

## 신원

`auth.uid()` 대신 `ip.current_actor()` 를 쓴다. 값은 API 가 트랜잭션마다 심는다.

```ts
import { withActor } from "@/lib/ip-data"

await withActor(userId, async (tx) => {
  await tx.$executeRaw`…`   // 트리거가 누가 고쳤는지 안다
})
```

`set_config(…, true)` 의 `true` 는 트랜잭션 지역이라는 뜻이다. `false` 로 두면
커넥션 풀에서 앞사람 이름이 다음 요청에 따라간다. **쓰기는 반드시 `withActor` 를 거친다.**

## 권한

RLS 는 없다. Prisma 는 DB 소유자로 접속하므로 켜 둔들 통과한다.
판단하는 자리는 `lib/ip-data.ts` 의 `getMembership()` / `canWrite()` 한 곳이다.

| 역할 | 할 수 있는 것 |
|---|---|
| `owner` | 구성원 관리까지 |
| `editor` | 자료 편집 |
| `viewer` | 읽기만 |

`ip.members.user_id` 는 Omnis `User.id` 를 가리킨다. 셀프 가입(`access_requests`)과
사전 허용 목록(`allowed_emails`)은 옮기지 않았다 — 계정을 관리자가 만드는 Omnis 계정
하나로 모아, 누구인지 확인하는 절차가 계정 발급 시점으로 앞당겨졌다.

## 표

| 표 | 무엇 | 행 (2026-09-02) |
|---|---|---|
| `trademarks` · `patents` | 대장. 진행 기록이 트리거로 갱신한다 | 16 · 11 |
| `progress_entries` | 진행 이력. 화면의 타임라인 | 95 |
| `opening_state` | 넘겨받은 시점의 상태. 재계산의 출발선. **갱신하지 않는다** | 27 |
| `status_options` | 단계 목록과 각 단계가 요구하는 칸 | 24 |
| `communications` · `communication_links` | 연락 기록과 그것이 걸리는 건 | 0 · 0 |
| `actions` | 미결 액션 | 0 |
| `integrity_flags` | 자료 불일치 경고 | 2 |
| `org_meta` | 조직·대리인 사무소. 한 행만 | 1 |
| `audit_log` | 변경 이력 | 876 |
| `members` · `member_prefs` | 접근 권한과 화면 설정 | 2 · 1 |

## MCP 서버

`oauth_clients` · `oauth_codes` · `oauth_requests` · `oauth_tokens` · `mcp_tokens` ·
`mcp_guide_reads` 도 함께 옮겼다. 표만 먼저 옮기면 웹앱과 MCP 가 서로 다른 DB 를
보게 되고, **둘 다 정상 동작하는 것처럼 보이면서** 데이터가 갈라지기 때문이다.

| 것 | 어디 |
|---|---|
| MCP 엔드포인트 | `app/api/ip-mcp/[[...path]]/route.ts` |
| 도구·지침·토큰 | `lib/ip-mcp.ts` |
| 승인 화면 | `app/ip-mcp/authorize/` |

**주소가 바뀐다.** `${SUPABASE_URL}/functions/v1/ip-mcp` → `<Omnis>/api/ip-mcp`.
issuer 와 resource 식별자가 주소 그 자체라 옛 주소를 살려 둘 방법이 없다 —
이미 붙여 둔 커넥터는 새 주소로 다시 연결해야 한다.

원본과 달라진 것은 셋뿐이다. 도구 설명과 사용 지침은 **한 글자도 바꾸지 않았다** —
그 문장들은 모델이 실제로 틀렸던 것을 하나씩 막으려고 다듬은 것이라, 다시 쓰면
그 경험이 사라진다.

1. 주소 (위)
2. 승인 화면이 Omnis 안으로 들어왔다. 예전에는 정적 앱에 띄우고 Supabase 세션
   토큰을 헤더로 넘겨받았는데, Omnis 에는 이미 세션이 있어 그 왕복이 사라졌다.
3. `reissue_mcp_token` 만 plpgsql → TypeScript. pgcrypto 의 `gen_random_bytes`·
   `digest` 에 기대고 있었는데 그 확장이 있는지는 배포처마다 다르다.

### 쓰기 게이트

쓰기 도구(`add_progress`·`correct_ip`·`create_ip`)는 `read_guide` 가 알려주는 확인
코드를 요구한다. 코드가 없으면 첫 시도를 거절하면서 지침 전문을 돌려주고 「보여줬다」를
기록한다 — 같은 호출을 다시 보내면 저장된다. 커넥터가 들고 있는 도구 스키마는 처음
붙일 때 받아 둔 사본이라 새 인자를 보내지 못하는 클라이언트가 있고(실제로 ChatGPT 가
멈췄다), 막는 장치가 일을 못 하게 만드는 장치가 되면 안 되기 때문이다.

`source='mail'` 인데 `raw`(근거 원문)가 없으면 **저장하지 않는다.** 저장한 뒤
경고만 하면 모델은 「다음부터 남기겠습니다」로 끝낸다 — 이미 저장된 기록에 원문을
채울 도구가 없으니 당연하다. 저장 전에 막아야 할 수 있는 일이 하나 남는다.

## 지식 검색

상표·특허 한 건이 `EmbeddingSource.IP_CASE` 청크 하나다 (`sourceId` 는 `trademark:TM-01` 꼴).
대장의 현재 값만이 아니라 진행 이력을 함께 담는다 — "이 상표 어떻게 돼가?"의 답은
현재 단계가 아니라 거쳐 온 과정에 있다.

집계 질문("등록된 상표 전부")은 top-K 검색이 조용히 몇 건을 빠뜨리므로,
`app/api/omnis/ask/route.ts` 의 `buildIpOverview()` 가 27건 전량 요약을 함께 싣는다.

```bash
GEMINI_API_KEY=… npx tsx scripts/backfill-ip-embeddings.ts
```

> **범위 주의:** 지금 구조에서는 Omnis 사용자 전원이 옴니스 질문으로 상표·특허
> 현황을 볼 수 있다. ip-platform 에서는 `ip.members` 2명만 보던 자료다.
> 좁히려면 `buildIpOverview()` 와 `retrieveContext` 의 `sources` 를 멤버십으로 건다.

## 검증

```bash
TARGET_DB="…" npx tsx scripts/verify-ip-import.ts   # 이사 20가지
npx tsx scripts/verify-ip-api.ts                     # API 권한 16가지
npx tsx scripts/verify-ip-mcp.ts                     # MCP·OAuth 37가지
```

행 수, 사용자 연결, 참조 무결성, **`rebuild_ledger` 동일성**, 트리거 복구를 본다.
스키마나 함수를 건드렸다면 이걸 먼저 돌린다.
