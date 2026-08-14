# Build from the monorepo root so npm workspaces resolve @networkpeer/contracts
# and the single root package-lock.json is used.
FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci

FROM dependencies AS build
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/build.mjs packages/contracts/build.mjs
COPY packages/contracts/src packages/contracts/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
RUN npm run build --workspace @networkpeer/contracts
RUN npm run build --workspace networkpeer-api

# This short-lived target has migration tooling and psql. It is used only by
# docker-compose.prod.yml before application replicas are allowed to start.
FROM dependencies AS migrator
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY . ./
CMD ["sh", "apps/api/scripts/migrate-and-provision.sh"]

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  LOG_PRETTY=false
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
