# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Shared dependency layer.
#
# The root `prepare` script builds @goflow/shared during `npm ci`, so the
# shared package sources must be present at install time even though only its
# manifest is strictly required to resolve the workspace.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared ./packages/shared

RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Development image: runs the API with tsx in watch mode. Source is bind-mounted
# by Compose, so this target only needs configuration and dependencies.
# ---------------------------------------------------------------------------
FROM deps AS development
ENV NODE_ENV=development
COPY apps/api ./apps/api
EXPOSE 3000
CMD ["npm", "run", "dev", "-w", "@goflow/api"]

# ---------------------------------------------------------------------------
# Build image: compiles the shared package and the API to plain JavaScript.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY apps/api ./apps/api
RUN npm run build -w @goflow/shared \
  && npm run build -w @goflow/api

# ---------------------------------------------------------------------------
# Production image: runtime dependencies and compiled output only.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
