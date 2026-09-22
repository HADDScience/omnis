---
kind: canonical
status: active
canonical: mydocs/tech/gemini-data-handling.md
last_verified: 2026-09-21
---

# Gemini 로 나가는 회사 데이터 — 무엇이 · 어떤 약관으로

Omnis 는 회사 데이터를 Google 의 Gemini API 로 보낸다. 이 문서는 **무엇이 나가는지**와
**그것이 어떤 약관 아래 처리되는지**를 적는다. 둘 중 하나만 알면 아무 판단도 할 수 없다.

## 나가는 것

`lib/ai.ts` 가 `generativelanguage.googleapis.com` 을 직접 호출한다. AI Studio 키 하나를
서버에서만 쓴다(`GEMINI_API_KEY`).

| 경로 | 전송 내용 | 시점 |
|---|---|---|
| `embedTexts` (`lib/ai.ts`) | `OMNIS_CARD`·`TASK`·`WEEKLY_REPORT`·`CHAT_MESSAGE`·`IP_CASE` 청크 **전문** | 채팅은 15자 넘으면 등록 즉시 (`lib/chat-post.ts`) |
| `taxInvoiceVision` (`lib/tax-invoice.ts`) | 세금계산서 **원본 파일을 base64 인라인** | 업로드 판독 시 |
| `structureTask` | 업무 지시 대화 원문 | 지시 입력 시 |
| `omnisAsk` | 질문 + 벡터검색으로 끌어온 회사 데이터 조각 | 질문 시 |
| `websiteTranslate` | 홈페이지 기사 본문 | 번역 실행 시 |

특히 민감한 것은 둘이다.

- **세금계산서** — 거래처·사업자번호·품목·금액이 원본 파일째 나간다.
- **IP_CASE** (`lib/embeddings.ts`) — 출원번호·출원인·지정상품·현재 단계에 더해
  **등록 가능성 추정치와 진행 이력(상대방·기한)** 까지 청크에 넣는다.

전송은 되돌릴 수 없다. 사용자가 채팅을 지우면 `deleteEmbeddingsSafe` 가 우리 벡터를
지우지만(`app/api/chat/messages/[messageId]/route.ts`), 이미 나간 요청은 회수할 수 없다.

## 학습에 쓰이지 않는 근거

근거는 네 문서다. 앞의 셋이 규칙을 정하고, 마지막이 우리가 어느 쪽에 해당하는지를 정한다.

1. **[Gemini API 추가 서비스 약관](https://ai.google.dev/gemini-api/terms?hl=ko)** (2026-03-23 발효,
   2026-04-28 갱신) — 「Google에서 귀하의 데이터를 사용하는 방식」 절.
   유료: *"Google은 귀하의 프롬프트 … 또는 대답을 Google 제품을 개선하는 데 사용하지 않으며"*.
   무료: 제출한 콘텐츠로 제품·머신러닝 기술을 개선·개발하고 **인적 검토자가 읽고 주석을 단다**.
   같은 절에 **"Cloud Billing 계정을 활성화하면 … 무료 할당량과 같이 무료로 제공되는 서비스를
   사용하는 경우에도 … '유료 서비스'로 간주됩니다"** 가 있다 — 무료 한도로 도는 임베딩 호출도 유료 취급이다.
