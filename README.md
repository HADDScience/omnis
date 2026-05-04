# Omnis — 채팅 한 줄로 굴러가는 사내 업무 OS

> **카톡 보내듯 한 줄 적으면 AI가 업무로 만들어 등록한다.**
> HADD Science의 사내 운영 프로토타입. Notion + Slack + 지식베이스를 한 화면에 통합한 채팅 우선 ERP.

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 왜 만들었나

HADD Science는 오가노이드 3차원 세포배양 플랫폼을 개발하는 창업 초기 R&D 중소기업입니다.
구성원 한 명이 실험·규제 대응·과제 신청서·상표권 관리·문서화를 **end-to-end**로 수행하다 보니, 업무 등록과 보고에 들어가는 사무 오버헤드가 실험 시간을 잠식했습니다.

![두 가지 주통증 — 적용 18일 만에 해소](docs/screenshots/06-why-pain-resolved.png)

> **두 가지 주통증을 18일 만에 해소** — Before 2026.02.25–03.26 (사내 카톡 1,342건) · After 2026.04.13–04.30 (운영 18일 평균)
>
> - **업무 1건당 문서화 시간**: 35분 → **5분** (−85.7%)
> - **의사결정권자 인지 지연**: 평균 2일 → **5분 미만** (−99%)

그래서 **"카톡 한 줄 = 업무 카드 1건"** 가설을 세우고 프로토타입을 만들었습니다.

- **관리자 입력시간 ≈ 5초** (한 줄 전송)
- **담당자 입력시간 ≈ 0초** (자동 할당 + 알림)
- **사무 오버헤드 → AI에게 위임**

---

## 한 눈에 보기

### 1. 워크스페이스 캔버스 — 프로젝트별 업무를 React Flow 노드로

![워크스페이스 캔버스](docs/screenshots/01-workspace-canvas.png)

여러 프로젝트의 업무를 한 화면에서 조망. 노드 드래그·줌·팬·미니맵 지원. 우측 상단 필터 칩으로 제품 라인별로 좁혀 보기.

### 2. HADD DB (Omnis 지식 허브) — 회사의 모든 정보를 한 번의 검색으로

![Omnis 지식 허브](docs/screenshots/02-omnis-knowledge-hub.png)

회사 개요·인력 현황·지식재산권 등 반복 질문을 받던 정보를 카드로 적재. 매주 갱신, ⌘K로 즉시 검색. 카드 편집은 별도 git 저장소(`data/omnis/`)로 버전 관리되며 롤백 가능.

### 3. 내 업무 (Kanban) — 상태별 업무 보드

![내 업무 칸반](docs/screenshots/03-my-tasks-kanban.png)

할 일 / 진행 중 / 보류 / 지연 4단 상태. 드래그로 상태 전환. D-day 표시와 마감 임박 컬러 코드.

### 4. ⌘K 명령 팔레트 — 어디서나 한 번에

![Command Palette](docs/screenshots/04-command-palette.png)

업무·사람·HADD 카드·AI 명령어를 한 입력창으로. 새 업무 생성, 카드 만들기, 사람·업무 이동을 키보드만으로.

### 5. 채팅 도크 — Gemini가 한 줄을 업무로 변환

![채팅 도크 + 업무 자동 등록](docs/screenshots/05-chat-dock-task.png)

화면 하단에 항상 떠 있는 채팅 도크. 메시지 선택 → "업무 지시" → Gemini가 의도 분석 → 구조화된 업무 카드(제목·담당자·체크리스트·기대결과) 자동 생성. 등록 완료 시 시스템 메시지로 알림.

---

## 핵심 흐름

![채팅 한 줄 → 업무 카드 시퀀스](docs/screenshots/00-core-flow.png)

> 다이어그램 소스: [`docs/mermaid/core-flow.mmd`](docs/mermaid/core-flow.mmd)

`#업무명`을 멘션하면 Gemini `rebuildTask`가 전체 대화 맥락에서 업무 카드를 재구성합니다 (체크리스트·배경·기대결과 갱신, 전부 완료 시 자동 DONE).

---

## 기술 스택

| 계층 | 사용 기술 |
|------|----------|
| Framework | Next.js 16.1 (App Router · RSC · Turbopack) |
| Language | TypeScript 5.9, React 19 |
| Styling | Tailwind CSS 4.2, shadcn/ui v4 (`base-vega`) |
| Icons | hugeicons |
| Database | PostgreSQL 16 + Prisma ORM 6 |
| Auth | NextAuth v5 (Credentials) |
| AI | Google Gemini 2.5 Flash |
| Visualization | @xyflow/react (React Flow), recharts |
| E2E | Playwright |

---

## 사전 설치

다음 항목이 필요합니다.

