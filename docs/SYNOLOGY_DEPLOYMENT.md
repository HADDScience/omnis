# Omnis — Synology NAS 배포 가이드

Synology DS1621+의 Container Manager로 Omnis를 띄우는 절차. 관리자에게 Container Manager 사용 권한을 받은 일반 사용자(예: `woochang`)가 직접 따라할 수 있는 단계별 안내.

---

## 0. 사전 조건

다음 3가지가 완료된 상태에서 시작합니다.

- [ ] NAS 관리자가 **Container Manager 패키지 설치** 완료
- [ ] 내 계정(예: `woochang`)에 **Container Manager 사용 권한** 부여됨
- [ ] GitHub Actions가 한 번 이상 성공하여 GHCR에 이미지가 푸시됨
  - 확인: `https://github.com/HADDScience/omnis/pkgs/container/omnis`에 `latest` 태그 존재

---

## 1. GHCR 이미지 빌드 (최초 1회)

`.github/workflows/docker-publish.yml`이 main 브랜치 push 시 자동 실행됩니다. 최초 빌드 트리거 방법:

```bash
git add .
git commit -m "feat: enable Synology deployment via GHCR image"
git push origin main
```

5~7분 후 GHCR에 `ghcr.io/haddscience/omnis:latest` 이미지가 생성됩니다.

### NAS가 GHCR 이미지를 받아오게 하기

기본은 private이라 그대로는 NAS가 pull하지 못합니다. 두 가지 방법이 있습니다.

**권장 — private 유지 + Container Manager에 인증 등록**

1. https://github.com/settings/tokens 에서 Personal Access Token 발급
   - 권한은 **`read:packages`만** 체크
2. Container Manager → **레지스트리 → 설정 → 추가**
   - URL: `https://ghcr.io`
   - 사용자명: GitHub 아이디 / 비밀번호: 위 토큰
3. 이후 private 이미지도 정상 pull

**비권장 — public 전환**

Package settings → Danger Zone → Change visibility → Public.
인증이 필요 없어 간단하지만 **빌드된 사내 코드가 인터넷에 공개**됩니다.
사내 업무 데이터를 다루는 시스템이므로 가급적 위의 private 방식을 쓰세요.

---

## 2. NAS에 배포 폴더 만들기

1. DSM 웹(`https://hadd.synology.me:2521`) 로그인
2. **File Station** 열기
3. `homes/woochang/` 아래 `omnis` 폴더 생성
4. 이 폴더 안에 다음 두 파일을 업로드:
   - `docker-compose.synology.yml` (이 저장소의 같은 이름 파일)
   - `.env` (아래 3단계에서 값 채워 생성)

---

## 3. `.env` 파일 작성

같은 폴더에 `.env` 텍스트 파일을 만들고 다음 값을 채웁니다(`.env.synology.example` 참고).

```env
POSTGRES_PASSWORD=<openssl rand -base64 24 결과>
NEXTAUTH_SECRET=<openssl rand -base64 32 결과>
OMNIS_PORT=3000
NEXTAUTH_URL=http://<NAS_LAN_IP>:3000
GEMINI_API_KEY=<Google AI Studio에서 발급>
SEED_PASSWORD=hadd1234
```

`OMNIS_PORT`는 NAS에서 열 포트입니다. 다른 서비스와 겹치면 이 값과
`NEXTAUTH_URL`의 포트를 **함께** 바꿉니다. (공동 사용 NAS에서는 먼저 확인할 것)

**키 생성 명령** (Mac 터미널):
```bash
openssl rand -base64 24    # POSTGRES_PASSWORD용
openssl rand -base64 32    # NEXTAUTH_SECRET용
```

`NEXTAUTH_URL`은 일단 NAS 내부 IP로 두고, 추후 리버스 프록시 설정 후 도메인으로 변경합니다.

---

## 4. Container Manager에서 프로젝트 임포트

1. DSM에서 **Container Manager** 실행
2. 좌측 메뉴 **프로젝트** 클릭 → **생성**
3. 입력값:
   - **프로젝트 이름**: `omnis`
   - **경로**: 2단계에서 만든 `omnis` 폴더 선택
   - **소스**: "기존 docker-compose.yml 사용" 선택
   - 파일이 `docker-compose.synology.yml`로 인식되지 않으면 임시로 이름을 `docker-compose.yml`로 바꿔서 업로드
