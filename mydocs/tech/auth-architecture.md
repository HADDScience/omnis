---
kind: canonical
status: active
canonical: mydocs/tech/auth-architecture.md
last_verified: 2026-09-02
---

# 사내 도구 인증 구조

**한 줄:** Omnis 자체계정이 유일한 앵커이고, Omnis 가 다른 도구에 짧은 수명의
서명 토큰을 발급한다.

## 배치

| 도구 | 배포 | 오리진 |
|---|---|---|
| Omnis (업무관리) | Vercel | `https://omnis-hadd.vercel.app` |
| Hub (런처) | GitHub Pages · 정적 | `https://haddscience.github.io/hub/` |
| ip-platform | GitHub Pages · 정적 | `https://haddscience.github.io/ip-platform/` |

Hub 와 ip-platform 은 같은 오리진, Omnis 는 다른 오리진이다. 이 사실이 구조 전체를 정한다.

## 불변식

깨지면 설계가 무너지는 것들이다. 코드를 고칠 때 이 목록을 먼저 본다.

1. **소셜만으로는 계정이 생기지 않는다.** 구글·카카오는 이미 있는 Omnis 계정으로
   들어오는 또 하나의 문일 뿐이다. 연결은 로그인한 세션에서만 시작할 수 있다.
2. **소셜 이메일로 사람을 짐작해 묶지 않는다.** `User.email` 은 `String?` 이고 unique 도
   아니다. 개인 지메일·카카오 이메일은 회사 계정과 다르고, 카카오는 이메일이 선택
   동의라 아예 없을 수 있다.
3. **돌아갈 오리진은 요청이 정하지 못한다.** 언제나 `lib/sso.ts` 의 앱 화이트리스트에서 온다.
4. **grant 는 1회용이다.** 재사용 차단은 `SsoGrant` 의 `jti` 기본키 INSERT 가 한다.
5. **프로필은 토큰이 아니라 DB 에서 읽는다.** 그래야 퇴사 처리가 토큰 수명을
   기다리지 않고 다음 새로고침에 먹힌다.

## 흐름

```
Hub → GET  /sso/authorize?app=hub&next=/hub/
        ↳ 미로그인: /login?callbackUrl=… → 로그인 후 이 요청으로 복귀
        ↳ 로그인:   302 https://haddscience.github.io/hub/#sso=<grant>
Hub → POST /api/sso/redeem  { token, app }  → 세션 토큰(8시간) + 프로필
Hub → POST /api/sso/verify  { token, app }  → 페이지 로드마다 유효성 재확인
```

### 왜 프래그먼트인가

프래그먼트(`#`)는 서버로 전송되지 않는다. 쿼리스트링으로 넘기면 GitHub Pages 접근
로그와 `Referer` 헤더에 1회용 토큰이 남는다. 받은 즉시 `history.replaceState` 로
주소창에서도 지운다.

### 왜 grant 와 세션을 나누는가

grant 는 배달 중에만 살아 있으면 되므로 60초다. 그 짧은 표를 실제 세션으로 바꾸는
자리(`/api/sso/redeem`)가 **1회용을 강제하는 유일한 지점**이다. 앱이 혼자 서명만
확인한다면 같은 표를 몇 번이고 다시 쓸 수 있다.

### 왜 매번 verify 하는가

세션 토큰의 만료 시각을 앱이 스스로 보고 넘어가면, 퇴사 처리가 토큰 수명(8시간)
만큼 늦게 먹힌다. 서버에 한 번 되물으면 다음 새로고침에 끊긴다.

실패는 두 갈래로 나눈다. **401/403 이면 세션을 지우고**, **네트워크 오류면 저장된
만료 시각을 믿고 버틴다.** 데이터 경계도 아닌 런처가 인터넷이 한 번 끊길 때마다
사람을 쫓아낼 이유는 없다.

### audience

토큰의 `aud` 는 앱 id 다. Hub 용 토큰은 ip-platform 에서 검증에 실패한다. 두 앱이
같은 오리진이라 `localStorage` 를 나눠 쓰므로, 저장 키에도 앱 id 를 넣는다
(`hadd.sso.session.hub`). 앱마다 자기 표를 따로 받지만 그 왕복은 사람 눈에 보이지
않는다 — Omnis 쿠키가 살아 있으면 `/sso/authorize` 가 곧바로 되돌려보낸다.

### 서명

ES256. 정적 앱이 비밀키를 들 수 없으므로 검증은 `/api/sso/verify` 가 대신한다.
그럼에도 대칭키가 아닌 이유는 [troubleshootings/supabase-limits.md](../troubleshootings/supabase-limits.md) §2 에 적었다.
공개키는 `/api/sso/jwks`.

## 파일

| 경로 | 무엇 |
|---|---|
| `lib/sso.ts` | 앱 화이트리스트, 경로 검증, 토큰 발급·검증, grant 소모 |
| `app/sso/authorize/route.ts` | 진입점. 앱·경로를 먼저 검증하고 그 다음 세션을 본다 |
| `app/api/sso/redeem/route.ts` | grant → 세션. 1회용 강제 |
| `app/api/sso/verify/route.ts` | 세션 유효성 재확인 |
| `app/api/sso/jwks/route.ts` | 공개키 |
| `lib/auth.ts` | NextAuth v5. Credentials + Google + Kakao |
| `lib/auth-identity.ts` | 소셜 연결 규칙. 콜백에서 분리해 실 DB 로 검증 가능하게 |

## 검증

```bash
SSO_SIGNING_KEY="$(cat …/sso-key.json)" npx tsx scripts/verify-sso.ts      # 규칙 36가지
npx tsx scripts/verify-sso-live.ts                                          # 배포본에 실요청
```

`verify-sso.ts` 가 보는 것: 앱 화이트리스트, 오픈 리다이렉트 13종 거부,
audience 격리, 만료, 1회용 강제. `verify-sso-live.ts` 는 배포본이 퇴사자와 없는
계정을 막는지 실제 HTTP 로 확인한다.

## 하지 말 것

- 네이버웍스·Supabase 를 인증 앵커로 되돌리기 (검토 후 기각. 외부 IdP 에 재직 증명을
  맡기면 회사가 그 도구를 바꿀 때 계정이 통째로 흔들린다)
- `next` 파라미터를 검증 없이 쓰기
- 토큰을 쿼리스트링으로 넘기기
- grant 수명을 늘려 "편하게" 만들기
