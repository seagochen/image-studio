# Image Studio — one image for both runtime modes (Issue #1).
#
#   docker build -t image-studio .
#
# Platform mode (default; mounted by skillsmaster under /apps/image-studio/*):
#   static assets + /healthz + /runtime-config.json on port 8080, no volumes, no keys.
# Standalone mode: see docker-compose.yml and config/standalone.json.

FROM node:22-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production \
    IMAGE_STUDIO_MODE=platform \
    IMAGE_STUDIO_STATIC_DIR=/app/dist
WORKDIR /app
COPY --chown=root:root server ./server
RUN rm -rf ./server/__tests__
COPY --from=builder --chown=root:root /workspace/dist ./dist
COPY --chown=root:root module.json ./module.json

# Standalone volumes are mounted here; created owned by the unprivileged runtime user.
RUN mkdir -p /var/lib/image-studio/db /var/lib/image-studio/storage \
 && chown -R node:node /var/lib/image-studio

USER node
EXPOSE 8080 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/server/healthcheck.mjs"]

CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server/index.mjs"]
