---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-28-drop-ai-ecm-tailnet.md
last_verified: 2026-09-28
---

# tailnet `ai-ecm` 제거 — 검증 기록

계획서: [`mydocs/plans/2026-09-28-drop-ai-ecm-tailnet.md`](../plans/2026-09-28-drop-ai-ecm-tailnet.md)

## 변경 전

```
curl https://macbookpro.tail28eea6.ts.net/     000  (연결 실패)
tailscale status                                Tailscale is stopped.
omnis /sso/authorize?app=ai-ecm                 307  ← 등록만 살아 있었다
```

## 게이트 1 — `pnpm run verify`

```
0 errors, 43 warnings
```

기존 경고 그대로다.

## 게이트 2 — `tsx scripts/verify-sso.ts`

임시 ES256 키 · 로컬 DB(`localhost:5433`). 운영 서명 키는 꺼내지 않았다.

```
[7] VivoFrame
  ✓ vivoframe 등록
  ✓ ai-ecm-com 제거됨
  ✓ 옛 오리진(ecm.haddscience.com)은 CORS 거부
  ✓ ai-ecm(tailnet) 제거됨
  ✓ tailnet 오리진은 CORS 거부
  ✓ vivoframe 오리진은 CORS 허용
  ✓ 모르는 오리진은 거부
  ✓ vivoframe 세션을 hub 가 쓰면 거부
  ✓ 자기 앱에서는 통과
  ✓ 복귀 경로 기본값은 /
  ✓ 다른 오리진으로는 못 돌아감

통과: 55 passed, 0 failed
```

## 게이트 3 — 음성 대조, 그리고 **첫 번째 대조는 무효였다**

처음 돌린 음성 대조가 `55 passed, 0 failed` 로 **통과**했다. 물려야 할 자리에서
물리지 않았으니 시험이 헐거운 것처럼 보였지만, 원인은 다른 데 있었다 —
임시 항목을 끼워 넣는 치환의 앵커가 틀려 **항목이 애초에 들어가지 않았다.**
`str.replace` 는 못 찾으면 원본을 그대로 돌려주고 예외를 내지 않는다.

앵커를 고치고(`  {\n    // 제품명을 주소에 맞춘 배포(2026-09-22).` 앞) 삽입 여부를
`assert` 로 확인한 뒤 다시 돌렸다.

```
[7] VivoFrame
  ✓ vivoframe 등록
  ✓ ai-ecm-com 제거됨
  ✓ 옛 오리진(ecm.haddscience.com)은 CORS 거부
  ✗ ai-ecm(tailnet) 제거됨
  ✗ tailnet 오리진은 CORS 거부
  ✓ vivoframe 오리진은 CORS 허용
  …
실패: 53 passed, 2 failed
```

새 시험 두 건이 정확히 그 자리에서 물고 나머지는 그대로다.

> **통과하는 음성 대조는 시험이 헐겁다는 뜻이 아니라, 대조가 돌지 않았다는 뜻일 수 있다.**
> 대조를 돌릴 때는 **바꾼 것이 실제로 들어갔는지 먼저 확인한다.**

## 배포 후 운영 확인

<!-- 배포 뒤 채운다 -->