| 도구 | 버전 | 비고 |
|------|------|------|
| Node.js | 20 LTS 이상 | `node -v`로 확인 |
| npm | Node.js와 함께 설치됨 | `pnpm`/`yarn`도 가능하나 README는 npm 기준 |
| Docker Desktop | 최신 | PostgreSQL 컨테이너용 (로컬 PostgreSQL 사용 시 생략 가능) |
| Gemini API Key | 무료 | [Google AI Studio](https://aistudio.google.com/app/apikey)에서 발급 |
| OS | macOS / Linux / Windows (WSL2 권장) | — |

---

## 빠른 시작 (5분)

### 1. 클론

```bash
git clone https://github.com/HADDScience/omnis.git
cd omnis
```

### 2. 환경변수

```bash
cp .env.example .env
```

`.env`를 열어 다음 값을 채워 주세요.

```dotenv
DATABASE_URL="postgresql://omnis:omnis_dev_2026@localhost:5432/omnis"
NEXTAUTH_SECRET="$(openssl rand -base64 32 결과 붙여넣기)"
NEXTAUTH_URL="http://localhost:3000"
GEMINI_API_KEY="발급받은 키"
SEED_PASSWORD="원하는-개발용-비밀번호"
E2E_PASSWORD="원하는-개발용-비밀번호"
```

> **참고:** `DATABASE_URL`의 비밀번호는 `docker-compose.yml`의 `POSTGRES_PASSWORD`와 일치시켜야 합니다.

### 3. 의존성 설치 + DB 기동

```bash
npm install
npm run docker:up        # PostgreSQL 컨테이너 기동
npm run db:migrate       # Prisma 스키마 적용
npm run db:seed          # 사용자 5명 + 카테고리 + 제품 + 기본 프로젝트 시드
```

### 4. 개발 서버 시작

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속. 로그인 화면에서 시드된 사용자 이름과 `SEED_PASSWORD`로 로그인합니다.

| 이름 | 권한 |
|------|------|
| 김아리 / 노혜린 | 관리자 (ADMIN) |
| 정우창 / 주용석 / 박소정 | 팀원 (MEMBER) |

---

## 자주 쓰는 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 (Turbopack) |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 프로덕션 실행 |
| `npm run typecheck` | TypeScript 타입 체크 |
| `npm run lint` | ESLint |
| `npm run format` | Prettier 포매팅 |
| `npm run db:studio` | Prisma Studio (DB GUI) |
| `npm run db:seed` | 시드 데이터 재적용 |
| `npm run docker:up` / `down` | PostgreSQL 컨테이너 기동·정지 |

---

## 디렉토리 구조

```
omnis/
├── app/
│   ├── (auth)/login/                ← 로그인
│   ├── (main)/
│   │   ├── dashboard/               ← 대시보드 (워크스페이스 캔버스)
│   │   ├── tasks/[taskId]/          ← 업무 목록·상세
│   │   ├── reports/[reportId]/      ← 주간보고
│   │   ├── omnis/[cardId]/          ← Omnis 지식 카드
│   │   └── settings/                ← 설정
│   └── api/                         ← API Routes
├── components/
│   ├── chat/                        ← 채팅 도크, 메시지, 업무 지시 다이얼로그
│   ├── landing/                     ← 랜딩
│   ├── layout/                      ← 사이드바, 헤더, 알림
│   ├── omnis/                       ← Omnis 카드 에디터
│   └── ui/                          ← shadcn 컴포넌트 55개
├── lib/
│   ├── ai.ts                        ← Gemini API (structureTask / rebuildTask / weeklyReport)
│   ├── auth.ts                      ← NextAuth 설정
│   ├── db.ts                        ← Prisma singleton
│   └── omnis-git.ts                 ← Omnis 카드 git 버전관리
├── prisma/
│   ├── schema.prisma                ← 11개 모델
│   └── seed.ts                      ← 시드 스크립트
├── tests/                           ← Playwright E2E
├── docs/screenshots/                ← README 이미지
└── docker-compose.yml               ← PostgreSQL + Omnis
```

---

## 트러블슈팅

| 증상 | 해결 |
|------|------|
| `npm install` 실패 (peer deps) | Node 20 LTS 사용 중인지 확인. `npm install --legacy-peer-deps`로 우회 가능 |
| `db:migrate` 실패 | `docker ps`로 PostgreSQL 컨테이너가 healthy인지 확인. `npm run docker:down && npm run docker:up` 후 재시도 |
| 로그인 후 401 | `.env`의 `NEXTAUTH_SECRET`이 비었거나 너무 짧음. `openssl rand -base64 32`로 32바이트 이상 |
| 채팅 → 업무 자동 생성 안 됨 | `GEMINI_API_KEY`가 비었거나 만료. Google AI Studio에서 재발급 |
| `Module not found: '@dnd-kit/core'` | `npm install` 미실행. 의존성 설치 후 재시작 |

---

## 라이선스

[MIT](LICENSE) — 자유롭게 포크·수정·재배포 가능. 출처 표기만 부탁드립니다.

---

## 문의

- HADD Science · 정우창 · `woochang4862@gmail.com`
- 본 프로젝트는 **2026 GBSA 업무 적용 우수사례 공모전** 출품작의 사내 적용 산출물입니다.
