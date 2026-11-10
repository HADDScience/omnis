---
kind: snapshot
status: active
canonical: lib/brand.ts
last_verified: 2026-11-06
---

# 새 로고(v2)를 env 하나로 갈아 끼운다

- 스위치: 빌드 env `NEXT_PUBLIC_BRAND=v2`. 비어 있으면 지금 로고(v1). 빌드할 때 박히므로 넣거나 빼고 **재배포**한다
- 고르는 곳: `lib/brand.ts`(경로 · 테마 색 · 로딩 표시), `lib/brand-static.mjs`(next.config 가 읽는 판 판정과 rewrite)
- v2 자산: `public/brand/v2/` — `bash scripts/brand/build-v2.sh` 가 원본 SVG(`~/work/omnis-reports/logo-motion/`)에서 다시 만든다
- 앱 라우터 파일 규칙 `app/icon.png` · `app/apple-icon.png` 는 env 를 못 읽어 `public/brand/v1/` 로 옮기고 `app/layout.tsx` 의 `metadata.icons` 로 낸다. 로그인 화면의 HADD 마크도 같은 까닭으로 `app/(auth)/icon.png` → `public/brand/hadd/icon.png`, `app/(auth)/layout.tsx` 의 metadata 로 낸다(파일 규칙이 루트 metadata.icons 를 덮지 못했다)
- 주소가 고정된 정적 로고(`/favicon.ico` · `/icon-192.png`(sw.js 알림) · `/icon-512.png` · `/icon-maskable-512.png` · `/omnis-logo.png`)는 v2 일 때만 `rewrites.beforeFiles` 가 `public/brand/v2/` 의 같은 이름으로 돌린다. v1 은 규칙이 없다
- v2 는 manifest 아이콘 · apple-touch-icon 주소가 바뀐다 — 설치한 앱이 새 아이콘을 알아챌 길을 둔다
- 로고 타일 바탕(`--brand-gradient`)은 `<html data-brand="v2">` 일 때 앱 아이콘과 같은 단색 `#044abf`
- 로딩 표시: 칸을 채우는 자리 7곳은 `BrandLoader` — v1 은 기존 `Spinner`, v2 는 `OmnisLoader`. 단추 안 돌림표는 그대로 `Spinner`
- 옴니스 방의 답 아바타(`omnis-room.tsx` 의 `OmnisAvatar`)는 로고가 아니라 아이콘이라 바꾸지 않았다. `apple-touch-startup-image`(iOS 스플래시)는 v1 에도 없다
- 시험: `lib/brand.test.ts`, `tests/feature/brand-logo.spec.ts`(서버와 같은 `NEXT_PUBLIC_BRAND` 로 돌린다. CI 는 v1)
