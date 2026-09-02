---
kind: reference
status: active
canonical: mydocs/troubleshootings/supabase-limits.md
last_verified: 2026-09-02
---

# 이 작업에서 실제로 밟은 함정

전부 한 번씩 겪고 고친 것들이다. 추측이나 일반론은 넣지 않았다.

---

## Prisma 의 shadow database 는 그 DB 를 비운다

`prisma migrate diff --shadow-database-url <URL>` 은 그 주소의 스키마를 **초기화한다.**
개발용 DB 주소를 넣으면 그 DB 의 데이터가 사라진다.

이 작업에서 실제로 로컬 `omnis-db` 를 비웠다. 경위는 이렇다 —
`.env.vercel`(Neon 주소)이 다른 프로세스에 의해 `.env.production.local` 로 이름이
바뀌고 `.env`(로컬 주소)가 새로 생겼는데, `POSTGRES_URL_NON_POOLING` 을 그대로
읽어 쓰다 보니 Neon 인 줄 알았던 값이 `localhost:5432` 였다.

**대응:** DB 를 건드리는 명령은 대상 호스트를 먼저 찍고, 기대한 호스트가 아니면 멈춘다.

```bash
case "$URL" in
  *neon.tech*) echo "Neon 확인";;
  *) echo "대상이 Neon 이 아님 — 중단"; exit 1;;
esac
```

가능하면 shadow database 는 그 용도로만 쓰는 빈 DB 를 따로 둔다.

---

## WebCrypto 는 개인키로 서명 검증을 못 한다

ES256 JWT 를 만들고, 같은 키 객체로 검증했더니 전부 실패했다. 서명·발급자·수명은
모두 맞는데 검증만 되지 않았다.

`importJWK()` 에 `d`(개인키 성분)가 있는 JWK 를 주면 WebCrypto 는 용도가
`["sign"]` 인 키를 만든다. 그 키로 `verify` 를 부르면 `InvalidAccessError` 다.

**대응:** 검증용 키는 `d` 를 떼고 따로 import 한다.

```ts
const { d: _private, ...pub } = jwk
const verifyKey = await importJWK(pub, "ES256")
```

증상이 "서명이 틀렸다"로 보이기 때문에 키를 의심하기까지 시간이 걸린다.

---

## jose 의 만료 검사는 `Date.now()` 모킹으로 못 속인다

토큰 만료를 시험하려고 `Date.now` 를 앞으로 밀었다. 통하지 않았다 — jose 는
내부에서 다른 경로로 현재 시각을 본다.

**대응:** 시계를 속이지 말고, **이미 만료된 토큰을 같은 키로 직접 만든다.**

```ts
new SignJWT({ kind, sub })
  .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
  .sign(key)
```

검증기가 정말 시각을 보는지 확인하는 데는 이쪽이 더 정직하다. 60초·8시간을
실제로 기다릴 수도 없다.

---

## `router.push` 로는 라우트 핸들러의 302 를 따라가지 못한다

로그인 뒤 `/sso/authorize` 로 돌려보내려 했는데 아무 일도 일어나지 않았다.
`/sso/authorize` 는 페이지가 아니라 302 를 돌려주는 라우트 핸들러라, App Router 의
클라이언트 내비게이션이 RSC 응답을 기대하고 리다이렉트를 놓친다.

**대응:** 라우트 핸들러로 갈 때는 통째로 이동한다.

```ts
window.location.assign(callbackUrl)
```

---

## 데이터를 옮길 때 트리거를 끄지 않으면 옮긴 값이 바뀐다

`ip.progress_entries` 를 넣는 순간 `apply_progress_entry` 트리거가 깨어나
방금 넣은 상표·특허를 다시 계산한다. 원본 그대로 옮기는 것이 목적인데
적재 도중에 값이 달라진다. 감사 트리거도 마찬가지로, 이사가 편집 876건으로 기록된다.

**대응:** 적재 구간에서만 끄고, 끝나면 되돌린다. 되돌렸는지 확인까지 한다.

```sql
ALTER TABLE ip.progress_entries DISABLE TRIGGER USER;
-- … 적재 …
ALTER TABLE ip.progress_entries ENABLE TRIGGER USER;
```

```
[5] 트리거가 다시 켜져 있는가
  ✓ 트리거 12개가 모두 켜져 있다
```

계산이 맞는지는 적재가 끝난 뒤 `rebuild_ledger()` 로 따로 확인한다 —
다만 그 함수는 읽기 전용이 아니다(아래 항목 참고). 트랜잭션 안에서 돌리고 롤백한다.

---

## 사용자 id 를 옮길 때는 uuid 가 아니라 이름으로 잇는다

Supabase 의 `auth.users` 와 Omnis 의 `User` 는 서로 모르는 표라 uuid 가 겹치지
않는다. 로컬 DB 와 Neon 은 시드가 달라 같은 사람의 uuid 도 서로 다르다.

**대응:** 옮기는 SQL 에 uuid 를 박지 말고 부속질의로 사람을 찾는다.

