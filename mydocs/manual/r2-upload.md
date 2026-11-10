---
kind: guide
status: active
canonical: mydocs/manual/r2-upload.md
last_verified: 2026-11-10
---

# 큰 첨부 — R2(S3 호환) 직접 올리기 · 열람

4MB 를 넘는 첨부(최대 300MB)를 **브라우저가 R2 로 바로** 올리고, 열 때도 **R2 가 바로** 내보낸다.
Vercel 함수는 권한을 보고 서명 주소만 준다 — 파일 바이트는 함수를 지나지 않는다.
#158 경로(Blob 임시본 → Workflow → NAS) 옆에 붙는 두 번째 저장소이고, **꺼져 있으면 지금 동작 그대로다.**

- 근거 실험: `omnis-reports/infra-alternatives-261110/A-storage.md` §1 (로컬 MinIO, 2026-11-10)
- #158 설계: [`mydocs/plans/2026-11-04-large-upload.md`](../plans/2026-11-04-large-upload.md)
- 코드: `lib/r2/` · `app/api/uploads/r2/*` · `lib/large-upload/client.ts`(`runR2Upload`) · `app/api/files/[fileId]/raw/route.ts`

## 1. 흐름

```
화면                         옴니스 함수(Vercel)                    R2
 │ POST /api/uploads ───────▶ 로그인 · 크기(4MB 초과~300MB) · 한도
 │                            CreateMultipartUpload ───────────────▶
 │ ◀── session(서명된 표: 파일 id · 올린 사람 · 크기 · 참여자 전용 · 업로드 번호)
 │ POST /api/uploads/r2/sign ▶ 표 서명 · 본인 · 조각 번호 범위
 │ ◀── 조각 PUT 서명 주소(15분)
 │ PUT 조각(16MiB) ────────────────────────────────────────────────▶  바이트는 여기로만
 │ POST /api/uploads/complete ▶ ListParts 로 저장소의 조각을 직접 센다
 │                              빈틈 · 크기 확인 → CompleteMultipartUpload → HeadObject 크기 대조
 │                              File 행 + FileR2Object 행
 │ ◀── 첨부(파일 id)
 │ GET /api/files/{id}/raw ──▶ 로그인 · findVisibleFile(방 참여자 · privateToUserId)
 │ ◀── 302 서명 GET(30분)
 │ GET · Range ────────────────────────────────────────────────────▶  206 탐색
```

- **조각 PUT 만 서명 주소로 준다.** Create · ListParts · Complete · Abort 는 함수가 R2 에 직접 부른다(본문 없는 수 KB 제어 호출).
  - 합치기를 서버가 하므로 화면이 준 조각 목록을 믿지 않는다 — 저장소에 남은 조각을 직접 세어 빈틈 · 크기를 본다.
  - 화면이 조각 응답의 `ETag` 를 읽을 필요가 없다. CORS `ExposeHeaders: ETag` 를 빠뜨려 완료가 안 되는 함정이 없다.
