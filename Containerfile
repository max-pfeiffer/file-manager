# Build stage: install all dependencies and build SPA + server
FROM docker.io/library/node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production dependencies only
FROM docker.io/library/node:24-alpine AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts skips the husky prepare hook (dev-only); no production
# dependency has install scripts.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Runtime stage: slim image, non-root, production artifacts only
FROM docker.io/library/node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    FILES_ROOT=/data
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/server/main.js"]
