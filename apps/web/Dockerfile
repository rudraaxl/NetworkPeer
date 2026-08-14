# Web frontend Dockerfile for Railway. Builds the TanStack Start SSR app
# with the node-server Nitro preset and serves it on port 3000.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/components.json apps/web/components.json

RUN npm run build --workspace @networkpeer/contracts
RUN NITRO_PRESET=node-server npm run build --workspace networkpeer-web

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.output ./output
EXPOSE 3000
CMD ["node", "output/server/index.mjs"]
