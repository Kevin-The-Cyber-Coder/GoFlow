# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared ./packages/shared

RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Development image: Vite dev server bound to 0.0.0.0 so the port is reachable
# from the host. Source is bind-mounted by Compose.
# ---------------------------------------------------------------------------
FROM deps AS development
ENV NODE_ENV=development
COPY apps/web ./apps/web
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "@freelanceflow/web", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# Build image: static assets for the production server.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY apps/web ./apps/web
RUN npm run build -w @freelanceflow/web

# ---------------------------------------------------------------------------
# Production image: nginx serves the static bundle and proxies /api to the API
# container, so the browser only ever talks to one origin.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS production
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
