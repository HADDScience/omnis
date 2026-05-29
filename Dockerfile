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

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
