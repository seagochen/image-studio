# Build from the repository root so the app can consume the platform's shared
# TypeScript contracts without copying any server implementation into the image:
# docker build -f webapps/image-studio/Dockerfile -t skillsmaster-app-image-studio .
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /workspace/webapps

COPY webapps/package*.json ./
RUN npm ci
COPY webapps ./
COPY frontend/src/shared /workspace/frontend/src/shared
COPY frontend/src/public/styles/icons.css /workspace/frontend/src/public/styles/icons.css
RUN npm run build:image-studio

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS production
COPY webapps/image-studio/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=nginx:nginx /workspace/webapps/image-studio/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
