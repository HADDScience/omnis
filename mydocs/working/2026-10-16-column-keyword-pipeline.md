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
