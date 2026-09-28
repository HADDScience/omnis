---
kind: decision
status: active
canonical: mydocs/plans/2026-09-28-drop-ai-ecm-com.md
last_verified: 2026-09-28
---

# 옛 주소 등록 `ai-ecm-com` 을 걷는다

상태: 2026-09-28 작업지시자가 제거를 지시했다. 허브 세션(hadd-hub-08)이 수행한다.
AI바이오 P1 세션은 이 건에 손대지 않는다 — 두 세션이 같은 파일을 잡으면 9/22 에
PR #61·#63 이 부딪친 일이 반복된다.

## 왜 지금인가

`ai-ecm-com`(`https://ecm.haddscience.com`)은 2026-09-22 에 VivoFrame 주소를 더하면서
**나란히 남겨 둔** 항목이다([#61](https://github.com/HADDScience/omnis/pull/61)).
그때 `lib/sso.ts` 주석이 걷을 조건을 적어 두었다 — 「사내 런처가 새 주소로 넘어간 뒤」.

그 조건이 충족됐다.

| 조건 | 확인 |
|---|---|
| 런처가 새 주소로 넘어감 | hadd-hub [#10](https://github.com/HADDScience/hub/pull/10) `59c7d5f`, 2026-09-22 배포. 운영 번들에 `ecm.haddscience.com` 0회 |
| 협회 제출 증빙 | 9/22 전환 직후 새 주소로 재촬영. `플랫폼이용증빙_A4_260923_WC_01.pdf` 1면이 `https://vivoframe.haddscience.com` 을 접속 주소로 적는다 |
| 밖으로 나간 옛 주소 링크 | 0건. 웍스 보낸메일 45일치 24통·Gmail·협회 산출물 9개 전수 확인 (AI바이오 P1 세션, 2026-09-28 14:40) |

6일을 더 끈 것은 아무도 진행 승인을 주지 않아서였다. 기능 문제는 없었다 — 다만
**한 도구를 세 등록이 가리키는 상태**가 남았고, 다음에 이 표를 만지는 사람이 어느
것이 산 것인지 판단해야 한다.

## 순서 — 등록을 먼저, 도메인을 나중에

```
1) lib/sso.ts 에서 ai-ecm-com 제거 → 머지 → vercel deploy --prod
2) 그 뒤 Vercel `ecm-ai-platform` 에서 ecm.haddscience.com 도메인 처리
```

거꾸로 하면 깨진다. **등록을 남긴 채 옛 도메인에 리다이렉트를 걸면** SSO 콜백이
그 오리진으로 돌아오다 리다이렉트를 타면서 실패한다. 등록이 먼저 사라지면 그 오리진을
향하는 흐름 자체가 없어져, 도메인을 떼든 308 로 돌리든 안전하다.

### 기각된 근거 하나

9/22 인수인계 메모는 「리다이렉트 안은 CORS preflight 확인 후에만」이라고 적었다.
그건 **리다이렉트가 API 경로에 있을 때**의 문제다(허브가 `haddscience.com/omnis` 를
못 쓴 이유 — `/api/sso/redeem`·`/api/sso/verify` 가 그 경로 아래 있었다).
페이지 도메인 자체의 308 과는 무관하다. 이 근거로 리다이렉트 안을 막지 않는다.
그럼에도 **제거**를 택한 것은 협회로 나가는 문서가 새 주소를 가리켜 구 주소가
없는 편이 일관되기 때문이다.

## 범위 밖 — tailnet `ai-ecm`

> **후속:** 같은 날 작업지시자가 「쓸 필요 없다」고 확인해 이것도 걷었다 —
> [`2026-09-28-drop-ai-ecm-tailnet.md`](2026-09-28-drop-ai-ecm-tailnet.md).
> 아래는 이 계획을 세우던 시점의 판단이다.

손대지 않는다. 껐던 이유(Tailscale Funnel 의 공유 토큰 하나로 미공개 데이터셋이
링크와 함께 새어나갈 수 있던 것)가 아직 풀리지 않았고, 되살릴 계획이 있는지는
데이터 쪽 판단이다. 이 정리에 휩쓸려 사라지지 않도록 **회귀 시험으로 지킨다.**

## 단계

1. `lib/sso.ts` — `ai-ecm-com` 항목 제거, `vivoframe` 주석을 현재 사실로
2. `scripts/verify-sso.ts` — [7] 절을 「남아 있는가」에서 「사라졌는가」로 뒤집는다.
   `resolveApp("ai-ecm-com") === null` 과 `!isAllowedOrigin("https://ecm.haddscience.com")`.
   audience 분리 시험의 짝은 `ai-ecm`(tailnet)으로 옮긴다
3. 게이트 — `pnpm run verify`, `tsx scripts/verify-sso.ts`, **음성 대조**(되돌리면 실패하는지)
4. PR → 머지 → `vercel deploy --prod --yes` → 운영에 HTTP 로 확인
5. Vercel 도메인 처리

## 되돌리는 법

항목을 다시 넣고 배포하면 복구된다. 삭제되는 상태가 없다(등록표는 코드다).
도메인을 뗀 뒤라면 Vercel 에서 다시 붙여야 한다 — DNS 는 와일드카드라 레코드 작업은 없다.
