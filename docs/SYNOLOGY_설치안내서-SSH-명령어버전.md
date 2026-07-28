# Omnis 설치 안내서 — SSH·명령어 버전 (Container Manager GUI 미사용)

> Container Manager의 **화면(GUI)을 쓰지 않고**, SSH로 접속해 **명령어 한 줄**로 설치하는 버전입니다.
> 이미지 파일이 함께 들어 있어 **인터넷 없이도** 설치됩니다.

---

## ⚠️ 먼저 읽어주세요 — 이 버전을 언제 쓰나

이 방식은 **관리자(root/sudo) 권한과 SSH 접속**이 필요합니다.
Container Manager 화면으로 설치하는 것보다 **오히려 더 높은 권한**이 필요합니다.

| 이럴 때 이 버전 | 이럴 때는 GUI 버전 |
|----------------|-------------------|
| DSM **관리자 계정**으로 직접 설치 | 일반 사용자가 Container Manager 권한만 받아 설치 |
| 명령어(터미널)에 익숙 | 화면 클릭으로만 하고 싶음 |
| 스크립트로 반복 배포하고 싶음 | 한 번만 설치 |

> 대부분의 경우 **Container Manager(GUI) 버전이 더 쉽고 안전합니다.**
> 이 SSH 버전은 관리자가 명령어로 처리하길 원할 때만 쓰세요.

---

## 1. 한 장 요약

| 항목 | 내용 |
|------|------|
| **무엇** | Omnis — 채팅 한 줄로 업무가 등록되는 사내 업무관리 시스템 |
| **설치 방법** | SSH 접속 → `sudo sh install.sh` 한 줄 |
| **필요 권한** | DSM **관리자(admin)** 계정 + SSH 활성화 |
| **엔진** | Container Manager(구 Docker) **패키지**는 설치돼 있어야 함 (GUI는 안 씀) |
| **인터넷** | 불필요 (이미지 내장). 있으면 자동으로 활용 |
| **NAS 자원 사용** | 최대 CPU 2코어 · 메모리 2GB (설정 파일에 상한 고정) |
| **여는 포트** | 1개 (기본 3000번) |
| **되돌리기** | `sudo docker compose down` 한 줄 |

---

## 2. 공동 사용 NAS에 미치는 영향 (검토용)

이 NAS를 다른 회사와 함께 사용하고 있어, **기존 서비스에 영향이 없도록** 다음을 설정 파일에 못 박아 두었습니다.

| 우려 사항 | 조치 |
|-----------|------|
| NAS 자원을 독점하지 않나? | CPU 2코어 · 메모리 2GB **상한을 설정 파일에 명시** |
| 기존 서비스와 포트가 겹치지 않나? | 외부에 여는 포트는 **단 1개**. 겹치면 설정값 한 줄만 변경 |
| 다른 컨테이너에 접근하지 않나? | **전용 네트워크(`omnis_net`)** 안에서만 통신 |
| 데이터베이스가 노출되지 않나? | DB는 **포트를 열지 않음** |
| 문제가 생기면 되돌릴 수 있나? | `sudo docker compose down` 한 줄로 완전 제거 |

---

## 3. 사전 조건 (설치 전 확인)

- [ ] DSM **관리자(admin) 그룹** 계정
- [ ] **Container Manager 패키지 설치됨** (패키지센터 → Container Manager) — GUI는 안 쓰지만 docker 엔진이 필요합니다
- [ ] **SSH 활성화**: DSM → 제어판 → 터미널 및 SNMP → **SSH 서비스 활성화** 체크
- [ ] NAS에서 **3000번 포트**가 비어 있는지 (겹치면 정우창에게 알려주세요)

전달받은 **`omnis-설치패키지-SSH명령어`** 폴더 구성:

```
omnis-설치패키지-SSH명령어/
├── 00-설치안내서-SSH-명령어버전.md   ← 이 문서
├── install.sh                        ← 설치 스크립트
├── docker-compose.yml                ← 설정 파일
├── .env                              ← 비밀번호·키 채워짐 (숨김파일, IP 한 줄만 수정)
├── .env.example                      ← 값 설명용 참고 파일
└── images/                           ← 이미지 (omnis.tar.gz, pgvector.tar.gz)
```

---

## 4. 설치 절차

### 4-1. 파일 업로드 + `.env` IP 한 줄 수정

1. DSM → **File Station** → `homes/<내계정>/` 아래 **`omnis`** 폴더 생성
2. 폴더 안에 위 파일 **전부** 업로드 (`images` 폴더 포함)

