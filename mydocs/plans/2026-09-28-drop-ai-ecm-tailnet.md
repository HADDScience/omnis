---
kind: decision
status: active
canonical: mydocs/plans/2026-09-28-drop-ai-ecm-tailnet.md
last_verified: 2026-09-28
---

# tailnet 등록 `ai-ecm` 도 걷는다

상태: 2026-09-28 작업지시자가 **「테일넷은 이제 쓸 필요 없다」** 고 확인했다.
[`2026-09-28-drop-ai-ecm-com.md`](2026-09-28-drop-ai-ecm-com.md) 가 범위 밖으로 둔
바로 그 항목이고, 그때 미뤄 둔 이유가 풀렸다.

## 왜 미뤄 뒀었나

그 계획서는 이렇게 적었다 — 「껐던 이유가 아직 풀리지 않았고, 되살릴 계획이 있는지는
**데이터 쪽 판단**이다」. 그 판단이 나왔다. 되살리지 않는다.

## 껐던 이유 (등록과 함께 사라지므로 여기 옮겨 둔다)

`https://macbookpro.tail28eea6.ts.net` 은 Tailscale **Funnel** 로 열던 주소다.
한때 주석에 "사내망 전용이라 안전하다"고 적혀 있었는데 그건 `serve` 일 때 이야기고,
Funnel 은 인터넷 전체에 연다.

인증이 **「링크를 아는 사람은 다 통과」하는 공유 토큰 하나뿐**이라, 미공개 데이터셋과
논문 원장이 그 링크와 함께 새어나갈 수 있었다. 그래서 껐다.
경위는 `ecm_ai_mvp/OMNIS-SSO-인수인계.md` 에 있다.

**다시 열 일이 생기면 공유 토큰으로 돌아가지 않는다.** 지금 vivoframe 이 쓰는 방식 —
서버가 세션을 검증하고 토큰은 HttpOnly 쿠키에만 담는 것 — 이 그 답이다.
이 문단을 `lib/sso.ts` 의 vivoframe 주석에도 옮겨 적었다.

## 지금 상태 (2026-09-28 실측)

```
curl https://macbookpro.tail28eea6.ts.net/     000  (연결 실패)
tailscale status                                Tailscale is stopped.
omnis /sso/authorize?app=ai-ecm                 307  ← 등록만 살아 있었다
```

떠 있지도 않은 배포를 가리키는 등록이었다.

## 단계

1. `lib/sso.ts` — `ai-ecm` 제거. 껐던 이유를 vivoframe 주석으로 옮긴다
2. `scripts/verify-sso.ts` — [7] 절에 `ai-ecm 제거됨` · `tailnet 오리진 CORS 거부` 추가.
   audience 분리 시험의 짝이 사라지므로 `hub` 로 옮긴다
3. 게이트 — `pnpm run verify`, `verify-sso.ts`, **음성 대조**
4. PR → 머지 → `vercel deploy --prod --yes` → 운영 HTTP 확인

도메인 작업은 없다. tailnet 주소는 Vercel 도, 우리 DNS 도 아니다.

## 되돌리는 법

항목을 다시 넣고 배포하면 복구된다. 다만 **되돌리는 것만으로는 열리지 않는다** —
tailnet 배포 자체가 꺼져 있고, 되살린다면 공유 토큰 문제를 먼저 풀어야 한다.
