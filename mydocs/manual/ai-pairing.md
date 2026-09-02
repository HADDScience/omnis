---
kind: guide
status: active
canonical: mydocs/README.md
last_verified: 2026-09-02
---

# AI 와 함께 이 저장소에서 일하는 법

세션이 바뀌어도 같은 판단이 나오게 하려고 둔 절차다.
사람이 읽어도 되고, AI 가 읽으면 더 좋다.

## 시작할 때 읽는 순서

1. `mydocs/README.md` — 문서 규약
2. 건드릴 영역의 `tech/` 문서 — 불변식이 거기 있다
3. 관련 `troubleshootings/` — 이미 밟은 함정을 다시 밟지 않는다

세 개를 건너뛰고 코드부터 읽으면, 코드에 드러나지 않는 결정(왜 RLS 를 걷었는지,
왜 plpgsql 을 그대로 뒀는지)을 모른 채 "개선"하게 된다.

## 환경 — 모르면 시간을 버리는 것들

| 사실 | 왜 중요한가 |
|---|---|
| `~/omnis-deploy` 가 배포 트리다 | Vercel 프로젝트 `omnis-hadd` 에 링크돼 있다 |
| `~/omnis-dev` 는 건드리지 않는다 | 다른 세션의 작업 공간 |
| Vercel git 자동배포는 꺼져 있다 | 배포는 `vercel deploy --prod --yes` 로 수동 |
| Hub 는 `main` 푸시 = 즉시 배포 | 전사 런처다. 브랜치에서 작업하고 확인 후 머지 |
| `prisma generate` 는 `DATABASE_URL` 을 요구한다 | 빌드 시 더미라도 필요 |
| 마이그레이션은 `POSTGRES_URL_NON_POOLING` 으로 | 풀러를 거치면 DDL 이 불안정하다 |
| NAS 경로에서는 `npm install` 이 안 된다 | macFUSE 가 symlink 미지원 |

### DB 를 건드리기 전에

`.env` 와 `.env.production.local` 이 **서로 다른 DB** 를 가리킨다. 로컬과 Neon 을
바꿔 잡으면 프로덕션을 건드리거나, 로컬 개발 DB 를 날린다
(실제로 한 번 났다 — [migration-traps.md](../troubleshootings/migration-traps.md)).

명령마다 대상을 먼저 찍고, 아니면 멈춘다.

```bash
echo "대상: $(echo "$URL" | sed 's|.*@||;s|/.*||')"
case "$URL" in *neon.tech*) : ;; *) echo "중단"; exit 1;; esac
```

## 검증 기대치

말로 "됐다"가 아니라 **재현 가능한 결과**로 확인한다. 이 저장소의 기준선:

| 무엇을 고쳤나 | 무엇을 돌리나 |
|---|---|
| SSO · 인증 | `scripts/verify-sso.ts` (36가지) + `verify-sso-live.ts` |
| ip 스키마 · 함수 | `scripts/verify-ip-import.ts` (20가지, `rebuild_ledger` 동일성 포함) |
| 소셜 연결 규칙 | `lib/auth-identity.ts` 를 실 DB 에 대고 |
| 배포본 | 실제 HTTP 요청. 화면 확인만으로는 부족하다 |

새 규칙을 넣었으면 **거부되어야 하는 경우**를 함께 넣는다. 통과 사례만 있는
시험은 아무것도 지키지 못한다.

### 검증 로직은 콜백 밖에 둔다

`lib/auth-identity.ts` 와 `lib/sso.ts` 가 그렇게 갈라져 있다. OAuth 왕복이나 브라우저
없이 실 DB 에 대고 규칙을 돌릴 수 있어야, "만료된 토큰이 거부되는가" 같은 것을
재현할 수 있다. 새 로직도 같은 방식으로 짠다.

## 작업 중

- **파일을 고치기 전에 읽는다.** 예외 없다.
- **불변식을 깨는 변경이면 멈추고 말한다.** `tech/` 문서의 "불변식" 절이 그 목록이다.
- **되돌리기 어려운 일은 확인을 받는다.** 프로덕션 스키마 변경, `main` 푸시,
  Supabase 프로젝트 정리.
- **로컬에서 먼저 돌리고 프로덕션에 올린다.** 마이그레이션도 예외가 아니다.

## 끝낼 때

1. 고친 영역의 검증 스크립트를 돌리고 **결과를 붙인다**
2. 결정이 바뀌었으면 해당 `tech/` 문서를 고친다. 뒤집힌 문서는 지우지 말고
   `status: superseded`
3. 새로 밟은 함정은 `troubleshootings/migration-traps.md` 에 한 항목 추가
4. 커밋 메시지에는 **무엇을 했는지가 아니라 왜 그랬는지**를 적는다. 무엇을 했는지는
   diff 가 말한다

## 이 저장소에서 하지 말 것

- 네이버웍스·Supabase 를 인증 앵커로 되돌리기 (검토 후 기각)
- 소셜 이메일로 사람을 짐작해 계정 묶기
- Hub 를 검증 없이 `main` 에 푸시하기
- 배포 파일 건드리기 — `vercel.json`, `lib/storage.ts`, `app/api/files/*`
- `ip.apply_progress_entry` · `ip.rebuild_ledger` 를 TypeScript 로 옮겨 적기
