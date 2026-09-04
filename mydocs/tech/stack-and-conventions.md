---
kind: canonical
status: active
canonical: mydocs/tech/stack-and-conventions.md
last_verified: 2026-09-04
---

# 기술 스택과 코딩 관례

이 문서가 스택·라이브러리 관례의 정본이다.

여태 이 내용은 `.claude/CLAUDE.md` 에만 있었다. 그 파일은 `.gitignore` 에 들어 있어
**새로 클론한 사람에게 따라가지 않는다** — 그래서 저장소 안으로 옮겼다.
옮기면서 실측으로 다시 센 값이 있다 (아래 각 항목의 숫자).

## 스택

| 계층 | 기술 |
|---|---|
| Framework | Next.js 16.1.7 (App Router, RSC) |
| React | 19, TypeScript 5.9 |
| CSS | Tailwind CSS 4 |
| UI | shadcn/ui `base-vega` 스타일 — `components/ui/` 에 57개 |
| Icons | hugeicons (`@hugeicons/react`, `@hugeicons/core-free-icons`) |
| DB | PostgreSQL (Neon) + Prisma — 모델 25개 |
| AI | Gemini 2.5 Flash |
| Auth | NextAuth v5 — Credentials + Google · Kakao |
| Chart | recharts |
| Markdown | react-markdown + remark-gfm |
| DataTable | @tanstack/react-table |

## shadcn / base-vega 관례

base-vega 는 Radix 기반 shadcn 과 API 가 다르다. 습관대로 쓰면 조용히 깨진다.

```
1. asChild 금지 → render prop
   ✗ <PopoverTrigger asChild><Button /></PopoverTrigger>
   ✓ <PopoverTrigger render={<Button />}>내용</PopoverTrigger>

2. 아이콘은 hugeicons 만. lucide-react 금지
   import { IconName } from "@hugeicons/core-free-icons"
   <HugeiconsIcon icon={IconName} size={18} />

3. Accordion 은 type="multiple" 이 아니라 multiple prop
   <Accordion multiple defaultValue={[0,1,2]}>

4. 색상은 oklch CSS 변수 (bg-primary, text-muted-foreground …)
5. --radius: 0.625rem
6. 폰트: Inter (sans) + Geist Mono (mono)
7. 한국어 UI — lang="ko", 모든 텍스트 한국어
8. 다크모드 — 모든 컴포넌트에서 dark variant 지원
```

2026-09-04 실측: `app/` · `components/` 에서 `lucide-react` 0곳, `asChild` 0곳.
관례가 지켜지고 있다 — 깨지면 이 숫자가 올라간다.

## Gemini API 함정

```
1. 모델은 gemini-2.5-flash (preview 접미사 붙은 것 아님)
2. maxOutputTokens: 8192 필수
   thinking 모드가 토큰을 먹어서 2048 이면 출력이 잘린다
3. 응답에 json 코드블록(백틱 세 개 + json)이 섞여 온다 → 정규식으로 벗겨야 한다
4. JSON 키 이름이 프롬프트와 다르게 올 수 있다 → 정규화 필요
   (action vs last_message_intent, name vs description)
5. GEMINI_API_KEY 는 서버 사이드에서만 쓴다
6. 용도 3가지: structureTask · rebuildTask · generateWeeklyReport
```

`lib/ai.ts:14` 가 엔드포인트, `:37` 이 maxOutputTokens 다.

## 핵심 흐름

### 채팅 → 업무

```
관리자가 채팅에 메시지 작성
  → [업무 지시] → 메시지 선택 → 담당자 선택
  → structureTask → 업무 카드 생성
```

### #업무명 멘션 → 카드 재구성

```
멘션 감지 시
  1. 그 업무의 모든 메시지 + 파일명 + 현재 체크리스트 수집
  2. 전체를 Gemini 에 전달
  3. 전체 맥락에서 카드를 재생성 (증분 처리가 아니다)
  4. 기존 체크리스트 삭제 → 새로 생성
  → 체크리스트 전부 완료면 업무 자동 DONE
  → 시스템 메시지(🤖) 를 DB 에 저장하고 router.refresh
```

증분이 아니라 전체 재생성인 이유는 **일관성** 때문이다. 부분 갱신은 앞뒤가
어긋난 카드를 만든다.

### Polling

```
3초 간격 (WebSocket 미적용)
after 파라미터로 마지막 메시지 이후만 조회 (전체 교체 아님)
전송 중에는 pausePolling 으로 멈춘다 — 임시 메시지가 지워지는 것을 막는다
```

## 실행

```bash
npm run docker:up      # PostgreSQL
npm run db:migrate
npm run db:seed
npm run dev            # http://localhost:3000
npm run verify         # push 전
```
