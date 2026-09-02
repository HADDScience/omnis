---
kind: canonical
status: active
canonical: mydocs/troubleshootings/supabase-limits.md
last_verified: 2026-09-02
---

# Supabase 에서 무엇이 막혔고 어떻게 풀었나

사내 도구(Omnis · Hub · ip-platform)의 인증을 Omnis 자체계정 하나로 모으면서
Supabase 를 걷어냈다. 이 문서는 **무엇이 불편했는지**가 아니라 **무엇이 구조적으로
불가능했는지**를 적는다. 취향 문제는 적지 않는다 — 다시 읽을 때 판단이 흔들린다.

먼저 균형을 위해: Supabase 가 나빠서 걷어낸 것이 아니다. 2인용 지식재산권 도구
하나를 몇 주 만에 띄우는 데는 정확한 선택이었다. 도구가 셋으로 늘고 오리진이
갈라지면서 전제가 깨졌을 뿐이다.

---

## 1. 세션 공유가 오리진에 묶여 있었다

**증상.** Hub 에서 로그인하면 ip-platform 도 로그인 상태가 됐다. 그런데 Omnis 는
아무리 해도 되지 않았다.

**원인.** 그 공유는 연합(federation)이 아니었다. Supabase JS 클라이언트는 세션을
`localStorage` 의 `sb-<project-ref>-auth-token` 한 칸에 넣는다. Hub 와 ip-platform 은
둘 다 `haddscience.github.io` 라 **같은 오리진**이고, 그래서 같은 칸을 나눠 썼을
뿐이다. 브라우저가 오리진 사이의 `localStorage` 를 갈라놓는 것은 규격이므로,
Vercel 에 있는 Omnis(`omnis-hadd.vercel.app`)로는 원리적으로 넓힐 수 없었다.

즉 "SSO 처럼 보이던 것"은 SSO 가 아니라 저장소 우연이었다.

**해결.** Omnis 를 발급자(IdP)로 세우고, 오리진을 건너는 통로를 명시적으로 만들었다.

```
앱 → GET  https://omnis-hadd.vercel.app/sso/authorize?app=hub&next=/hub/
       ↳ 302  https://haddscience.github.io/hub/#sso=<grant>   (60초·1회용)
앱 → POST /api/sso/redeem   { token, app }  → 세션 토큰(8시간) + 프로필
앱 → POST /api/sso/verify   { token, app }  → 새로고침마다 유효성 재확인
```

토큰을 **프래그먼트(`#`)** 로 넘기는 것이 요점이다. 프래그먼트는 서버로 전송되지
않으므로 GitHub Pages 접근 로그에도 `Referer` 헤더에도 남지 않는다. 자세한 것은
[tech/auth-architecture.md](../tech/auth-architecture.md).

---

## 2. 외부 발급자를 끼워 넣을 수 없었다

**증상.** "그러면 Supabase 는 DB 로만 쓰고, Omnis 가 발급한 JWT 를 신뢰하게 하면
되지 않나?" — 이것이 가장 손이 덜 가는 길이었다. 되지 않았다.

**원인.** Supabase 의 서드파티 인증(Third-Party Auth)은 **고정된 목록**이다.
2026-09-02 공식 문서 기준 지원 대상은 다음 다섯 뿐이다.

> Clerk, Firebase Auth, Auth0, AWS Cognito (with or without AWS Amplify), WorkOS

임의의 발급자 URL 과 JWKS 주소를 넣는 일반 경로는 문서에 없다. 우리처럼 자체
IdP 를 세운 경우에는 들어갈 자리가 없다.

**해결.** 데이터를 Omnis 쪽 Postgres(Neon)로 옮겼다. 인증을 DB 에 맞추는 대신
DB 를 인증에 맞춘 것이다.

**남긴 것.** 그럼에도 SSO 토큰은 대칭키(HS256)가 아니라 **비대칭키(ES256)** 로
서명하고 공개키를 `/api/sso/jwks` 로 연다. 지금은 아무도 쓰지 않지만, 대칭키로
정하면 "직접 검증해야 하는 소비자"가 생겼을 때 되돌릴 수 없다. 고정 목록에 막혀
본 뒤라 이 여지는 남겨 두기로 했다.

