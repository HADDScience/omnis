---
kind: canonical
status: active
canonical: mydocs/troubleshootings/client-error-visibility.md
last_verified: 2026-09-04
---

# 화면이 흰 채로 죽는데 아무도 모르던 문제

2026-09-04. `omnis-hadd.vercel.app/omnis/ask` 에서 질문에 답이 온 순간
화면 전체가 흰 바탕에 한 줄만 남았다.

```
Application error: a client-side exception has occurred while loading
omnis-hadd.vercel.app (see the browser console for more information).
```

## 무엇이 터졌나

`EmbeddingSource` 는 값이 **다섯** 개다.

```prisma
enum EmbeddingSource {
  OMNIS_CARD  TASK  WEEKLY_REPORT  CHAT_MESSAGE  IP_CASE
}
```

`components/omnis/omnis-ask.tsx` 는 **네** 개만 알고 있었다. `sourceHref` 의
switch 에 `IP_CASE` 도 `default` 도 없어서, 지식재산권 자료가 출처로 딸려 오면
`undefined` 를 돌려줬다.

```tsx
<Link href={sourceHref(s)}>   // href={undefined} → Next.js 가 던진다
```

특허·상표를 묻는 질문이면 IP_CASE 청크(27건)가 검색에 걸린다. 그래서
**그 질문에서만** 죽었다.

## 왜 아무도 몰랐나

두 가지가 겹쳤다.

1. **error boundary 가 하나도 없었다.** `app/error.tsx` 도 `app/global-error.tsx`
   도 없어서 Next.js 기본 화면만 떴다. UX 규칙 29(error boundary)를 앱 전역에서
   어기고 있었다.
2. **오류 추적이 없었다.** Sentry 류가 설치돼 있지 않고, 클라이언트 예외는
   서버 로그에도 남지 않는다. 사용자가 캡처를 보내 주기 전까지 알 방법이 없었다.

## 어떻게 고쳤나

| | |
|---|---|
| 타입을 서버와 공유 | `type SourceType = EmbeddingSource` — 따로 선언하지 않는다 |
| 빠진 case 는 빌드에서 막는다 | `default:` 에 `s.source satisfies never` |
| 열 곳이 없으면 링크를 안 그린다 | `sourceHref` 가 `string \| null`. null 이면 `<div>` |
| 흰 화면 대신 안내 | `app/(main)/error.tsx` · `app/global-error.tsx` |
| 터지면 메일 | `POST /api/errors` → `lib/alert-mail.ts` |

### 가드가 실제로 막는지 확인한 방법

`IP_CASE` case 를 지우고 타입 검사를 돌렸다.

```
components/omnis/omnis-ask.tsx(90,16): error TS1360:
  Type '"IP_CASE"' does not satisfy the expected type 'never'.
```

되돌리니 통과. 이제 `EmbeddingSource` 에 값을 더하면서 화면을 안 고치면
빌드가 먼저 깨진다.

## 남은 것

- **메일은 환경변수 3개를 넣어야 나간다** — `RESEND_API_KEY` ·
  `ALERT_EMAIL_TO` · `ALERT_EMAIL_FROM`. 없으면 Vercel 함수 로그에만 남는다
- 중복 억제는 인스턴스 메모리 기준 30분이다. 서버리스라 인스턴스가 여러 개면
  같은 오류로 여러 통이 올 수 있다. 실제로 시끄러우면 DB 기반으로 바꾼다
- 지식재산권은 옴니스 안에 상세 화면이 없어 외부 플랫폼 루트로 보낸다.
  건별 딥링크 형식이 정해지면 `IP_PLATFORM_URL` 부분을 고친다

## 같은 함정을 다시 밟지 않으려면

**서버 enum 을 화면에서 다시 타이핑하지 않는다.** 타입을 가져다 쓰고,
switch 에는 `satisfies never` 를 둔다. 이 조합이 아니면 enum 이 늘어난 날
어딘가에서 조용히 `undefined` 가 새 나간다.