```sql
INSERT INTO ip.members (user_id, …)
VALUES ((SELECT id FROM public."User" WHERE name = '정우창'), …);
```

같은 파일이 로컬과 Neon 양쪽에서 맞는 사람을 가리킨다.

이 이사에서는 운이 좋았다 — 업무 데이터 122행의 `updated_by` 가 전부 `NULL` 이고
감사 876행 중 870행의 `actor` 도 `NULL` 이라, 실제로 이어야 할 사람은 2명뿐이었다.
그렇지 않았다면 매핑표를 먼저 만들어 사람이 확인해야 했다.

---

## "최신 상태"를 물을 때 이력 전체를 세면 안 된다

옴니스에 "우리 차례로 남은 지식재산권 업무"를 물었더니 같은 건이 네 번씩 나왔다.
`next_turn <> 'none'` 인 **모든 진행 기록**을 센 탓이다. 옛 기록의 「회신 필요」는
이미 지나간 상태다.

**대응:** 건마다 최신 기록 하나만 본다. 그리고 값 정정(`source='edit'`)은 최신
판정에서 **뺀다** — 정정은 누구 차례인지에 대해 아무 말도 하지 않으므로, 그것을
최신으로 치면 정정 한 번에 밀린 일이 목록에서 사라진다.

```sql
SELECT DISTINCT ON (entity_kind, entity_id) *
  FROM ip.progress_entries
 WHERE source <> 'edit'
 ORDER BY entity_kind, entity_id, occurred_on DESC, created_at DESC
```

ip-platform 의 `todo-view.tsx` · `site-nav.tsx` 가 쓰던 규칙과 같다. **화면이 이미
쓰고 있는 규칙을 찾아 맞추는 것**이, 그럴듯한 SQL 을 새로 짜는 것보다 언제나 낫다.

---

## RAG 는 집계 질문에서 조용히 몇 건을 빠뜨린다

"등록된 상표 전부"처럼 개수 제한이 없는 질문은 top-K 검색으로 답할 수 없다.
K 개만 돌아오므로 나머지는 없는 것이 된다. 빠졌다는 사실이 답에 드러나지 않아
읽는 사람이 알아채지 못한다.

**대응:** 전량이 작으면(상표·특허 합쳐 27건) 한 줄 요약을 통째로 컨텍스트에 싣는다.
Omnis 가 업무 목록에 이미 쓰던 방식이다. 자세한 이력은 검색된 청크가 맡는다.

---

## `rebuild_ledger()` 는 읽기 전용이 아니다 — note 를 지운다

「대장을 다시 계산해도 그대로인가」를 회귀 시험으로 쓰다가 실제로 자료를 잃었다.

`rebuild_ledger` 는 마지막에 `note = o.note` 로 대장의 비고를 **출발선(opening_state)의
비고로 덮어쓴다.** 그런데 `create_case` 로 만든 건은 출발선의 note 가 빈 문자열이다
(만들 때 note 를 대장에만 넣고 출발선에는 넣지 않는다). 그래서 나중에 대장에 적어 둔
비고가 rebuild 한 번에 사라진다.

이 이사에서 TM-19 와 PT-12 의 비고가 그렇게 지워졌다. PT-12 의 비고에는 논문 공개일
기준 **공지예외적용 12개월 기한**이 적혀 있었다.

되돌릴 수 있었던 것은 감사 기록 덕분이다 — `audit_log.before` 에 지워지기 전 값이
그대로 남아 있어 그 자리에서 복원했다. 이 표가 왜 필요한지 보여주는 사례다.

```sql
UPDATE ip.trademarks t SET note = (a.before ->> 'note')
  FROM ip.audit_log a
 WHERE a.entity = 'trademarks' AND a.entity_id = t.id
   AND (a.before ->> 'note') <> (a.after ->> 'note') AND t.note = '';
```

**대응 두 가지.**

1. 검증에서는 트랜잭션 안에서 돌리고 **일부러 롤백한다**(`scripts/verify-ip-import.ts`).
   값을 읽어 비교하는 것이 목적이지 쓰는 것이 아니다. 겸사겸사 no-op UPDATE 가
   감사 기록에 27줄씩 쌓이던 것도 사라진다.
2. 운영에서 `rebuild_ledger` 를 부를 일이 생기면 **비고가 날아간다는 것을 알고**
   불러야 한다. 고치려면 `create_case` 가 출발선에도 note 를 넣도록 바꿔야 하는데,
   그러면 「출발선은 인수 시점의 사실」이라는 뜻이 흐려진다 — 손대기 전에 그
   의미부터 정해야 한다.

---

## 날짜 컬럼에 timestamp 를 쓰면 하루가 밀린다

출원일·등록일·기한은 달력상의 날짜지 시각이 아니다. `timestamptz` 로 두고 UTC 로
다루면 KST 오전 9시 이전의 값이 어제로 적힌다. 법정 기한에서는 그 하루가 전부다.

**대응:** `date` 타입을 쓰고, 애플리케이션에서도 `YYYY-MM-DD` 문자열로만 다룬다.
MCP 서버가 `todayKst()` 를 따로 둔 것도 같은 이유다.