4. **다음** → 웹 포털 설정은 생략 → **완료**
5. 빌드 옵션에서 **"빌드 후 컨테이너 시작"** 체크 → 완료

자동으로 두 컨테이너가 생성됩니다:
- `omnis-db` (PostgreSQL 16 + pgvector)
- `omnis` (Next.js 앱)

---

## 5. 초기 시드 데이터 (자동 — 별도 작업 없음)

컨테이너가 시작될 때 `마이그레이션 → 시드 → 서버 기동` 순서로 자동 실행됩니다.
기본 계정 5명과 기초 데이터가 자동 생성되므로 **터미널에서 명령을 칠 필요가 없습니다.**

- 시드는 전부 `upsert`라 재시작할 때마다 실행돼도 기존 데이터를 덮어쓰지 않습니다.
- 시드가 실패해도 앱은 기동합니다. 로그에서 `[seed]` 줄로 확인할 수 있습니다.

> 과거 문서에는 이 단계에서 `node prisma/seed.ts`를 실행하라고 적혀 있었으나,
> 런타임 이미지에는 `tsx`가 없고 Node는 `.ts`를 직접 실행하지 못해 동작하지 않았습니다.
> 지금은 빌드 시 시드를 CommonJS(`prisma/seed.cjs`)로 변환해 두고 자동 실행합니다.

---

## 6. 동작 확인

1. NAS의 내부 IP 확인: 제어판 → 네트워크 → 네트워크 인터페이스 (예: `192.168.0.10`)
2. 브라우저로 `http://192.168.0.10:3000` 접속
3. 로그인:
   - ID: `정우창` (또는 `김아리` 등 시드 계정)
   - 비번: `hadd1234` (`.env`의 `SEED_PASSWORD`와 동일)

대시보드가 보이면 성공.

---

## 7. 외부 접속 설정 (관리자 협조 필요)

사내 LAN 밖에서 접속하려면 관리자에게 **리버스 프록시 1건** 추가를 요청합니다:

> "DSM 제어판 → 로그인 포털 → 고급 → 리버스 프록시 → 생성:
> - 소스: `https://omnis.hadd.synology.me:443`
> - 목적지: `http://localhost:3000`
> 한 건만 추가 부탁드립니다."

추가 후 `.env`의 `NEXTAUTH_URL`을 `https://omnis.hadd.synology.me`로 변경하고 컨테이너 재시작.

---

## 8. 업데이트 (이후 코드 변경 시)

1. 로컬에서 `git push origin main` → GitHub Actions가 새 이미지 자동 빌드/푸시
2. NAS Container Manager → 프로젝트 → `omnis` → **작업** → **다시 빌드**
   - 또는 컨테이너 → `omnis` → **작업** → **재설정** (최신 이미지 pull)

---

## 트러블슈팅

### `omnis` 컨테이너가 계속 재시작됨
- **터미널 → 로그** 탭 확인. 대부분 환경변수 누락 또는 DB 연결 실패.
- `omnis-db`가 먼저 healthy 상태인지 확인.

### `prisma migrate deploy` 에러
- DB 비밀번호 불일치 또는 `DATABASE_URL` 오타.
- `.env`의 `POSTGRES_PASSWORD`와 `DATABASE_URL` 안 비밀번호가 같은지 확인.

### "ECONNREFUSED" 에러
- `omnis` 컨테이너의 `DATABASE_URL`이 `localhost`로 되어 있지 않은지 확인.
- 반드시 `omnis-db:5432` (컨테이너 이름)이어야 함.

### GHCR pull 실패
- 이미지가 private 상태. 1단계 끝에서 public 전환했는지 확인.

### Container Manager에 권한이 없다고 뜸
- 관리자에게 사용 권한 재확인 요청.

---

## 보안 메모

- 외부에 노출하기 전 반드시 `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`를 강한 임의값으로 교체
- `SEED_PASSWORD`는 초기 1회만 사용. 시드 후 실 사용자에게 새 비밀번호로 변경 안내
- `.env` 파일은 절대 Git에 커밋하지 말 것 (`.gitignore`에 이미 등록됨)
