# Build dependencies once, compile TypeScript, and keep the final API image free
# of TypeScript tooling and source files.
FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# This short-lived target has migration tooling and psql. It is used only by
# docker-compose.prod.yml before application replicas are allowed to start.
FROM dependencies AS migrator
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
# Amazon's RDS root certificates. Without these, pg cannot verify the RDS
# server certificate and every connection fails with SELF_SIGNED_CERT_IN_CHAIN.
# NODE_EXTRA_CA_CERTS appends to the default trust store, it does not replace it.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

COPY . ./
CMD ["sh", "scripts/migrate-and-provision.sh"]

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  LOG_PRETTY=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
# Amazon's RDS root certificates. Without these, pg cannot verify the RDS
# server certificate and every connection fails with SELF_SIGNED_CERT_IN_CHAIN.
# NODE_EXTRA_CA_CERTS appends to the default trust store, it does not replace it.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
