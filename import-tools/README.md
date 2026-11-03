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

## 계속 받기 — `kakao-sync.py`

카톡 Mac 앱을 조작해 CSV 내보내기와 새 사진 받기를 하고 `kakao.ts` 를 부른다. 사람 손이 필요 없다.

```bash
python3 import-tools/kakao-sync.py --no-import           # 받기만 (처음 한 번은 기준점만 적는다)
python3 import-tools/kakao-sync.py --target prod --when-idle 10   # 10분 넘게 입력이 없을 때만 돌고 프로덕션에 이식
```

- 사진은 서랍 「사진/동영상」 에서 **지난 실행 이후 늘어난 만큼** 위에서부터 받는다. 보관함 항목에는 날짜가 없어서
  보관함 개수와 CSV 사진 자리표시 개수의 증가분을 최신순으로 짝짓는다. 둘이 어긋나면 받지 않고 기준점을 다시 잡는다.
  상태는 `KAKAO_DATA_DIR/sync/state.json`, 받은 파일은 `sync/<방>/media/`.
- 과거 사진(기준점 이전)은 받지 않는다. 보관함(715)과 CSV 자리표시(798)가 만료·삭제로 어긋나 순서로 짝지을 수 없다.
  과거분은 휴대폰 「대화 내보내기」 zip 으로 붙인다.
- 체크박스 클릭만 실제 마우스를 쓴다. 그 사이 마우스가 움직이면 멈춘다. 실행 주체에 「손쉬운 사용」 권한이 있어야 한다.

## 단계

| | 단계 | 무엇을 | 어떻게 |
|---|---|---|---|
| 1 | 수집 | CSV → 메시지 마스터에 합침 → 세션(1시간 공백 기준) | `steps/ingest.ts` |
| 2 | 분류 | 새 세션을 업무·정보공유·잡담·빈껍데기로 | `claude -p` **병렬** — 세션끼리 독립 |
| 3 | 메시지 | 전량 `ChatMessage` 로 (잡담도 — 맥락이 있어야 업무가 읽힌다) | `createMany skipDuplicates` |
| 4 | 구조화 | 업무·실행가능 세션 → 업무 카드 + 체크리스트 + 메시지 연결. 세션 하나에서 업무 여럿, 카드에는 Claude 가 고른 메시지만 | `claude -p` **순차** 40개씩 |
| 5 | 첨부 | `File: 이름` 은 이름으로, `Photo` 는 파일명의 시각으로 짝 맞춰 NAS 업로드 | `--media` 있을 때만 |
| 6 | 사진 설명 | 이번 CSV 의 전사방 사진을 글로 설명. 실패는 건너뛰고 보고, 다음 실행에서 이어 한다 | `codex exec` → 한도면 `claude -p` (구독) |
| 7 | 임베딩 | 색인이 없거나 바뀐 업무·메시지·사진을 옴니스 AI 색인에 | Gemini 100건씩 묶어 호출 |

AI 는 2·4·6단계에서 쓰고 구독(Claude · 사진은 Codex 먼저)이다. 앱의 Gemini 는 무료 티어(하루 500호출)라
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
| 구조화 | `Task.sourceId = kakao-task:<세션id>` 유니크. 한 세션의 두 번째 업무부터 `#1`, `#2` … 구조화한 뒤 세션에 메시지가 늘면 늘어난 부분만 `<세션id>@<시작 번호>` 로 다시 구조화한다 |
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

## 어느 방을 어떻게 옮기는가 — `KAKAO_DATA_DIR/import-config.json`

저장소가 공개라 방 이름 · 사람 이름은 코드에 두지 않는다. 형식은 `rooms-config.ts` 머리말. **이 파일이 없으면 옮길 방이 없다.**

| kind | 누가 읽는가 | 분류 · 카드 · 색인 · 사진 설명 |
|---|---|---|
| `COMPANY` | 전 구성원 | 함 |
| `GROUP` | `members` 만 | 기본으로 안 함. `structure: true` 면 카드를 만드는데, 카드 내용은 전원이 본다 |
| `DM` | `dm` 두 사람. `dmKey` 로 앱의 1:1 과 같은 방 | 안 함 |

방에 접근 통제가 있다(`lib/chat-rooms.ts` `roomAccess`). 참여자 전용 방의 첨부는 `privateToUserId` 를 달고 올라간다.

새 사람이 방에 들어오면 계정이 있으면 `speakers`, 없으면 `externals` 에 넣는다. 둘 다 없으면 그 사람 메시지는 **들어가지 않고 경고로 남는다**
(조용히 다른 사람에게 붙이지 않는다). `externals` 는 참여자 전용 방에만 들어간다. 상대 계정이 없는 1:1 은 `DM` 이 될 수 없으므로 내 계정만 참여자인 `GROUP` 으로 둔다.

## 품질 실측

```bash
npx tsx import-tools/eval.ts $KAKAO_DATA_DIR/eval/scenarios-260907.json --base http://localhost:3000
```

최근 대화를 근거로 옴니스 AI 에 묻고, 이식된 업무에 `#슬러그 추가 지시` 를 보내 재구성이
맥락을 잇는지 본다. 결과는 사람이 읽고 판단한다.

## 하지 않는 것

- 계정 없는 사람의 계정 만들기 — 이름 · 소속 · 직급만 `ExternalSpeaker` 에 둔다. 로그인 · 멘션 · 담당 · 알림 대상이 아니다
- 참여자 전용 방의 업무 카드 — 카드는 전원이 본다. 그런 방은 기본으로 분류 · 구조화를 건너뛴다
- 담당자 추측 — 지시 대상이 아니면 비워 둔다
- 없던 마감일 생성 — 지어내면 화면이 잘못된 "지연" 으로 덮인다
- 이식 중 알림·AI 자동 호출. 임베딩은 마지막 6단계에서만, 명시적으로.
- 짝이 애매한 첨부 붙이기 — 못 맞춘 것은 목록으로 보고하고 넘어간다
