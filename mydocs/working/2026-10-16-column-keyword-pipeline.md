---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-16-column-keyword-pipeline.md
last_verified: 2026-10-16
---

# 칼럼 키워드 파이프라인 — 단계별 실측

계획: [`plans/2026-10-16-column-keyword-pipeline.md`](../plans/2026-10-16-column-keyword-pipeline.md).
작업 트리 `~/work/omnis-column` · 브랜치 `feat/column-keywords`. 모든 실행은 **로컬 DB**(localhost:5433) 대상.

## 1단계 — 테이블

`prisma/migrations/20261017000000_column_keywords` — `ColumnKeywordRun` · `ColumnKeyword` · `ColumnDraft` · `ColumnPostEmbedding`.
`prisma migrate diff`(로컬 DB → 스키마)가 새 테이블 4개와 인덱스·외래키만 냈다. 기존 테이블 변경 없음.

```
$ prisma migrate deploy   # 로컬
All migrations have been successfully applied.
```

운영(Neon) 적용은 하지 않았다 — 실행 직전에 정우창 확인.

## 2단계 — 후보 수집

`lib/column/feeds.ts` · `lib/column/collect.ts` · `POST/GET /api/website/column/keywords` · `scripts/column-collect.ts`.

### 피드 (2026-10-16 확인)

| 피드 | 결과 |
|---|---|
| Google 뉴스 RSS 질의 10개 + `site:korea.kr 바이오` | 각 25건(질의당 상한) |
| 식약처 보도자료 RSS `brdId=ntc0021` | 25건 |
| korea.kr 부처별 RSS `dept_*.xml` | 404 — 쓰지 않는다. 정책브리핑은 Google 뉴스 `site:korea.kr` 로 대신 |
| 기업마당 지원사업 API | `BIZINFO_API_KEY` 없음 → 건너뜀. 키 발급 뒤 요청 파라미터 확인 필요 |

중복 제거·2주 이내 거르기 뒤 헤드라인 **267~268건**.

### 밟은 것

1. **Gemini 응답이 배열 중간에서 끊겼다**(3회 연속, `JSON.parse` 실패). 원문을 떠 보니 1,490자에서 잘려 있었다.
   추론 토큰이 `maxOutputTokens`(8192)를 먹은 것 — 번역 엔드포인트와 같은 증상. `lib/ai.ts` 에서
   `column*` 엔드포인트에 `thinkingBudget: 1024` 를 주고, `CallGeminiOptions.json`(responseMimeType)을 더했다.
2. **같은 날 두 번 돌리면 표현만 바꾼 키워드가 새로 쌓였다** — 2회차 30건 중 29건이 신규. `normalized` 글자 비교로는 못 잡는다.
   두 회차 키워드를 임베딩 유사도로 짝지은 결과:

   ```
   0.991 산업부·식약처 바이오 AI 전환 및 수출 전주기 협력 ↔ 산업부·식약처 바이오 AI 전환 전주기 협력
   0.973 바이오의약품 3분기 누계 수출 역대 최대 실적 ↔ K-바이오의약품 누적 수출액 역대 최고치 달성
   0.907 그린바이오와 레드바이오의 융합 생태계 구축 ↔ 그린·레드 바이오 융합 생태계 구축
   0.898 바이오 소재 및 공정 최적화를 위한 제조 AI(AX) 도입 ↔ 바이오 제조 자동화 및 AX 공정 최적화
   ─── 여기까지 같은 주제 / 아래는 다른 주제 ───
   0.884 국내 바이오 기업의 일본 재생의료 시장 진출 ↔ 세포·유전자치료제 CGT 글로벌 규제 완화
   0.879 동물대체시험법(NAMs) 법제화 및 국책과제 확대 ↔ AI 및 비임상 동물대체시험법 국책과제 확대
   ```

   → `SAME_TOPIC = 0.895`. 고친 뒤 테이블을 비우고 두 번 돌린 결과: 2회차 30건 중 **21건이 기존 행에 합쳐짐**, 신규 9건(다른 주제).
3. **기존 라이브러리 글과의 유사도가 0.78~0.90 에 몰렸다.** 설계안의 경고 기준 0.8 이면 30건 중 거의 전부가 ⚠.
   실제로 겹친 주제가 0.867(NK세포치료제) · 0.888(바이오의약품 수출) · 0.898(CGT 규제)이라 `SIMILAR_WARN = 0.86`.
   고친 뒤 경고 7/30. 점수의 「새로움」도 0.78~0.92 구간을 0~1 로 펴서 쓴다(그대로 쓰면 시의성만 순위를 정했다).