---

## 3. 데이터 접근이 인증에 붙어 있었다 (RLS ↔ auth.uid)

**증상.** 로그인만 바꾸려 했는데 데이터 접근이 통째로 따라 무너졌다.

**원인.** ip 스키마의 RLS 정책은 전부 `auth.uid()` 를 본다.

```sql
create function ip.can_write() returns boolean language sql stable as $$
  select exists (
    select 1 from ip.members m
     where m.user_id = auth.uid() and m.role in ('owner','editor')
  );
$$;
```

`auth.uid()` 는 요청에 실린 Supabase JWT 에서 나온다. Supabase Auth 를 떼는 순간
이 함수는 언제나 `null` 을 보고, 모든 정책이 거짓이 되어 아무도 자기 데이터를
읽지 못한다. 인증 교체가 데이터 계층 교체를 강제한 지점이 여기다.

**해결.** 신원의 출처를 함수 하나로 갈아 끼웠다.

```sql
create function ip.current_actor() returns text language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')
$$;
```

값은 API 가 트랜잭션마다 심는다.

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`
  return work(tx)
})
```

`set_config` 의 세 번째 인자 `true` 가 **트랜잭션 지역**이라는 뜻이다. 이걸 `false`
로 두면 커넥션 풀에서 같은 연결을 물려받은 다음 요청에 앞사람 이름이 따라가고,
감사 기록의 주인이 조용히 뒤섞인다. 서버리스에서는 반드시 `true` 여야 한다.

---

## 4. RLS 는 어차피 마지막 방어선이 아니었다

**증상.** RLS 를 걷어내는 것이 보안을 낮추는 일처럼 보였다. 실제로는 아니었다.

**원인.** MCP 서버(엣지 함수)는 `service_role` 로 접속한다. `service_role` 은 RLS 를
지나간다. 원본 파일의 주석이 그렇게 적고 있다.

> service_role 로 DB 에 붙으므로 RLS 를 지나간다. 그래서 이 파일이 곧 권한 경계다.

즉 쓰기 경로 하나는 이미 RLS 밖에 있었고, 진짜 경계는 애플리케이션 코드였다.
Prisma 도 DB 소유자로 접속하므로 RLS 를 켜 둔들 통과한다.

**해결.** 있는 척하는 방어막을 두지 않기로 했다. RLS 를 걷고, 판단하는 자리를
`lib/ip-data.ts` 의 `getMembership()` / `canWrite()` 한 곳으로 못박았다. 모든
라우트가 그 함수를 지난다. 방어가 한 겹인 것은 전과 같지만, **어디가 그 한 겹인지**
가 코드에 드러난다는 점이 다르다.

---

## 5. 소셜 로그인이 제공자 사정에 휘둘렸다

**증상.** 계정 연결이 서버 설정 한 칸에 막히고, 카카오는 동의항목 때문에 인가가
거절됐다.

**원인.**

- `manual_linking_disabled` — 대시보드에서 Manual Linking 을 켜지 않으면 한 사람이
  구글과 카카오를 한 계정에 묶을 수 없다. 코드로는 어찌할 수 없는 칸이다.
