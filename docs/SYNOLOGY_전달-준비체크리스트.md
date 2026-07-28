# Omnis 설치 패키지 — 전달 전 준비 체크리스트 (정우창용)

> 상무님께 전달할 `omnis-설치패키지`를 완성하는 절차.
> 상무님이 받는 문서는 [`SYNOLOGY_설치안내서.md`](./SYNOLOGY_설치안내서.md)입니다.

---

## 0. 먼저 정할 것 — A안 / B안

| | A안 (인터넷 가능) | B안 (인터넷 차단) |
|---|---|---|
| 조건 | NAS가 인터넷에서 이미지를 받아올 수 있음 | NAS가 외부 접속 불가 |
| 전달물 | 설정 파일 2개 (가벼움) | 설정 파일 2개 + **이미지 2개(약 1GB)** |
| 상무님 작업 | 프로젝트 생성만 | 이미지 불러오기 → 프로젝트 생성 |
| 이후 업데이트 | 재빌드 클릭 | 매번 파일 재전달 |

**모르면 A안으로 먼저 시도**하고, "이미지를 받아오지 못함" 오류가 나면 B안으로 전환하면 됩니다.
A안이 실패해도 NAS에 영향은 없습니다.

---

## 1. 공통 준비

### 1-1. `.env` 마무리 — **NAS 내부 IP 채우기**

패키지의 `.env`에 아래 항목이 자리표시자로 남아 있습니다.

```env
NEXTAUTH_URL=http://<NAS내부IP>:3000
```

- 상무님께 NAS 내부 IP를 여쭤보고 실제 값으로 교체 (예: `http://192.168.0.10:3000`)
- **모르면**: 이 값이 틀려도 첫 로그인은 대체로 됩니다. 설치 후 IP를 확인해 고쳐도 됩니다.
- 포트를 3000이 아닌 값으로 바꿨다면 `OMNIS_PORT`와 **이 URL의 포트를 함께** 변경

### 1-2. 다른 항목 확인

| 항목 | 상태 |
|------|------|
| `POSTGRES_PASSWORD` | ✅ 자동 생성됨 |
| `NEXTAUTH_SECRET` | ✅ 자동 생성됨 |
| `GEMINI_API_KEY` | ✅ 로컬 `.env`에서 복사됨 — 유효한 키인지 한 번 확인 |
| `SEED_PASSWORD` / `ADMIN_PASSWORD` | ⚠️ **이제 미사용** — 계정별 임시비번이 이미지에 내장됨(아래 표). .env에 남아 있어도 무해 |

### 1-2b. 시드되는 계정·임시 비밀번호 (구성원에게 배포)

이미지에 아래 7명이 자동 생성됩니다. 로그인 아이디 = **본인 이름**, 임시 비번 = `haddscience` + 전화 뒷 4자리 + `!`. **최초 로그인 후 각자 변경 안내.**

| 이름(로그인) | 직급 | 부서 | 임시 비밀번호 |
|---|---|---|---|
| 허채정 | 대표 | — | `haddscience0862!` |
| 김아리 | 팀장 | 연구개발팀 | `haddscience0310!` |
| 윤훈 | 상무 | 영업마케팅팀 | `haddscience0838!` |
| 노혜린 | 과장 | 제품개발팀 | `haddscience4305!` |
| 김경훈 | COO | — | `haddscience8418!` |
| 허찬 | 팀장 | 연구지원/재무팀 | `haddscience0855!` |
| 정우창 | 사원 | AI개발팀 | `haddscience4671!` |

### 1-3. 이미지가 GHCR에 올라가 있는지 확인

```bash
gh api /orgs/HADDScience/packages/container/omnis/versions --jq '.[0].metadata.container.tags' 2>/dev/null \
  || open https://github.com/HADDScience/omnis/pkgs/container/omnis
```

`latest` 태그가 없으면 먼저 `git push origin main`으로 GitHub Actions를 돌려 이미지를 만듭니다.

> **중요**: 이번 수정(첨부파일 권한·자동 시드)이 반영된 **새 이미지**여야 합니다.
> 반드시 이 변경을 push한 뒤 Actions 완료를 확인하고 전달하세요.

