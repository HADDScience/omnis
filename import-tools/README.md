# 카카오톡 이식 도구

`docs/카톡-이식-설계.md` 의 구현. CSV 를 주면 옴니스까지 한 번에 간다.

```bash
# 카톡 PC 앱 → 채팅방 → 대화 내보내기(CSV). 파일명은 건드리지 않는다 — 방 이름을 거기서 읽는다.
npm run kakao -- ~/Downloads/KakaoTalk_Chat_*.csv

npm run kakao -- <csv...> --dry              # 쓰지 않고 무엇을 할지만 본다
npm run kakao -- <csv...> --media ~/카톡첨부   # 채팅방 서랍에서 저장한 사진·파일도 붙인다
npm run kakao -- <csv...> --target prod      # 프로덕션(Neon). 먼저 로컬에서 보고 나서.
```

옵션: `--no-structure` (카드 안 만듦) · `--no-embed` (색인 안 함) · `--workers N` (분류 동시 수, 기본 4) ·
`--classify-model` (기본 sonnet) · `--structure-model` (기본 opus)

## 단계

| | 단계 | 무엇을 | 어떻게 |
|---|---|---|---|
| 1 | 수집 | CSV → 메시지 마스터에 합침 → 세션(1시간 공백 기준) | `steps/ingest.ts` |
| 2 | 분류 | 새 세션을 업무·정보공유·잡담·빈껍데기로 | `claude -p` **병렬** — 세션끼리 독립 |
| 3 | 메시지 | 전량 `ChatMessage` 로 (잡담도 — 맥락이 있어야 업무가 읽힌다) | `createMany skipDuplicates` |
| 4 | 구조화 | 업무·실행가능 세션 → 업무 카드 + 체크리스트 + 메시지 연결 | `claude -p` **순차** 40개씩 |
| 5 | 첨부 | `File: 이름` 은 이름으로, `Photo` 는 파일명의 시각으로 짝 맞춰 NAS 업로드 | `--media` 있을 때만 |
| 6 | 임베딩 | 새 업무·메시지를 옴니스 AI 색인에 | Gemini 100건씩 묶어 호출 |

AI 는 2·4단계에서만 쓰고 **Claude** 다. 앱의 Gemini 는 무료 티어(하루 500호출)라
실서비스 몫으로 남겨 둔다. 이 CLI 는 `claude` CLI 가 설치된 곳에서 돈다.

### 왜 4단계는 순차인가

N 라운드는 1..N-1 이 만든 프로젝트·업무를 맥락으로 받는다. 그래야 3월에 생긴
과제에 5월 업무가 붙는다. 병렬로 돌리면 같은 프로젝트가 이름만 다르게 흩어진다.

## 멱등

모든 단계가 "아직 안 된 것" 만 고른다. 같은 CSV 를 두 번 주면 두 번째는 0건이고,
중간에 끊겨도 다시 돌리면 이어진다.

| 단계 | 이미 했는지 아는 방법 |
|---|---|
| 메시지 | `ChatMessage.sourceId = kakao:<sha1(방|시각|작성자|본문)>` 유니크 |
| 분류 | `KAKAO_DATA_DIR/final.json` 에 세션 id 가 있는가 |
| 구조화 | `Task.sourceId = kakao-task:<세션id>` 유니크 |
| 첨부 | 그 메시지에 같은 이름의 `File` 이 있는가 |
| 임베딩 | `EmbeddingChunk` 에 있고 contentHash 가 같은가 |

본문이 멱등성 키에 들어가므로 CSV 파서는 처음 이식 때 쓴 파이썬 `csv` 모듈과
바이트 단위로 같아야 한다 — 옛 CSV 를 다시 읽어 9,136건·세션 615개가 전부 일치함을 확인했다(2026-09-07).

되돌리기:
```sql
DELETE FROM "Task"        WHERE "sourceId" LIKE 'kakao-task:%';
DELETE FROM "ChatMessage" WHERE "sourceId" LIKE 'kakao:%';
```

## 원본 데이터 — `KAKAO_DATA_DIR` (기본 `~/work/omnis-import`)

실제 사내 대화라 저장소에 넣지 않는다. 저장소는 **공개**다.

```
raw/messages.json        받은 모든 CSV 의 합집합 (마스터)
sessions.json            세션 (매번 다시 자른다)
final.json               분류 결과 누적
classify/in|out/         분류 프롬프트·응답 (감사용)
structure/in|out/        구조화 라운드 입력·응답 (감사용) — 번호는 이어진다
eval/                    품질 시나리오
```

## 처음 한 번만

```bash
npx tsx import-tools/create-past-members.ts    # 과거 구성원 계정 (isActive:false)
npx tsx import-tools/seed-projects-from-nas.ts # 프로젝트 = NAS 과제 폴더
```

새 사람이 방에 들어오면 `kakao-common.ts` 의 `SPEAKER_TO_USER` 에 카톡 표시명 → 계정 이름을
추가해야 한다. 없으면 그 사람 메시지는 **들어가지 않고 경고로 남는다** (조용히 다른 사람에게 붙이지 않는다).

## 품질 실측

```bash
npx tsx import-tools/eval.ts $KAKAO_DATA_DIR/eval/scenarios-260907.json --base http://localhost:3000
```

최근 대화를 근거로 옴니스 AI 에 묻고, 이식된 업무에 `#슬러그 추가 지시` 를 보내 재구성이
맥락을 잇는지 본다. 결과는 사람이 읽고 판단한다.

## 하지 않는 것

- 1:1 대화 이식 — ChatRoom 에 접근 통제가 없어 사적 대화가 전원에게 공개된다
- 담당자 추측 — 지시 대상이 아니면 비워 둔다
- 없던 마감일 생성 — 지어내면 화면이 잘못된 "지연" 으로 덮인다
- 이식 중 알림·AI 자동 호출. 임베딩은 마지막 6단계에서만, 명시적으로.
- 짝이 애매한 첨부 붙이기 — 못 맞춘 것은 목록으로 보고하고 넘어간다
