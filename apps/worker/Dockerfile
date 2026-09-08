# Собирается из корня репо (context: .). Node 22 (dev-plan §1 писал Node 20, но supabase-js@2.9x требует нативный WebSocket = Node 22+).
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter worker... --prod=false

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
