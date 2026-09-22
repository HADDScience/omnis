---
kind: reference
status: active
canonical: mydocs/troubleshootings/domain-migration-traps.md
last_verified: 2026-09-18
---

# 도메인 이전에서 밟은 함정 (2026-09-17~18)

haddscience.com 을 아임웹에서 Vercel 로 옮기고, Omnis 를 `omnis.haddscience.com`,
허브를 `hub.haddscience.com` 으로 분리하면서 실제로 겪은 것만 적는다.
같은 일을 다시 할 때(새 앱에 도메인을 붙일 때) 읽는다.

**여기는 Omnis 쪽 함정이다.** 홈페이지 쪽(옛 글 주소 404 · www 대표 주소 · 검색 차단 · 서브도메인 basePath)은
hadd-website 저장소의 `mydocs/troubleshootings/domain-cutover-traps.md` 에 있다.

## 1. 옛 서버가 주는 응답을 새 배포로 착각한다

옮긴 직후 `haddscience.com/ko/news` 가 404 였다. 새 코드의 리다이렉트가 잘못된 줄 알았지만
응답 머리에 `server: nginx` · `via: … cloudfront.net` 이 찍혀 있었다 — 아임웹(CloudFront)이 답한 것이다.

- **권위 네임서버에 직접 묻는다:** `dig +short haddscience.com @ns1.vercel-dns.com` → Vercel IP(216.198.79.65 · 64.29.17.65).
  일반 `dig` 는 리졸버 캐시라 옛 IP(13.225.117.x)를 준다.
