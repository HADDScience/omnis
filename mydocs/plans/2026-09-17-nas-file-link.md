---
kind: decision
status: active
canonical: mydocs/plans/2026-09-17-nas-file-link.md
last_verified: 2026-09-17
---

# 2026-09-17 — NAS 에 있는 파일은 올리지 않고 경로로 잇는다

## 왜

4MB 넘는 첨부는 Vercel 이 요청째 끊는다([`troubleshootings/large-file-upload.md`](../troubleshootings/large-file-upload.md)).
막힌 사례(족자 `.ai`·`.pdf`)는 **이미 공용 NAS 에 있는 파일**이었다. 이 파일을 브라우저로 다시 올릴 이유가 없다 —
옴니스는 이미 `/api/nas` 로 NAS 파일을 흘려보낸다.

작업지시자 결정(2026-09-17): 후보 A. NAS 에 없는 파일은 지금처럼 올리고, 커서 막히면 **NAS 에 올린 뒤 연결하라고 안내**한다.

## 흐름

```
+ 메뉴 ─┬─ 파일 업로드 ── 4MB 이하 → 지금처럼 올린다
        │               └ 4MB 초과 → 첨부하지 않고 안내 「NAS 에 올린 뒤 연결」 + [NAS 파일 연결] 버튼
        └─ NAS 파일 연결 ── 창: 경로 붙여넣기 · 폴더 탐색 → 파일 고르기 → 첨부 목록에 「NAS」 표시로 붙는다
보내기 ── 업로드 파일은 POST /api/files, NAS 파일은 POST /api/files/nas → 받은 id 를 메시지에 붙인다
```

## 결정

| 무엇 | 고른 것 | 이유 |
|---|---|---|
| 저장 | **스키마 변경 없음.** `File.path = /api/nas?path=…` | 화면은 이미 `path` 로 링크·미리보기를 그린다. NAS 파일인지는 `path` 접두사로 가른다 |
| 행을 만드는 때 | 보낼 때 | 업로드와 같은 순서. 고르고 지우면 남는 행이 없다 |
| 고를 때 확인 | `GET /api/nas?stat=1` — 있는지·크기만 | 경로를 붙여넣은 것이 파일이면 지금의 `/api/nas` 는 **파일을 통째로 흘린다**(194MB) |
| 경로 모양 | `Z:\HADD Science\…` · `/HADD Science/…` 에 더해 **맥 마운트 경로**(`/Volumes/HADD Science/…`, `~/NAS/HADD Science/…`) | 공유폴더 이름 앞은 떼어 낸다. `..` 차단과 공유폴더 제한은 그대로 |
| 서버에서 파일 읽기 | `openFileObject(file)` 한 곳 — NAS 링크면 `readFile(경로)`, 아니면 `getObject(키)` | 첨부 원문을 읽는 곳이 셋이다(`/raw` · MCP `read_file` · MCP 내려받기 링크) |
| 크기 | `File.size` 는 Int — 2GB 넘으면 상한으로 적는다 | 표시용이다 |

## 하지 않는 것

- NAS 파일이 옮겨지거나 지워지면 링크가 깨진다 — 사본을 두지 않는 선택의 대가
- 내려받기가 Vercel 함수를 지난다. 194MB 가 함수 수명 안에 끝나는지 **재지 않았다** — 배포 후 운영에서 잰다
- MCP `post_message` 에서 NAS 경로를 잇는 것
- NAS 에 없는 큰 파일을 올리는 길(조각 업로드 · NAS 수신기)

## 단계

1. 서버 — `lib/nas.ts`(경로 모양 · stat) · `lib/file-source.ts`(화면·서버 공용 판정) · `lib/file-object.ts` · `POST /api/files/nas` · `/api/nas?stat=1` · 읽는 곳 셋
2. 화면 — `NasBrowser` 고르기 모드 · `NasFilePicker` 창 · `MessageInput` · 두 입력창의 보내기
3. 검증 — `npm run verify` · 로컬 dev 에서 연결 → 보내기 → 말풍선 링크 열기 · 거부되어야 하는 경로(`..` · 다른 공유폴더 · 폴더 · 없는 파일)
