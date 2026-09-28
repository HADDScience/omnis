---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-28-drop-ai-ecm-com.md
last_verified: 2026-09-28
---

# `ai-ecm-com` 제거 — 검증 기록

계획서: [`mydocs/plans/2026-09-28-drop-ai-ecm-com.md`](../plans/2026-09-28-drop-ai-ecm-com.md)

## 변경 전 운영 상태 (2026-09-28, 캐시 우회)

```
GET  /sso/authorize?app=vivoframe                             307
GET  /sso/authorize?app=ai-ecm-com                            307
GET  /sso/authorize?app=ai-ecm                                307
POST /api/sso/redeem  Origin: ecm.haddscience.com  app=ai-ecm-com    401 invalid_grant
POST /api/sso/redeem  Origin: ecm.haddscience.com  app=vivoframe     403 origin_not_allowed
GET  https://ecm.haddscience.com/                             200
```

네 번째가 판단 근거다. `401 invalid_grant` 는 **오리진 검사를 통과했다**는 뜻이라
등록이 살아 있었다. 지워졌다면 `400 unknown_app` 이 나온다.

## 게이트 1 — `pnpm run verify`

```
0 errors, 43 warnings
```

경고는 기존 것이다. 브랜치 44줄 · `main` 44줄로 같다(`pnpm run lint | grep -c warning`).

## 게이트 2 — `tsx scripts/verify-sso.ts`

운영 서명 키를 꺼내지 않았다. 임시 ES256 키를 만들어 썼고(`kid=verify-temp-…`),
DB 는 로컬(`localhost:5433`)이다.

```
[7] AI ECM · VivoFrame
  ✓ vivoframe 등록
  ✓ ai-ecm-com 제거됨
  ✓ 옛 오리진은 CORS 거부
  ✓ ai-ecm(tailnet) 그대로 (회귀)
  ✓ vivoframe 오리진은 CORS 허용
  ✓ 모르는 오리진은 거부
  ✓ vivoframe 세션을 ai-ecm(tailnet)이 쓰면 거부
  ✓ 자기 앱에서는 통과
  ✓ 복귀 경로 기본값은 /
  ✓ 다른 오리진으로는 못 돌아감

통과: 54 passed, 0 failed
```

## 게이트 3 — 음성 대조

통과만 하는 시험이 아닌지 확인했다. `ai-ecm-com` 을 임시로 되돌려 넣고 다시 돌렸다.

```
[7] AI ECM · VivoFrame
  ✓ vivoframe 등록
  ✗ ai-ecm-com 제거됨
  ✗ 옛 오리진은 CORS 거부
  ✓ ai-ecm(tailnet) 그대로 (회귀)
  …
실패: 52 passed, 2 failed
```

새 시험 두 건이 정확히 그 자리에서 물고, 나머지는 그대로다. 확인 뒤 되돌렸다.

## 배포 후 운영 확인

머지 `bfcc6a3` (#69). **omnis 는 git 자동배포가 꺼져 있어** `vercel deploy --prod --yes` 로
따로 쳤다 — 배포 `omnis-hadd-1g852wzop`, target production, Ready.

```
GET  /sso/authorize?app=ai-ecm-com                            400   ← 이전 307
GET  /sso/authorize?app=vivoframe                             307
GET  /sso/authorize?app=ai-ecm                                307   회귀 없음
GET  /sso/authorize?app=hub-com                               307   회귀 없음
POST /api/sso/redeem  Origin: ecm.haddscience.com  app=ai-ecm-com   400 unknown_app
                                                                    ← 이전 401 invalid_grant
POST /api/sso/redeem  Origin: vivoframe…           app=vivoframe    401 invalid_grant
OPTIONS /api/sso/redeem  Origin: ecm.haddscience.com   204, ACAO 없음      ← 닫힘
OPTIONS /api/sso/redeem  Origin: vivoframe…            204, ACAO vivoframe
```

`401 invalid_grant` → `400 unknown_app` 이 제거의 증거다. 401 은 오리진 검사를 통과한
뒤 표가 틀렸다는 뜻이고, 400 은 앱 자체를 모른다는 뜻이다.

## 2단계 — 도메인 제거

Vercel 프로젝트 `ecm-ai-platform` 에서 `ecm.haddscience.com` 만 뗐다
(`DELETE /v9/projects/ecm-ai-platform/domains/…`, HTTP 200). **DNS 는 건드리지 않았다** —
와일드카드 `*` ALIAS 가 그대로라 이름은 풀리고 Vercel 이 배정을 못 찾는 상태가 된다.

```
프로젝트에 남은 도메인   vivoframe.haddscience.com · ecm-ai-platform.vercel.app
```

## 최종 상태

```
https://vivoframe.haddscience.com/   200   브리지 app=vivoframe
https://ecm.haddscience.com/         404   x-vercel-error: DEPLOYMENT_NOT_FOUND
https://hub.haddscience.com/         200
https://omnis.haddscience.com/       200
https://haddscience.com/             307
https://www.haddscience.com/         308
회사 메일 MX·DKIM 레코드              3건 그대로 (8번 함정)
```