- 카카오 프로바이더가 `account_email profile_image profile_nickname` 를 **고정으로**
  요청한다. 클라이언트의 `scopes` 옵션은 이 기본값을 대체하지 못하고 덧붙기만 한다
  (supabase/supabase#36878, 아직 열려 있음). 콘솔에서 동의항목을 열지 않으면 KOE205
  로 거절된다.

**해결.** 연결 규칙을 우리 코드로 가져왔다(`lib/auth-identity.ts`). 자체계정(`User`)이
앵커이고 소셜은 `UserIdentity` 로 붙는 문일 뿐이다. 핵심 불변식은 그대로 지켰다:

> **소셜만으로는 계정이 생기지 않는다.** 연결은 이미 로그인해 계정 소유를 증명한
> 세션에서만 시작할 수 있다.

이 규칙이 코드 안에 있으니 실 DB 에 대고 검증할 수 있다. OAuth 왕복 없이
연결·거부·퇴사자 차단·멱등성을 재현하는 것이 가능해졌다 —
프로바이더 콘솔 설정에 의존할 때는 못 하던 일이다.

---

## 6. 옮길 수 있었던 이유: 도메인 로직은 Supabase 것이 아니었다

이 항목은 문제가 아니라 **왜 이 이사가 감당 가능했는지**에 대한 기록이다.

ip 스키마의 값어치는 표가 아니라 plpgsql 에 있다. `ip.apply_progress_entry()` 는
진행 기록 한 줄이 상표·특허 대장을 어떻게 고쳐 쓰는지를 정한다 — 출원일과 등록일,
즉 **법정 기한이 걸린 값**이 여기서 나온다. 규칙은 셋이다.

- 더 최신 기록만 시계를 움직인다 (`ref_date <= occurred_on`)
- 값 정정(`source='edit'`)은 단계는 반영하되 날짜는 두지 않는다
- 빈 문자열은 "지우기", `NULL` 은 "그대로 두기" (이 둘이 다르다)

이 로직은 Postgres 것이지 Supabase 것이 아니다. 그래서 **한 글자도 고치지 않고**
옮겼다. 전체 이식에서 바뀐 것은 `auth.uid()` → `ip.current_actor()` 하나뿐이다.

TypeScript 로 다시 적지 않은 이유는 분명하다. 위 세 규칙을 옮겨 적다가 하나를
놓치면, 그 결과는 화면 오작동이 아니라 **틀린 출원일** 이다.

**검증.** 옮긴 뒤 `ip.rebuild_ledger()` 를 돌렸다. 이 함수는 출발선(`opening_state`)
에서 시작해 진행 기록 95건을 순서대로 다시 밟아 대장을 처음부터 계산한다.
결과가 지금 대장과 **한 칸도 다르지 않았다**. 행 수를 세는 것보다 훨씬 강한 확인이다.

```
[4] 이식한 plpgsql 이 원본과 같은 대장을 만드는가
  ✓ rebuild_ledger 가 27건을 다시 계산했다
  ✓ 다시 계산해도 대장이 그대로다 (한 칸도 바뀌지 않음)
```

---

## 7. 이사 도중의 갈라짐(split brain)

**증상.** 아직 겪지 않았다. 겪으면 늦기 때문에 적어 둔다.

**원인.** ip 데이터를 쓰는 경로가 둘이다 — 웹앱(`lib/db.ts`)과 MCP 서버(엣지 함수).
웹앱만 Omnis 로 넘기고 MCP 를 Supabase 에 두면, MCP 로 남긴 진행 기록이 웹앱에
보이지 않고 그 반대도 마찬가지다. 둘 다 "정상 동작"하므로 한동안 아무도 모른다.

**대응.** 둘은 반드시 같은 시점에 넘긴다. 그때까지 Neon 쪽 ip 스키마는 **사본**이며
아무도 쓰지 않는다. 쓰기 시작하는 순간이 곧 Supabase 를 끄는 순간이다.

---

## 요약

| Supabase 에서 막힌 것 | 왜 구조적이었나 | 어떻게 풀었나 |
|---|---|---|
| 세션 공유가 오리진 안에서만 | `localStorage` 는 오리진 격리가 규격 | Omnis 가 발급자, 프래그먼트로 1회용 grant |
| 자체 IdP 를 신뢰시킬 수 없음 | 서드파티 인증이 5개 고정 목록 | DB 를 Neon 으로 이전 |
| RLS 가 `auth.uid()` 에 묶임 | 인증을 떼면 정책이 전부 거짓 | `ip.current_actor()` + 트랜잭션 지역 설정 |
| RLS 가 실질 경계가 아니었음 | `service_role` 이 이미 우회 | 경계를 `getMembership()` 한 곳으로 명시 |
| 소셜 연결이 콘솔 설정에 종속 | 제공자 scope 를 코드가 못 바꿈 | 연결 규칙을 자체 테이블·코드로 |

**바꾸지 않은 것:** 도메인 plpgsql. 그것이 Supabase 것이 아니었기 때문이다.