- **Vercel 로 직접 때려 본다:** `curl -s -D- --resolve haddscience.com:443:216.198.79.65 https://haddscience.com/ko/news`
- 리졸버마다 다르다 — KT `168.126.63.1` 은 옛 IP, `168.126.63.2` 는 새 IP 를 줬다(같은 시각).
- 로컬 캐시 비우기: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`

**응답 머리의 `server` · `x-vercel-id` 를 먼저 본다.** 이것 없이 코드를 고치면 멀쩡한 코드를 고치게 된다.

## 2. 404 의 원인이 하나가 아닐 수 있다

위 404 는 캐시 때문만이 아니었다. Vercel 로 직접 물어도 `/ko/news/166087150/` 는 404 였다 —
아직 옮기지 않은 옛 글은 본문 블록이 없어 상세 페이지가 생성되지 않는다. 도메인을 넘겨받으면서
옛 아임웹 주소가 리다이렉트로 그 경로에 들어오니 그대로 404 가 됐다.
(홈페이지 쪽 조치: 원문 호스트 `haddscience.imweb.me` 로 보내는 다리. **남은 글을 다 옮기기 전에는 아임웹을 해지하지 않는다.**)

「캐시였네」 에서 멈추지 않는다. 캐시를 우회한 경로로 한 번 더 재현해 본다.

## 3. Vercel 이 DNS 를 갖고 있으면 등록기관 작업이 없다

네임서버가 `ns1/ns2.vercel-dns.com` 이면 가비아에서 할 일이 없다. 프로젝트에 도메인만 붙이면 된다.

```
vercel domains add omnis.haddscience.com omnis-hadd
vercel domains verify omnis.haddscience.com      # configured-correctly 확인
vercel dns ls haddscience.com                    # `*` ALIAS 가 하위 도메인을 다 받는다
```

붙인 직후 이름이 안 풀려도 Vercel 쪽은 이미 준비돼 있다 — `--resolve` 로 확인하면 200 이 온다.

## 4. basePath 를 떼면 옛 주소를 부르는 것이 사람만이 아니다

`NEXT_PUBLIC_BASE_PATH=/omnis` 를 비우면 `/omnis/…` 가 전부 404 가 된다. 북마크만 문제가 아니다:

- **claude.ai MCP 커넥터** 가 `…/omnis/api/ip-mcp` 로 등록돼 있다
- **OAuth 디스커버리** 는 `/.well-known/oauth-authorization-server/omnis/api/ip-mcp` 를 찾는다(RFC 8414 §3.1)
- **홈페이지** 가 `/omnis/api/website/media/…`(기사 사진)를 rewrite 로 받아 간다

그래서 basePath 를 떼는 배포에 **호환 rewrite 를 함께 넣는다**(`next.config.mjs`, basePath 가 빈 값일 때만):
`/omnis` · `/omnis/:path*` · 위 두 `.well-known` 경로.

**redirect 가 아니라 rewrite 다.** 이런 클라이언트는 redirect 를 따라가지 않거나, 따라가도 POST 본문을 잃는다.
CORS preflight 도 redirect 를 따라가지 않는다.

## 5. 저장소가 셋이라 순서가 있다

Omnis(앱) · hadd-website(홈페이지) · hadd-hub(허브)가 서로를 주소로 부른다.

| 바꿀 것 | 어디 |
|---|---|
| `/omnis` rewrite 목적지 · `OMNIS_UPSTREAM` | hadd-website `next.config.ts` |
| `OMNIS_ORIGIN` 기본값 · `NEXT_PUBLIC_OMNIS_URL` | hadd-website `lib/omnis-auth.ts` |
| 기사 사진 rewrite — **redirect 로 바꾸지 않는다** (오리진이 갈리면 업로드·최적화가 꼬인다) | hadd-website |
| SSO 앱 등록(오리진마다 하나) | Omnis `lib/sso.ts` |

**홈페이지·허브 쪽 수정을 먼저 배포하고, Omnis 의 basePath 제거를 나중에 짧게 친다.**
반대로 하면 그 사이 관리 화면 로그인과 기사 사진이 끊긴다.

## 6. SSO 앱은 오리진마다 따로다

`lib/sso.ts` 의 앱 id 는 오리진 하나에 묶인다(audience 가 앱별이라 한쪽 토큰이 다른 쪽에서 안 통한다).
같은 배포가 `haddscience.vercel.app` 과 `haddscience.com` 두 이름으로 보이면 앱도 둘이다(`hub-vercel` · `hub-com`).
허브를 `hub.haddscience.com` 루트로 옮기면 **origin 이 바뀌고 basePath 가 빈 값인 등록을 새로 추가**한다.

거꾸로, **Omnis 가 옮겨 가는 것은 SSO 등록과 무관하다** — 거기 적힌 오리진은 로그인하러 오는 쪽(클라이언트)의 주소다.

## 7. 도메인이 바뀌면 사람이 다시 로그인한다

쿠키는 오리진에 묶여 따라오지 않는다. 옮기는 시점에 전원 재로그인이 필요하다.
소셜 로그인은 **구글·카카오 콘솔의 리디렉션 주소**(`<새 오리진>/api/auth/callback/google` · `/kakao`)를
먼저 등록해 두지 않으면 그 순간부터 실패한다. 이름·비밀번호 로그인은 영향 없다.

`NEXTAUTH_URL` · `PUBLIC_URL` 도 함께 바꾼다. **환경변수는 빌드 때 번들에 박히므로 바꾼 뒤 재배포해야 한다.**

## 9. 환경변수만 바꾸려고 **옛 배포를 재배포하지 않는다**

`vercel redeploy <배포>` 는 그 배포의 **소스를 그대로 다시 굽고 환경변수만 새로 입힌다.**
그래서 옛 배포를 고르면 코드가 그 시점으로 돌아간다 — 2026-09-21 에 Gemini 키를 바꾸려다
9/17 커밋(`52c2e4a`)이 운영에 다시 올라갔고, 허브 로그인이 「등록되지 않은 앱」 으로 막혔다.

- 키만 바꿀 때도 **가장 최근 배포**를 재배포하거나, main 에서 새로 배포한다
- 배포가 어느 커밋인지는 메타로 확인한다 —
  `curl -H "Authorization: Bearer $TOKEN" https://api.vercel.com/v13/deployments/<url>` 의
  `meta.githubCommitSha` · `source`(`git` 인지 `cli` 인지)
- 무엇이 올라가 있는지 의심되면 배포된 응답으로 지문을 본다(있어야 할 경로가 404 인지 등).
  자세한 사례: [2026-09-21-pnpm-and-stale-redeploy](../working/2026-09-21-pnpm-and-stale-redeploy.md)

## 10. 커밋되지 않은 잠금파일이 빌드를 두 갈래로 만든다

Vercel 은 **업로드된 파일**을 보고 매니저를 고른다. untracked `pnpm-lock.yaml` 이 있으면
Git 푸시 배포는 npm, 폴더에서 한 `vercel --prod` 는 pnpm 으로 빌드된다. 같은 코드가 다르게 구워진다.
2026-09-21 에 pnpm 하나로 정하고 잠금파일을 커밋해 없앴다 — `AGENTS.md` 의 「패키지 매니저」 항목.

## 8. 메일 레코드를 건드리지 않는다

`haddscience.com` 존에는 회사 메일(네이버웍스)의 `MX` · SPF `TXT` 가 있다.
DNS 를 옮기거나 정리할 때 이것이 빠지면 회사 메일이 죽는다. `vercel dns ls` 로 먼저 확인한다.
