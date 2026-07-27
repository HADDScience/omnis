FROM node:20-alpine AS base

# 빌드용 전체 의존성 (devDependencies 포함 — next build/tsc/tailwind 필요)
# schema·config를 먼저 복사해야 postinstall(prisma generate)이 성공한다.
FROM base AS deps
WORKDIR /app
# prisma.config.ts가 로드 시 DATABASE_URL을 요구한다. generate는 DB에 연결하지 않으므로
# 빌드 단계에서는 더미값으로 충족시킨다 (runner에는 상속되지 않음).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# 런타임용 프로덕션 의존성만 (prisma CLI + 엔진 바이너리 포함 → migrate deploy용)
FROM base AS prod-deps
WORKDIR /app
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
# 시드 스크립트를 런타임 이미지에서도 실행할 수 있도록 CommonJS로 변환한다.
# 런타임에는 devDependency인 tsx가 없고 Node 20은 .ts를 직접 실행하지 못한다.
# esbuild는 tsx의 의존성으로 이 단계(devDependencies 포함)에 이미 존재한다.
RUN node_modules/.bin/esbuild prisma/seed.ts \
      --platform=node --format=cjs --outfile=prisma/seed.cjs

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
# standalone의 최소 node_modules를 프로덕션 의존성 전체로 덮어쓴다.
# (prisma CLI + 엔진을 포함해 시작 시 migrate deploy가 가능하도록)
COPY --from=prod-deps /app/node_modules ./node_modules

# 첨부파일 저장 폴더를 미리 만들고 소유권을 nextjs에게 넘긴다.
# 빈 폴더는 git이 추적하지 않아 CI 빌드 이미지에는 존재하지 않고,
# /app/public은 root 소유라 nextjs 사용자가 하위 폴더를 만들 수 없어 업로드가 실패한다.
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 마이그레이션 → 기본 계정/데이터 시드 → 서버 시작.
# 시드는 전부 upsert라 재시작마다 실행해도 기존 데이터를 덮어쓰지 않는다.
# 시드가 실패해도 앱은 기동시킨다(재시작 루프 방지). 로그로 원인을 확인할 수 있다.
CMD ["sh", "-c", "npx prisma migrate deploy && { node prisma/seed.cjs || echo '[seed] 실패 — 기본 계정 생성을 건너뜁니다'; } && node server.js"]