2. **[가격 책정](https://ai.google.dev/gemini-api/docs/pricing?hl=ko)** — 모델마다 「Google 제품 개선에
   사용됨」 행이 있고 무료 등급 `예` · 유료 등급 `아니요`. 우리가 실제로 부르는 모델마다 따로 적혀 있어
   약관의 일반 문장보다 근거로 낫다.
3. **[Google 데이터 처리 부록](https://business.safety.google/processorterms/?hl=ko)** v10(2026-05-07)과
   그 [처리자 서비스 목록](https://business.safety.google/services/) — **Gemini API Paid Services** 가
   등재돼 있다. Google 이 처리자로서 지시에 따른 처리·ISO 27001 보안 조치·유출 통지·하위 처리자 공개
   의무를 진다. **무료 서비스는 목록에 없다** — 학습 사용 여부만이 아니라 법적 지위가 다르다.
4. **[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)** — Tier 1 = "Set up and link an
   active billing account". AI Studio 에서 프로젝트 `gen-lang-client-0493103520`(Omnis)이
   **Tier 1 · 선불** 로 표시된다(2026-09-21 확인).

### 그래도 남는 것

- **처리 국가를 지정할 수 없다.** 약관은 "Google 또는 대리인이 시설을 관리하는 국가에 일시적으로
  저장되거나 캐시될 수 있습니다" 로 되어 있다. `vercel.json` 의 `regions: ["icn1"]` 은 **앱 서버**가
  서울이라는 뜻이지 Gemini 호출이 국내에서 처리된다는 뜻이 아니다. 국내 처리가 필요하면
  Vertex AI 서울 리전(`asia-northeast3`)으로 옮겨야 한다.
- **로깅 기간에 숫자가 없다.** "a limited period of time" 이라고만 적혀 있다.
- **약관은 바뀐다.** 위 인용은 2026-04-28 갱신판 기준이다.
- 개인정보가 섞여 나가므로 **국외이전 고지**가 필요하다. 처리위탁 계약이 있다는 것과 고지 의무는 별개다.

## 학습 코퍼스 추출은 왜 낮은 위험인가

공개된 사례를 찾으면 한 가지가 반복된다 — **추출은 학습 코퍼스 진입을 전제로 한다.**

Copilot·CodeWhisperer 에서 유효한 비밀값 2,702건이 추출된 사례가 있지만, 그 키들은 공개 저장소와
포크에 수십 번 중복돼 학습에 포함된 값이었다. 암기 확률은 모델 용량·**중복 횟수**·시퀀스 길이에
로그선형으로 증가한다(Carlini et al.). 한 번 입력된 문자열이 수천억 토큰 코퍼스에서 암기 임계를
넘는 경우는 거의 없다. 삼성 2023년 건도 「입력됐다」 까지만 확인됐고 추출된 적은 없다.

그래서 실제 위험 순서는 흔히 짐작하는 것과 다르다:

| 순위 | 경로 | 상태 |
|---|---|---|
| 1 | 직원이 개인 AI 계정에 회사 자료를 붙여넣기 | 통제 수단 없음 — 규칙과 대체 경로 제공뿐 |
| 2 | 벡터 DB · 로컬 운영 스냅샷 | 아래 「로컬 스냅샷」 |
| 3 | 간접 프롬프트 인젝션 | 외부 PDF·카톡 이식이 컨텍스트로 들어간다. 밖으로 내보낼 통로가 좁을 뿐 없지는 않다(알림 메일·GitHub 이슈) |
| 4 | RAG 권한 우회 | `retrieveContext` (`lib/embeddings.ts`) SQL 에 **사용자 필터가 없다.** `ChatRoom` 에 멤버십이 없어 지금은 무해하지만, 비공개 방이나 관리자 전용 카드를 넣는 날 바로 권한 우회가 된다 |
| 5 | 학습 코퍼스 진입 후 추출 | 유료 티어라 해당 없음 |

## 로컬 스냅샷

`pnpm db:snapshot` 은 운영 DB 를 로컬로 통째로 복사한다. 목적은 분량과 모양을 보는 것이고
(업무 594 · 채팅 12,774), 그래서 **기본값이 마스킹**이다 — `scripts/mask-snapshot.sql` 이
채팅·업무·카드·색인·세금계산서·거래처·연락처를 같은 글자 수의 더미로 바꾸고 벡터를 비운다.
길이가 보존되므로 줄바꿈·말줄임·스크롤·성능은 원본과 같이 나온다.

```bash
pnpm db:snapshot            # 마스킹 (기본값)
pnpm db:snapshot --raw      # 원문 — 이슈 재현처럼 실제 값이 필요할 때만
```

마스킹한 뒤 벡터 검색을 쓰려면 `pnpm db:embed` 로 색인을 다시 만든다.

가리지 않는 것과 이유는 SQL 각 절의 주석에 적혀 있다 — 사람 이름(화면·E2E 가 이름으로 찾는다),
금액(거래처가 가려지면 식별되지 않고 회사 Context 화면 검증에 필요하다), `passwordHash`
(바꾸면 로컬 로그인이 막힌다).

`--raw` 로 받았다면 일이 끝난 뒤 `docker compose down -v` 로 지운다. 그러지 않으면 운영 원문이
노트북에 영구히 남는다.

## 모델이 닫히면

Google 은 모델을 닫는다. 2026-09-21 에 `gemini-2.5-flash` · `gemini-2.5-flash-lite` 가
「no longer available to new users」 로 404 를 내기 시작했고, 그날 새로 발급한 키는 신규로
취급돼 생성 호출이 전부 죽었다. `models.list` 는 여전히 그 모델을 목록에 넣어 준다 —
**목록으로는 알 수 없고 실제로 불러 봐야 드러난다.**

그래서 두 가지를 해 뒀다.

- **모델은 환경변수로 바꾼다.** `GEMINI_MODEL` · `GEMINI_LITE_MODEL` 이 비어 있으면 코드
  기본값을 쓴다. 다음에 같은 일이 나면 Vercel 환경변수 한 줄과 재배포로 끝난다 — PR·CI 를
  거치지 않는다. 다만 **무엇을 넣을지는 `bench/` 로 정한다.** 급할 때 임시로 바꾸고, 정식
  선택은 측정한 뒤에 한다.
- **404 · 401 · 403 은 메일과 GitHub 이슈로 올라간다** (`escalateGeminiFailure`). 재시도로
  풀리는 종류가 아닌데 지금까지는 함수 로그에만 남아, 모델이 닫힌 것을 하루 뒤에 알았다.
  같은 원인은 열린 이슈 하나에 댓글로 모인다.

채팅 스레드의 안내도 갈렸다. 되살아나는 실패는 「잠시 뒤 다시 한 번 적어 주세요」 그대로지만,
설정이 원인인 실패에는 「다시 적어도 해결되지 않습니다 — 관리자에게 알렸습니다」 로 나간다.

## 키

- 운영 키는 Vercel `omnis-hadd` production 에 sensitive 타입으로 있다. `vercel env pull` 은
  sensitive 변수를 `[SENSITIVE]` 로 돌려준다 — 그 문자열을 실제 키와 비교하면 안 된다.
- **omnis-demo(공개 데모)는 별도 키를 쓴다.** README 에 비밀번호가 공개돼 있어 운영과 같은 키를
  쓰면 데모 트래픽이 운영 한도(`GEMINI_DAILY_CALL_LIMIT` 500회)를 먹고, 데모 쪽에서 키가 새면
  운영을 죽이지 않고는 폐기할 수 없다.
- **로컬은 `.env` 가 아니라 셸의 export 를 쓴다.** `~/.zshrc` 에 `GEMINI_API_KEY` 가 export 돼
  있고, `dotenv` 는 이미 환경에 있는 값을 덮지 않는다. 그래서 `.env` 를 고쳐도 로컬 동작은
  바뀌지 않는다 — 2026-09-21 에 키를 바꾸고 "로컬과 운영을 통일했다" 고 적었지만 로컬 프로세스는
  옛 키를 계속 썼다. 확인은 파일이 아니라 프로세스에서 한다:
  `npx tsx -e 'console.log(process.env.GEMINI_API_KEY?.length)'`.
- **모델 가용성은 키마다 다르다.** 옛 키(39자 `AIza…`)는 `gemini-2.5-flash` 를 지금도 부르고,
  새로 발급한 키(53자 `AQ.…`)는 404 다. 「신규 사용자에게 닫혔다」 는 프로젝트가 아니라 **키**를
  기준으로 갈린다. 그래서 로컬에서 되는 것이 운영에서 안 될 수 있다 — 실제로 그랬다.
- 키를 바꾸면 **재배포해야** 적용된다. 실행 중인 배포는 자기 환경변수 스냅샷을 쓴다.
- 그 재배포를 **옛 배포에 걸면 코드가 그 시점으로 돌아간다.** `vercel redeploy` 는 그 배포의 소스를
  그대로 다시 굽고 환경변수만 새로 입힌다. 2026-09-21 에 이걸로 운영이 나흘 전 코드로 덮여 허브
  로그인이 막혔다 — 루트 경로는 200 이라 겉으로는 정상이었다.
  `working/2026-09-21-pnpm-and-stale-redeploy.md`. 키만 갈아끼울 때도 **현재 main 을 배포한다**.
