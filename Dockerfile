# Image Studio — one image for static, standalone and hosted runtime modes.
#
#   docker build -t image-studio .
#
# Platform mode (default; mounted by skillsmaster under /apps/image-studio/*):
#   static assets + /healthz + /runtime-config.json on port 8080, no volumes, no keys.
#   Runs as 101:101 and needs no writable path, so it works with a read-only root
#   filesystem (docker run --read-only).
# Standalone mode: see docker-compose.yml and config/standalone.json; all data lives
#   under the /data volume (/data/db for SQLite, /data/storage for files).

FROM node:22-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production \
    IMAGE_STUDIO_DEFAULT_MODE=platform \
    IMAGE_STUDIO_STATIC_DIR=/app/dist
WORKDIR /app
COPY --chown=root:root server ./server
RUN rm -rf ./server/__tests__
COPY --from=builder --chown=root:root /workspace/dist ./dist
COPY --chown=root:root module.json ./module.json

# Unprivileged runtime user expected by the skillsmaster module runtime.
RUN addgroup -S -g 101 imagestudio \
 && adduser -S -D -H -u 101 -G imagestudio -s /sbin/nologin imagestudio \
 && mkdir -p /data/db /data/storage \
 && chown -R 101:101 /data

USER 101:101
EXPOSE 8080 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/server/healthcheck.mjs"]

CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server/index.mjs"]
