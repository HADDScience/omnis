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

머지 `d1d71ff` (#75). `vercel deploy --prod --yes` → `omnis-hadd-o13gnuq2h`, production, Ready.

```
GET /sso/authorize?app=ai-ecm&next=/          400  「등록되지 않은 앱입니다」  ← 이전 307
GET /sso/authorize?app=ai-ecm-com&next=/      400  (#69 에서 이미 제거)
GET /sso/authorize?app=vivoframe&next=/       307
GET /sso/authorize?app=hub-com&next=/         307  회귀 없음

OPTIONS /api/sso/redeem  Origin: macbookpro.tail28eea6.ts.net   204, ACAO 없음   ← 닫힘
OPTIONS /api/sso/redeem  Origin: vivoframe.haddscience.com      204 + ACAO vivoframe

https://vivoframe.haddscience.com/   200
https://hub.haddscience.com/         200
https://omnis.haddscience.com/       200
```

### 400 두 가지를 헷갈리지 않는다

회귀를 의심하게 만드는 자리가 있다. `next=/` 로 전수 확인하면 **멀쩡한 앱도 400 을 낸다.**

```
app=website-admin-com  next=/                    400  「돌아갈 경로가 올바르지 않습니다」
app=website-admin-com  next=/admin/              307  ← 정상
app=ai-alzheimer       next=/                    400  「돌아갈 경로가 올바르지 않습니다」
app=ai-alzheimer       next=/raman-g-peak-diff/  307  ← 정상
app=ai-ecm             next=/                    400  「등록되지 않은 앱입니다」  ← 진짜 제거
```

`basePath` 가 있는 앱에 basePath 밖 경로를 주면 오픈 리다이렉트 방지가 거부한다
(`safeReturnPath`). **상태 코드가 같으므로 화면 제목으로 가른다.**
basePath 가 빈 앱(`hub-com`·`vivoframe`)만 `next=/` 로 확인해도 된다.

redeem 쪽은 코드로 갈린다 — `401 invalid_grant` 면 등록이 있는 것, `400 unknown_app` 이면
없는 것이다([#71](https://github.com/HADDScience/omnis/pull/71)).

## 최종 — 이 도구의 등록

```
vivoframe   https://vivoframe.haddscience.com   basePath ""
```

`ai-ecm`(tailnet) · `ai-ecm-com`(ecm.haddscience.com) 둘 다 없다.
`scripts/verify-sso.ts` [7] 절이 둘의 부재와 두 오리진의 CORS 거부를 지킨다.
