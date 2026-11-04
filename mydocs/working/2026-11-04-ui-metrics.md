---
kind: snapshot
status: active
canonical: mydocs/plans/2026-11-04-ui-metrics.md
last_verified: 2026-11-04
---

# UI 변경 측정 — 검증 결과

| 명령 | 결과 |
|---|---|
| `pnpm run verify` | 오류 0, 경고 39(기존) |
| `pnpm run test:unit` | 전부 통과. 새 시험 20건(`lib/ui-metrics/*.test.ts`) |
| `pnpm run build` | 통과 |
| `node scripts/e2e-local.mjs tests/feature/ui-metrics.spec.ts` | 10 passed |
| 같은 방법으로 room-composer · shortcuts · chat-quality · command-palette · onboarding | 통과 |
| `prisma migrate diff --from-migrations … --to-schema-datamodel …` | No difference detected |
| PR #144 와 `git merge-tree` | 충돌 없음 |

`room-list-refresh.spec.ts` 의 「옴니스 방 — 서버가 글을 받으면…」 은 수정 전 main 에서도 같은 자리(「두 번째 글이 서버로 갔다」)로 실패한다.
같은 파일의 「내가 보낸 글」 은 첫 실행에서 한 번 실패하고 다시 돌렸을 때 통과했다.