### 사용량 실측

`collectKeywords` 가 `durationMs`(벽시계)와 `cpuMs`(`process.cpuUsage`)를 남긴다.

```
1회차(라이브러리 103건 첫 임베딩 포함)
벽시계 27673ms · CPU 776ms · 단계 {"feeds":1212,"gemini":22549,"embed":3799,"libraryEmbeddedNow":103,"save":104}
이후(캐시 사용)
벽시계 23139ms · CPU 430ms · 단계 {"feeds":1027,"gemini":21084,"embed":911,"libraryEmbeddedNow":0,"save":108}
벽시계 22207ms · CPU 432ms · 단계 {"feeds":1146,"gemini":20003,"embed":944,"libraryEmbeddedNow":0,"save":106}
벽시계 23354ms · CPU 437ms · 단계 {"feeds":1983,"gemini":20321,"embed":923,"libraryEmbeddedNow":0,"save":83}
```

Gemini 토큰(GeminiUsage, `columnKeywords`): 1회 약 **1.3만 입력 + 0.4만 출력 = 1.7만 토큰**. 임베딩은 캐시 뒤 30건분.

| | 설계 추정 | 실측(로컬) | 판정 |
|---|---|---|---|
| 수집 1회 CPU | 3~8초 | 0.43~0.78초 | 추정 아래 |
| 수집 1회 벽시계 | 60~120초 | 22~28초 | 추정 아래 |
| 월 5회 Provisioned Memory(1 GB 가정) | 0.17 GB-시간 | 약 0.04 GB-시간 | 추정 아래 |

- 로컬 Node 프로세스의 값이다. Vercel 함수에서는 콜드 스타트·Prisma 연결이 더해진다 — 운영 배포 뒤 첫 실행의 `durationMs`·`cpuMs` 를 다시 본다.
- 3배 초과 중단 조건에 걸리지 않았다.

### 키워드 품질 (1회차 30건 중 앞 10건)

```
[기술] 그린·레드 바이오 융합 생태계 구축           근거 6 · 10/16
[규제] 보툴리눔 톡신 국가핵심기술 지정 해제 논의     근거 5 · 10/15
[연구] 우주 정거장 활용 제약 바이오 신약 연구        근거 4 · 10/14
[투자] 바이오 스타트업 IPO 전략 및 출구 다변화       근거 5 · 10/15
[산업] 강원권 바이오 및 청정산업 5000억 집중 투자    근거 4 · 10/14
[연구] 피부 및 뇌 특화 차세대 오가노이드 연구        근거 4 · 10/15
[산업] 제약바이오 해외 규제 대응을 위한 무역관 네트워크 근거 3 · 10/15
[연구] CAR-NK 및 NK세포치료제 글로벌 임상 진전      근거 4 · 10/16
[정책] 국가통합바이오빅데이터 구축사업 참여 확대     근거 3 · 10/15
[기술] iPSC 기반 범용 세포치료제 플랫폼 개발        근거 4 · 10/15
```

전체 목록과 근거는 정우창에게 보고한 표에 있다. 눈에 띈 약점: 요약 끝 문장에 모델의 평가("~가 부각된다")가 붙는다.
근거 하나가 주제와 느슨하게 맞는 경우가 있다(「글로벌 CRO 협력」 근거에 우주정거장 CRO 기사). 초안 단계에서 사람이 고르는 전제다.

## 남은 단계

3. 사이트 칼럼 탭 · 키워드 보드
4. 초안 생성 · 편집 · 검토 요청(대표님) · 승인 · 게시
5. 검증 · 운영 마이그레이션(확인 뒤) · 배포(확인 뒤)

## 2단계 보완 (정우창 요청, 2026-10-16)

- 키워드 요약 끝의 평가 문장 금지 — 프롬프트에 사실 2문장만, 「~가 부각된다·주목된다·기대된다」류로 끝내지 말 것을 명시.
  다시 수집한 결과 예: 「정부가 국가통합바이오빅데이터 구축사업의 참여 범위를 확대했다. 기존 건강검진 수검자 외에 일반 국민 누구나 사업에 참여할 수 있게 됐다.」
