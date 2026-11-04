---
kind: decision
status: archived
canonical: lib/file-serving.ts
last_verified: 2026-11-04
---

# 파일 응답 헤더를 안전 목록으로 정한다

첨부의 Content-Type 은 올린 사람이 정한 값이다. 파일을 내보내는 경로가 각자 헤더를 적으면서 이 값을 그대로 돌려주는 곳이 있었다.

## 결정

- 파일을 내보내는 라우트는 전부 `lib/file-serving.ts` 의 `fileResponseHeaders` 를 쓴다. `lib/file-serving.test.ts` 가 빠진 라우트를 잡는다
- 저장된 형식은 표를 찾는 열쇠로만 쓰고, 응답에는 표의 값을 싣는다
- PNG · JPEG · GIF · WebP · PDF · 일반 영상 · 음성만 inline, 나머지와 형식 불명은 attachment + `application/octet-stream`. 전부 nosniff
- 저장된 형식이 비었거나 일반 바이너리면 이름의 확장자로 찾는다(같은 표). NAS 파일은 이름밖에 없다
- 채팅 미리보기도 같은 표로 가른다. 사이트 사진 업로드는 SVG 를 받지 않는다
- 기존 파일 데이터와 스키마는 바꾸지 않는다

## 하지 않은 것

- **inline 응답의 CSP sandbox.** 응답 형식을 표의 값으로 고정하고 nosniff 를 붙이면 inline 응답은 문서로 해석되지 않는다.
  sandbox 는 브라우저의 PDF 뷰어를 막을 수 있어 넣지 않았다
- **파일 내용 검사.** 내용과 형식이 달라도 고정된 형식으로만 해석되므로 문서로 열리지 않는다

## 시험

CI 는 데모 빌드라 파일 경로가 막혀 있다. `scripts/e2e-fake-nas.mjs` 를 띄우고 `E2E_FAKE_NAS_URL` 이 있을 때만 그 막음을 풀어
`tests/feature/file-headers.spec.ts` 가 실제 HTTP 로 본다. Vercel 배포본에서는 이 값으로 풀리지 않는다.