> ⚠️ **`.env`는 점(`.`)으로 시작하는 숨김파일입니다.**
> - 압축 풀 때(내 PC): 숨김파일 보기를 켜야 보입니다. (Windows: 보기 → 숨긴 항목 / Mac: `⌘ + Shift + .`)
>   안 보여도 폴더 안엔 들어 있으니 폴더째 업로드하면 함께 올라갑니다.
> - File Station: 상단 **설정(⚙) → 숨김 파일 표시**
> - 업로드 후 `.env`가 있는지 반드시 확인 — **없으면 설치가 멈춥니다.**

3. **`.env`에서 IP 한 줄만 수정**
   - NAS 내부 IP 확인: DSM → 제어판 → 네트워크 → 네트워크 인터페이스 (예: `192.168.0.10`)
   - `.env` 우클릭 → 텍스트 편집기 → `★ 여기만 수정 ★` 줄에서 `<NAS내부IP>`를 실제 IP로 변경 후 저장
     ```
     바꾸기 전:  NEXTAUTH_URL=http://<NAS내부IP>:3000
     바꾼 후:    NEXTAUTH_URL=http://192.168.0.10:3000
     ```

### 4-2. SSH로 접속

Mac/Linux 터미널 또는 Windows PowerShell에서:

```
ssh <내계정>@<NAS내부IP>
```

(비밀번호는 DSM 로그인 비밀번호. 최초 접속 시 "계속하시겠습니까?"에 `yes`)

### 4-3. 설치 스크립트 실행 (핵심 — 명령어 한 줄)

업로드한 폴더로 이동한 뒤 스크립트를 실행합니다.

```
cd /volume1/homes/<내계정>/omnis
sudo sh install.sh
```

> - `/volume1`은 NAS마다 다를 수 있습니다. File Station에서 폴더 우클릭 → 속성 → **위치**로 실제 경로를 확인하세요.
> - `sudo`는 관리자 비밀번호를 한 번 물어봅니다.

스크립트가 자동으로:
1. 이미지를 불러오고 (오프라인) 또는 내려받고 (온라인)
2. 마이그레이션 → 기본 계정/데이터 생성 → 서버 시작

`설치 완료` 메시지가 뜨면 됩니다.

### 4-4. 동작 확인

```
sudo docker compose ps
```

`omnis`, `omnis-db` 두 컨테이너가 **Up** 상태면 성공입니다.

---

## 5. 접속 및 첫 로그인

1. 브라우저에서 **`http://<NAS내부IP>:3000`**
2. 아이디 `admin` / 비밀번호는 정우창이 별도로 전달한 관리자 비밀번호
   - 테스트 계정: `user001`~`user005` (비밀번호 `haddscience1234!`)

대시보드가 보이면 설치 완료입니다. (기본 계정·데이터는 자동 생성됩니다.)

---

## 6. 자주 쓰는 명령 / 문제 발생 시

폴더(`omnis`) 안에서 실행:

| 목적 | 명령 |
|------|------|
| 상태 확인 | `sudo docker compose ps` |
| 로그 보기 | `sudo docker compose logs -f omnis` |
| 재시작 | `sudo docker compose restart` |
| **완전히 끄기·제거** | `sudo docker compose down` |
| 데이터까지 삭제 | `sudo docker compose down -v` |

| 증상 | 확인 |
|------|------|
| `docker compose 없음` | Container Manager 패키지 미설치 → 패키지센터에서 설치 |
| `.env 없음`으로 중단 | 숨김파일 업로드 누락 → 4-1의 ⚠️ 참고 |
| `permission denied` | `sudo` 없이 실행함 → `sudo sh install.sh` |
| 포트 충돌 | `.env`의 `OMNIS_PORT` 변경 후 `sudo docker compose up -d` 다시 |

**막히면**: `sudo docker compose logs omnis` 결과를 복사해 정우창에게 전달.

---

## 7. (선택) 사외 접속 / 업데이트

- 사외 접속: DSM → 제어판 → 로그인 포털 → 고급 → 리버스 프록시 (소스 `https://omnis.<도메인>` → 목적지 `http://localhost:3000`)
- 업데이트: 새 `images/omnis.tar.gz`를 받아 다시 `sudo sh install.sh` (또는 온라인이면 `sudo docker compose pull && sudo docker compose up -d`)

---

## 8. 문의

- **담당**: 정우창
- 설치 중 막히면 **명령어 결과 화면**을 복사해 보내주시면 됩니다.
