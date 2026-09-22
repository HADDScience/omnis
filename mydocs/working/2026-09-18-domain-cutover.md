---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-18-domain-cutover.md
last_verified: 2026-09-21
---

# 2026-09-18 — Omnis 를 omnis.haddscience.com 루트로 (실측)

함정 정리: [domain-migration-traps](../troubleshootings/domain-migration-traps.md) ·
홈페이지 쪽은 hadd-website 저장소의 `mydocs/troubleshootings/domain-cutover-traps.md`

## 왜

haddscience.com 을 아임웹에서 Vercel 로 옮기면서(9/17), 그 아래 하위 경로로 얹혀 살던 두 앱을
각자 도메인으로 뗐다. Omnis 는 홈페이지 프로젝트가 `/omnis` 를 rewrite 로 받아 넘겨 주고 있었고,
그래서 `NEXT_PUBLIC_BASE_PATH=/omnis` 로 떠 있었다 — 홈페이지를 고칠 때마다 Omnis 가 같이 흔들렸다.

## 주소 지도 (지금)

| 주소 | 무엇 |
|---|---|
| `haddscience.com` · `www` | 홈페이지 (Vercel 프로젝트 `haddscience`) |
| **`omnis.haddscience.com`** | Omnis 운영 (`omnis-hadd`) — **루트**, basePath 없음 |
| **`hub.haddscience.com`** | 허브 (`hadd-hub`) — 루트 |
| `omnis-omega.vercel.app` | 데모 (`omnis-demo`) |
| `haddscience.com/omnis/*` | 홈페이지가 **308 로** 새 도메인에 넘긴다. `/omnis/api/*` 만 rewrite 유지(기사 사진) |

## 세 저장소가 서로를 부른다 — 배포 순서

1. **Omnis**: 호환 rewrite 를 **먼저** 배포 (PR #44). basePath 가 빈 값일 때만 도는 규칙이라 이 배포 자체는 동작을 바꾸지 않는다
2. **홈페이지 · 허브**: Omnis 주소를 새 도메인으로
3. **Omnis**: `NEXT_PUBLIC_BASE_PATH` 비우고 `NEXTAUTH_URL` · `PUBLIC_URL` 을 새 도메인으로, 재배포
4. 구글 · 카카오 콘솔에 새 리디렉션 주소 등록 — **3번보다 먼저** 되어 있어야 소셜 로그인이 안 끊긴다

## 실측 (전환 직후, `curl --resolve` 로 DNS 캐시 우회)

| 확인 | 결과 |
|---|---|
| `https://omnis.haddscience.com/` · `/login` · `/api/ip-mcp` | 200 |
| 옛 경로 `/omnis/login` · `/omnis/api/ip-mcp` | 200 (호환 rewrite) |
| `/.well-known/oauth-protected-resource/omnis/api/ip-mcp` | 200 |
| `haddscience.com/omnis` · `/omnis/tasks` | 308 → `omnis.haddscience.com/…` |
| SSO `authorize?app=hub-com` | 307 → `omnis.haddscience.com/login?callbackUrl=…` |
| 허브 오리진 CORS (`OPTIONS /api/sso/redeem`) | 204 + `access-control-allow-origin: https://hub.haddscience.com` |
| MCP 커넥터(옛 주소 등록 그대로) | 실제 호출로 동작 확인 |

전환 순간 **구성원 전원 재로그인**이 필요했다(쿠키는 오리진에 묶인다).

## SSO 등록 (`lib/sso.ts`)

앱 id 는 **오리진 하나에 묶인다.** 허브가 서브도메인 루트로 옮기면서 `hub-com` 을
origin `https://hub.haddscience.com` · basePath `""` 로 고쳤다(PR #42 · #43).
`hub`(github.io) 는 그 배포가 살아 있는 동안 남겨 둔다 — 등록을 지우면 그 주소로 들어온 사람의
로그인만 조용히 막힌다. `hub-vercel`(haddscience.vercel.app) 은 가리키는 화면이 없어졌다.

**Omnis 가 옮겨 가는 것은 SSO 등록과 무관하다** — 거기 적힌 오리진은 로그인하러 오는 쪽의 주소다.

## 회계 데이터 백필 (같은 날, 운영 반영)

계획 [2026-09-17-accounting-workflow](../plans/2026-09-17-accounting-workflow.md) ·
검증 [working](2026-09-17-accounting-workflow.md)

운영 DB 를 통째로 복제해 리허설한 뒤, 같은 스크립트를 운영에 돌렸다. **결과가 한 건도 다르지 않았다.**

| | 2024 | 2025 | 2026 |
|---|---|---|---|
| 매출 | 4장 · 3,600,000 | 11장 · 307,478,823 | 17장 · 125,312,508 |
| 매입 | 19장 · 28,918,394 | 83장 · 150,677,866 | 41장 · 56,845,237 |

(공급가 기준) 새로 저장 162장 · 엑셀 줄에 PDF 첨부 9장 · 세금계산서 175장 중 PDF 없는 것 2장
(울산대 수정 묶음의 당초 · 취소 — NAS 에 PDF 가 없다).

넣지 않은 것: 2025-09-23 가천대 당초 장(이미 수정 발행 — 넣으면 매출 두 번), 통장사본(계산서 아님),
2025-02-04 국일그래핀 이미지 PDF(이미 운영에 있음).

**파일명이 틀린 것 3건** — 원본 금액으로 넣었다: 에스에스엘 10,000,000(파일명 100만), CNK세무회계 330,000(30만),
대웅패키지 50,001(50,000).

### 민간 발행 승인번호 (PR #41)

NAS 매입 PDF 42장이 「승인번호를 못 읽음」 으로 빠졌는데, 이미지가 아니라 **모양이 달랐다** —
ASP 발행분은 뒤 두 칸에 영문이 섞이고(`20250304-50000035-a8166145`), 네이버클라우드는 하이픈 없이 24자다.
`approvalNoIn()` 으로 모양을 넓혀 31장이 읽혔다. 남은 10장은 좌표 파서가 칸을 못 잡는 양식이라
사람이 이미지로 읽어 값을 적고, **적은 값이 PDF 글자층에 실제로 있는지 기계로 대조**한 뒤 넣었다
(일부러 한 자리를 틀리게 하면 막히는 것까지 확인). 통장사본 1장은 계산서가 아니라 제외.

## 회사 메일 DNS

도메인을 옮기면서 메일 레코드도 새 존으로 옮겼다. 확인한 값과 남은 일은
[company-mail-dns](../tech/company-mail-dns.md) 에 있다.

## 남은 것

- 데모 프로젝트 빌드 명령이 아직 `npm run build` (9/21 pnpm 통일 이후 남은 것)
- DMARC 미등록 — 보고 받을 주소가 정해지면 넣는다
