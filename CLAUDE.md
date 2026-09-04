# CLAUDE.md

이 파일은 Claude Code 가 이 저장소의 권위 문서를 찾기 위한 **짧은 부트로더**다.
작업 절차와 규칙을 여기에 중복 기록하지 않는다.

## 로딩 순서

1. [`AGENTS.md`](AGENTS.md) — **작업 규약 정본.** 세 원칙 · 타스크 사이클 · 품질 게이트 ·
   Git 워크플로우 · 코드를 쓸 때의 지침이 전부 여기 있다
2. [`mydocs/README.md`](mydocs/README.md) — 문서 규약. frontmatter 네 칸의 뜻
3. [`mydocs/manual/ai-pairing.md`](mydocs/manual/ai-pairing.md) — 환경 · 검증 기준 · 금지 사항
4. 건드릴 영역의 canonical 문서 — 목록은 `AGENTS.md` 의 "문서 로딩 순서" 표
5. 오늘 작업 — `mydocs/orders/{yyyymmdd}.md`

**이 파일과 canonical 문서가 다르면 canonical 문서를 따른다.**

## 프로젝트

Omnis — HADD Science 의 채팅 기반 업무 관리 시스템. 채팅 한 줄로 업무를 지시하면
AI 가 업무 카드로 구조화한다. Next.js 16 (App Router) · React 19 · Prisma · PostgreSQL(Neon) ·
NextAuth v5 · Gemini · Vercel.

## 자주 찾는 것

| 무엇 | 어디 |
|---|---|
| UI · 구조 규칙 11~30 | [`mydocs/manual/ux-rules.md`](mydocs/manual/ux-rules.md) |
| 방법론 (Hyper-Waterfall) | [`mydocs/manual/hyper-waterfall.md`](mydocs/manual/hyper-waterfall.md) |
| 품질 게이트 | `npm run verify` — 자세한 건 `AGENTS.md` |
| 인증 불변식 | [`mydocs/tech/auth-architecture.md`](mydocs/tech/auth-architecture.md) |
| 이미 밟은 함정 | [`mydocs/troubleshootings/migration-traps.md`](mydocs/troubleshootings/migration-traps.md) |