- 근거별 빼기 — `PATCH /api/website/column/keywords/:id {action:"removeSource", url}`. 근거가 하나 남으면 뺄 수 없다(키워드를 버린다).

## 3·4단계 — 관리 화면 칼럼 탭 · 초안 흐름

Omnis: `lib/column/article.ts`(근거 기사 본문 읽기) · `lib/column/draft.ts`(생성·상태 전이·게시) ·
`/api/website/column/keywords/:id` · `/api/website/column/drafts[/:id[/review|decide|publish]]`.
사이트: `/admin/column` (`components/admin/column-screen.tsx` · `column-draft-editor.tsx` · `lib/admin-column.ts`), 관리 화면 머리에 「칼럼」 탭.

- **근거 기사 본문.** Google 뉴스 RSS 링크는 원문으로 가는 중간 페이지라, 그 페이지의 서명값으로 Google 뉴스 내부 API(batchexecute)에
  원문 주소를 묻는다. 문서화되지 않은 경로라 막히면 그 근거는 제목만으로 쓰고, 초안 맨 위에 「본문을 읽지 못한 근거」 안내 상자를 넣는다
  (상자가 남아 있으면 검토 요청이 막힌다). 본문 추출은 `article-view-content-div` → `itemprop="articleBody"` → `<article>` 순.
- **근거 번호.** 초안 본문 문장 끝에 [1] 을 달고 참고 기사 목록 번호와 맞춘다. 게시할 때 본문의 번호만 지운다.
- **검토 요청 조건.** 제목 · 본문 · 사진 1장 이상 · 모든 사진에 출처(캡션 칸이 칼럼에서는 「출처 (필수)」) · 안내 상자 없음.
- **승인은 `COLUMN_REVIEWERS`(기본 "허채정")만.** 정우창 세션으로 `decide` 를 부르면 403 `not_reviewer`, 승인 전 `publish` 는 409 `not_approved`.
- **게시.** 초안을 만들 때 기사 id(`20261016-1111` 꼴)를 정해 두고, 편집 중 사진은 그 id 로 바로 올린다. 게시는 `savePost(category=library)` — 영문 번역 포함, 날짜는 게시일, 첫 사진이 썸네일.
- **알림.** 검토 요청 → 대표님께 `column_review`, 결정 → 만든 사람에게 `column_decision`. 누르면 `<사이트>/admin/column?draft=<id>`.

### 로컬 끝까지 확인 (2026-10-16)

Omnis 작업트리 dev(:3300, 로컬 DB) + 사이트 작업트리 dev(:3124). 로그인은 이 시험에서만 쓴 임시 서명키로 두 사람(정우창·허채정) 세션을 만들어 넣었다.
`:3000` 은 다른 프로젝트가 쓰고 있어, 브라우저 요청을 Playwright 가 중계하며 Origin 을 `website-admin-dev` 의 등록 오리진으로 바꿨다.

```
후보 수집(화면 버튼)     벽시계 24,889ms · CPU 453ms → 키워드 34건
근거 빼기               「KIMCo재단…」 근거 7 → 6
예약                    「예약 · 정우창」 표시
초안 만들기(화면 버튼)   19.3초(초안 생성 16,681ms · CPU 207ms) — 근거 3건 중 1건 본문 못 읽음 → 안내 상자
안내 상자 삭제 · 사진 추가(출처 「사진 = 하드사이언스」) · 저장 · 검토 요청 → 허채정에게 알림 1건
허채정 세션: 승인 → 라이브러리에 게시 5.4초
로컬 WebsitePost 20261016-1111: category=library · position 0 · date 2026.10.16 · 썸네일=첫 사진 · 영문 제목 생성 ·
                        본문 [n] 제거(남은 [n] 3개는 참고 기사 목록 번호) · 키워드 status=used
```

품질 게이트: Omnis `pnpm run verify` 0 errors(기존 경고 43) · `next build --webpack` 통과. 사이트 `pnpm typecheck` · `pnpm lint` · `next build --webpack` 통과.
(작업트리의 node_modules 가 심링크라 Turbopack 빌드는 거부된다 — 기본 빌드는 공용 트리에서 다시 돌린다.)

남은 것: 운영 DB 마이그레이션(확인 뒤) · push·배포(확인 뒤) · 기업마당 키.