- **올리는 동안 DB 에 쓰지 않는다**(#158 과 같다). 업로드 번호는 서명된 세션 표 안에 있어, 다른 업로드의 조각 주소를 받을 수 없다.
- **권한은 #158 과 같다.** 참여자 전용 방(옴니스 1:1 · 사람 1:1 · 단톡방)에 올리면 `File.privateToUserId` = 올린 사람,
  메시지에 붙은 뒤에는 그 방 참여자만 본다 — 판정은 `lib/file-access.ts` 한 곳. 못 보는 사람에게는 404 이고 서명 주소도 주지 않는다.
- **열람 형식은 우리가 정한다.** 서명 GET 에 `response-content-type` · `response-content-disposition` 을 넣어
  `lib/file-serving.ts` 의 표(#155) 값으로 답하게 한다. HTML 은 `application/octet-stream` + `attachment` 로 나간다.
  - `X-Content-Type-Options: nosniff` 는 R2 응답에 붙일 수 없다. 형식을 안전한 값으로 덮는 것으로 대신한다.
  - 썸네일(`?w=`)만 함수가 R2 에서 읽어 줄인다(20MB 이하 이미지).
- **MCP `read_file` 처럼 서버가 바이트를 써야 하는 곳**은 `lib/file-object.ts` 가 R2 에서 직접 읽는다(Range 그대로).

### 화면(`lib/large-upload/client.ts`)

| 상황 | 동작 |
|---|---|
| 동시 전송 | PC 3 · 폰(터치) 2 조각 |
| 조각 실패 | 지수 대기로 최대 6번. 화면 꺼짐 · 오프라인 · 복귀 때 끊은 연결은 세지 않는다. 실패한 조각은 새 서명 주소로 다시 보낸다 |
| 서명 발급 · 완료 요청 실패 | 이것도 다시 시도한다(5xx · 429 · 연결 오류). 서명 발급이 끊김에 멈추면 조각 재시도가 소용없다(MinIO 실험에서 확인) |
| 90초 진척 없음 | 그 조각을 끊고 다시 보낸다 |
| 새로 고침 · 탭 닫힘 | 기기(IndexedDB)에 세션 표가 남는다. 같은 파일을 다시 고르면 `/api/uploads/r2/state`(ListParts)로 **저장소에 남은 조각을 물어** 빠진 것만 보낸다 |
| 멈추기(✕) | 보내던 조각을 끊는다. 표가 남아 같은 파일로 이어 올린다 |
| 버리기 | 표를 지우고 `/api/uploads/r2/abort` 로 저장소의 조각도 지운다 |
| 업로드가 저장소에서 사라짐(7일 수명 · 버림) | 410 → 처음부터 다시 올린다 |
| 진행률 · 남은 시간 | 조각 PUT 의 `upload.onprogress`(XHR) |

## 2. 환경변수

| 이름 | 값 | 비고 |
|---|---|---|
| `LARGE_UPLOAD_ENABLED` | `1` | 큰 첨부 전체 스위치(#158). 꺼져 있으면 4MB 상한 그대로이고 `/api/uploads*` 는 404 |
| `LARGE_UPLOAD_BACKEND` | `r2` | **새 업로드를 R2 로.** 없거나 다른 값이면 #158(Blob) 경로 |
| `R2_ACCOUNT_ID` | Cloudflare 계정 id | 주소 `https://<id>.r2.cloudflarestorage.com` 를 만든다 |
| `R2_ENDPOINT` | (비움) | 로컬 시험(MinIO)에서만 준다. 주면 `R2_ACCOUNT_ID` 보다 우선 |
| `R2_BUCKET` | 예 `omnis-attachments` | |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | API 토큰의 S3 키 | **Sensitive** 로 넣는다. 화면 · 로그에 찍지 않는다 |
| `R2_STORAGE_CAP_MB` | 기본 `9000` | R2 저장 합계 상한. 무료 구간 10GB-월 아래에서 새 업로드를 멈춘다 |
| `LARGE_UPLOAD_MONTHLY_CAP_MB` | 기본 `20480` | 월 업로드 상한 — Blob 과 R2 를 합쳐 센다 |

`R2_*` 넷(또는 `R2_ENDPOINT` 포함 다섯) 중 하나라도 없으면 `LARGE_UPLOAD_BACKEND=r2` 여도 R2 를 쓰지 않는다.
`NEXT_PUBLIC_*` 는 늘지 않았다 — 화면은 세션 응답의 `backend` 로 길을 고른다.

## 3. R2 준비 — 사람이 할 일 (회사 결재 뒤)

결제수단 등록이 필요하다(공식 문서는 「R2 subscription · checkout」 만 적는다, `docs/cloudflare.md` §1). 계정은 회사 명의로 만든다.

1. **계정 · 구독:** Cloudflare 가입 → R2 → 구독(checkout). 무료 구간: 저장 10GB-월, Class A 100만 · Class B 1천만 건/월, egress 무료.
2. **버킷:** R2 → Create bucket. 이름 `omnis-attachments`, Location hint **Asia-Pacific**. **Public access 는 켜지 않는다**(r2.dev · 커스텀 도메인 둘 다 끔 — 서명 주소는 `<id>.r2.cloudflarestorage.com` 에서만 동작한다).
3. **API 토큰:** R2 → Manage R2 API Tokens → Create API token
   - 권한 **Object Read & Write**, 적용 버킷 **`omnis-attachments` 하나만**, TTL 은 회사 규칙에 맞춘다.
   - 만든 화면의 Access Key ID · Secret Access Key 를 바로 Vercel 환경변수에 넣는다(한 번만 보인다). 메신저 · 문서에 붙이지 않는다.
4. **CORS:** 버킷 → Settings → CORS Policy 에 아래 JSON. 반영까지 약 30초.

   ```json
   [
     {
       "AllowedOrigins": ["https://omnis.haddscience.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type", "range"],
       "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   - 프리뷰 배포에서 시험하려면 그 주소를 따로 더한다. 프리뷰는 운영 DB 를 쓰므로 프리뷰에서는 켜지 않는다(#158 과 같은 이유).
   - `ETag` 노출은 이 구현에 필요 없지만(합치기는 서버가 한다) 넣어 둔다 — 화면 쪽 합치기로 바꿀 때 빠뜨리기 쉽다.
5. **수명 규칙(미완료 멀티파트):** 버킷 → Settings → Object lifecycle rules
   - 기본 규칙 「Abort incomplete multipart uploads after **7 days**」 가 있다. **그대로 둔다** — 세션 표 수명(`SESSION_TTL_MS`, 7일)과 같다. 줄이면 그만큼 이어 올리기 기간이 준다.
   - 완료된 객체에는 만료(삭제) 규칙을 두지 않는다. R2 가 첨부의 정본이다.
   - S3 API 로 넣는다면 `PutBucketLifecycleConfiguration`(구형 `PutBucketLifecycle` 은 R2 에 없다):

   ```json
   { "Rules": [ { "ID": "abort-incomplete-mpu", "Status": "Enabled", "Filter": { "Prefix": "uploads/" },
                  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 } } ] }
   ```

## 4. 켜는 법

순서를 지킨다 — **마이그레이션 먼저, 배포 나중**(`20261110150000_file_r2_object`, 표 하나 추가).

1. 운영 DB 에 `prisma migrate deploy` (승인 뒤). 표가 없어도 읽기는 깨지지 않지만(`P2021` 은 「R2 파일 없음」 으로 본다) 완료가 실패한다.
2. 실 R2 PoC(§7)를 먼저 통과시킨다.
3. Vercel omnis-hadd → Production 환경변수: `R2_ACCOUNT_ID` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY`(Sensitive) · `LARGE_UPLOAD_BACKEND=r2`. `LARGE_UPLOAD_ENABLED=1` 도 있어야 한다.
4. **재배포.** 환경변수는 새 배포에만 붙는다.
5. 확인: 5MB 넘는 파일 하나를 1:1 방에 올리고
   - 개발자 도구 Network 에서 `…r2.cloudflarestorage.com/…partNumber=` PUT 이 보이는지
   - `/api/files/{id}/raw` 가 302 이고 영상이면 탐색이 206 인지
   - DB `FileR2Object` 에 행이 생겼는지(`FileTransfer` 행은 없다)

## 5. 끄는 법

- **새 업로드만 R2 에서 뺀다:** `LARGE_UPLOAD_BACKEND` 를 지우고(또는 `blob`) 재배포. 새 큰 첨부는 #158 경로로 간다.
  - 이미 R2 에 있는 파일은 **계속 R2 에서 열린다** — 읽기는 플래그가 아니라 `R2_*` 값과 `FileR2Object` 행만 본다.
  - 끄기 전에 연 세션(올리는 중이던 것)은 끝까지 올리거나 버릴 수 있다. 새로 고친 뒤 이어 올리기도 된다.
- **큰 첨부 전체를 끈다:** `LARGE_UPLOAD_ENABLED` 를 지우고 재배포 — 4MB 상한으로 돌아간다(#158 문서와 같다). 이미 올린 파일 열람은 그대로다.

## 6. 되돌리는 법

| 하고 싶은 것 | 방법 |
|---|---|
| 코드만 이전으로 | 이 PR 을 revert 해 배포. **R2 에 올린 파일이 있으면 그 파일들이 안 열린다**(옛 코드는 `FileR2Object` 를 모른다) — 아래 「R2 를 아예 그만두기」 를 먼저 한다 |
| R2 를 아예 그만두기 | ① `LARGE_UPLOAD_BACKEND` 를 지워 새 업로드를 막는다 ② R2 객체를 NAS(또는 다른 S3)로 복사 — 예: rclone `r2:omnis-attachments/uploads` → 대상 ③ 파일 행을 그 저장소를 가리키게 옮기는 일회성 스크립트(아직 없음, 그때 만든다) ④ 그 뒤에 `R2_*` 를 지운다 |
| 토큰이 샜다 | Cloudflare 에서 토큰을 Roll(또는 지우고 새로) → Vercel 값 교체 → 재배포. 이미 나간 서명 주소는 만료(조각 15분 · 열람 30분)까지 유효하다 |

**`R2_*` 값을 지우면 R2 에 있는 파일 열람이 500 이 된다.** `FileR2Object` 행이 남아 있는 한 값을 지우지 않는다.

## 7. 아직 확인하지 않은 것 (실 R2 PoC 에서 볼 것)

이 구현은 로컬 MinIO 로만 시험했다. R2 와 다를 수 있는 곳:

| 항목 | 보는 법 |
|---|---|
| 브라우저 → R2 서명 UploadPart PUT | 공식 문서 예시는 Worker 경유뿐이다. 같은 SigV4 쿼리 서명 PUT 이라 될 것으로 본다 — 5MB · 300MB 각각 한 번 |
| 서명 GET 의 `response-content-type` · `response-content-disposition` 덮어쓰기 | HTML 하나를 올려 응답 헤더가 `application/octet-stream` · `attachment` 인지. 안 되면 HTML 같은 위험 형식은 서명 GET 대신 함수 중계로 돌려야 한다 |
| 만료된 서명 | R2 는 CORS 헤더 없는 403 을 준다(화면에는 연결 오류로 보인다). 화면은 실패한 조각마다 새 주소를 받으므로 이어진다 — 서명 수명을 짧게 바꿔 확인 |
| 지연 · 속도 | 서울 → R2(APAC) 300MB 시간, 영상 탐색 시간 |
| iPhone 실기기 Safari · 홈 화면 PWA | 올리는 중 화면 끄기 · 다른 앱 갔다 오기 · 영상 탐색. 시뮬레이터 · 에뮬레이션으로는 대신할 수 없다 |
| CORS 실패 모양 | `AllowedOrigins` 에서 운영 주소를 빼 보고 화면 오류 문구 확인 |

## 8. NAS 백업 (이번 범위 밖 — 안만)

R2 를 정본으로 두면 NAS 에는 사본이 없다. 사본이 필요하면 **시놀로지 Cloud Sync** 의 「S3 호환」 연결로 R2 버킷을
**한 방향(R2 → NAS, 다운로드만)** 으로 받는 작업 하나를 두는 안이 있다(상무님 손 1회). 이번 PR 에는 코드 · 설정이 없다.
- 키는 위와 별도의 **읽기 전용 토큰**(Object Read only)으로 만든다.
- R2 → NAS 전송은 egress 무료이고 요청은 Class B 로 센다.

## 9. 시험

- 단위: `pnpm test:unit` — `lib/r2/rules.test.ts`(조각 빈틈 · 크기 · 서명 번호 · 설정 · 상한), `lib/large-upload/session.test.ts`(업로드 번호 서명)
- e2e: `tests/feature/r2-upload.spec.ts` — `R2_E2E=1` 일 때만. CI 에는 S3 호환 서버가 없어 건너뛴다. 로컬 절차:
  1. 로컬 S3 호환 서버. 오픈소스 MinIO 는 배포가 끊겼다(dl.min.io 410) — Homebrew 마지막 bottle 을 풀어 쓰거나 다른 S3 호환 서버를 쓴다.
     `minio server <데이터 폴더> --address 127.0.0.1:9200` (계정은 `MINIO_ROOT_USER` · `MINIO_ROOT_PASSWORD`, 매번 새로 만든 임시 값)
  2. 버킷 하나를 만든다(`CreateBucket`). MinIO 는 버킷 CORS 가 없고(501) 기본으로 요청 Origin 을 허용한다.
  3. 별도 DB(예 `omnis_r2_e2e`)에 `prisma migrate deploy` → `tsx prisma/demo-seed.ts` → `tsx scripts/ensure-e2e-accounts.ts`.
     **데모 시드는 표를 전부 비운다** — 여럿이 쓰는 로컬 DB 에 돌리지 않는다.
  4. **데모가 아닌 빌드로** 띄운다(`NEXT_PUBLIC_IS_DEMO` 를 비운다) — 데모 빌드는 입력창의 첨부 자체를 막는다.
     위 DB · 임의 `AUTH_SECRET` · `GEMINI_API_KEY=ci-placeholder` · `E2E_PASSWORD=demo1234` 와
     `LARGE_UPLOAD_ENABLED=1 LARGE_UPLOAD_BACKEND=r2 R2_ENDPOINT=http://127.0.0.1:9200 R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_E2E=1` 로
     `pnpm run build` → `next start -p 3105` (`.env.production.local` 이 없는 워크트리에서만 — 있으면 운영 DB 에 붙는다)
  5. playwright 에도 같은 env 를 준다(시험이 DB · 저장소를 직접 대조한다)
  6. `BASE_URL=http://localhost:3105 playwright test tests/feature/r2-upload.spec.ts --project=feature --project=mobile`