---

## 2. A안 — 인터넷 가능한 경우

### 2-1. GHCR 이미지 접근 설정 (둘 중 하나)

**권장: private 유지 + 인증**
기존 문서는 GHCR을 public으로 바꾸라고 안내했지만, 그러면 **사내 코드가 인터넷에 공개**됩니다.
대신 상무님께 아래를 함께 안내하세요.

> Container Manager → **레지스트리** → **설정** → **추가**
> - URL: `https://ghcr.io`
> - 사용자명: GitHub 아이디
> - 비밀번호: GitHub Personal Access Token (`read:packages` 권한만)

토큰은 https://github.com/settings/tokens 에서 발급하고, **`read:packages`만** 체크합니다.

**간편(비권장): public 전환**
급하면 public으로 바꿔 인증 없이 받게 할 수 있지만, 코드 공개를 감수해야 합니다.

### 2-2. 전달물

```
omnis-설치패키지/
├── 00-먼저-읽어주세요.md
├── docker-compose.yml
└── .env
```

---

## 3. B안 — 인터넷 차단인 경우

NAS가 `pgvector` 이미지도 받아오지 못하므로 **이미지 2개를 모두** 내보내야 합니다.
하나라도 빠지면 설치가 실패합니다.

```bash
# DS1621+는 x86_64이므로 반드시 linux/amd64로 받아야 한다 (Mac이 arm이어도 마찬가지)
docker pull --platform linux/amd64 ghcr.io/haddscience/omnis:latest
docker pull --platform linux/amd64 pgvector/pgvector:pg16

mkdir -p omnis-설치패키지/images
docker save ghcr.io/haddscience/omnis:latest | gzip > omnis-설치패키지/images/omnis.tar.gz
docker save pgvector/pgvector:pg16          | gzip > omnis-설치패키지/images/pgvector.tar.gz
```

내보낸 뒤 확인:

```bash
ls -lh omnis-설치패키지/images/   # 두 파일 모두 존재하는지 (합계 약 0.7~1.2GB)
```

### 전달물

```
omnis-설치패키지/
├── 00-먼저-읽어주세요.md
├── docker-compose.yml
├── .env
└── images/
    ├── omnis.tar.gz
    └── pgvector.tar.gz
```

---

## 4. 전달 방법

- `.env`에 **DB 비밀번호와 인증 키**가 들어 있습니다. 공개 대화방에 올리지 말 것
- 권장: 비밀번호 걸린 압축(zip) + 비밀번호는 별도 경로(전화/대면)로 전달
- 구성원 **임시 로그인 비밀번호**(1-2b 표)는 공개 대화방 대신 **개인별/구두**로 전달

---

## 5. 설치 후 (정우창)

- [ ] 각 구성원에게 본인 임시 비밀번호 전달 + **최초 로그인 후 변경** 안내 (7명 자동 시드됨)
- [ ] 첨부파일 업로드가 되는지 확인 (이번에 고친 부분)
- [ ] 컨테이너 재시작 후에도 첨부파일이 남아 있는지 확인 (볼륨 동작 확인)
- [ ] DB 백업 스케줄 설정 요청 (`pg_dump` + DSM 작업 스케줄러)
- [ ] 필요 시 외부 접속용 리버스 프록시 요청

---

## 6. 자주 나오는 실패와 대응

| 상무님이 겪는 증상 | 원인 | 대응 |
|---|---|---|
| "이미지를 가져올 수 없습니다" | NAS 인터넷 차단 또는 GHCR private | B안 전환 또는 레지스트리 인증 안내 |
| "포트가 이미 사용 중입니다" | 3000번 충돌 | `.env`의 `OMNIS_PORT`와 `NEXTAUTH_URL` 포트 변경 후 재전달 |
| `omnis` 컨테이너 재시작 반복 | DB 미준비 또는 환경변수 오타 | 로그 캡처 요청 → `.env` 값 확인 |
| 로그인 시 계정 없음 | 시드 실패 | 로그에서 `[seed]` 줄 확인 |
| 첨부파일이 사라짐 | 볼륨 미적용(구버전 compose) | 이번 `docker-compose.yml`이 맞는지 확인 |
