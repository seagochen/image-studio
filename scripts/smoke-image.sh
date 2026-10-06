#!/usr/bin/env sh
# Runs one built image in both modes and checks the dual-mode contract (#8):
#   platform:   read-only root, uid/gid 101:101, static + /healthz + runtime config only
#   standalone: /data volume, project survives a container restart
#   misconfig:  a platform host never ends up running the image standalone
#
#   scripts/smoke-image.sh [image]   (default image-studio:ci)
set -eu
IMAGE="${1:-image-studio:ci}"
PREFIX="image-studio-smoke-$$"
VOLUME="$PREFIX-data"
PLATFORM_PORT="${SMOKE_PLATFORM_PORT:-18080}"
STANDALONE_PORT="${SMOKE_STANDALONE_PORT:-18081}"

cleanup() {
  docker rm -f "$PREFIX-platform" "$PREFIX-standalone" "$PREFIX-bad" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; docker logs "$PREFIX-platform" 2>&1 | tail -5 >&2 || true; exit 1; }

wait_healthy() {
  i=0
  until curl -fsS "http://127.0.0.1:$1/healthz" >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -gt 30 ] && fail "port $1 never became healthy"; sleep 1
  done
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "== platform mode (read-only root, 101:101)"
docker run -d --name "$PREFIX-platform" --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e SKILLSMASTER_MODE=platform -p "127.0.0.1:$PLATFORM_PORT:8080" "$IMAGE" >/dev/null
wait_healthy "$PLATFORM_PORT"
[ "$(docker inspect "$PREFIX-platform" --format '{{len .Mounts}}')" = 0 ] || fail "platform must not have data volumes"
[ "$(docker exec "$PREFIX-platform" id -u):$(docker exec "$PREFIX-platform" id -g)" = "101:101" ] || fail "platform must run as 101:101"
curl -fsS "http://127.0.0.1:$PLATFORM_PORT/apps/image-studio/runtime-config.json" | grep -q '"mode":"platform"' || fail "platform runtime config"
curl -fsS "http://127.0.0.1:$PLATFORM_PORT/apps/image-studio/projects/deep-link" | grep -qi '<!doctype html' || fail "platform deep link"
[ "$(status "http://127.0.0.1:$PLATFORM_PORT/image-studio/projects")" = 404 ] || fail "platform must not serve the project API"
[ "$(status "http://127.0.0.1:$PLATFORM_PORT/local-ai/status")" = 404 ] || fail "platform must not serve the AI proxy"
docker exec "$PREFIX-platform" sh -c 'test ! -e /data/db/image-studio.sqlite' || fail "platform must not create a database"

echo "== standalone mode (/data volume, restart)"
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$PREFIX-standalone" --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e IMAGE_STUDIO_MODE=standalone -e PORT=8081 -v "$VOLUME:/data" -p "127.0.0.1:$STANDALONE_PORT:8081" "$IMAGE" >/dev/null
wait_healthy "$STANDALONE_PORT"
BASE="http://localhost:$STANDALONE_PORT"
curl -fsS "$BASE/apps/image-studio/runtime-config.json" | grep -q '"mode":"standalone"' || fail "standalone runtime config"
PROJECT=$(curl -fsS -X POST "$BASE/image-studio/projects" -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"title":"Smoke","document":{"version":12,"layers":[]}}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$PROJECT" ] || fail "standalone project create"
docker restart "$PREFIX-standalone" >/dev/null
wait_healthy "$STANDALONE_PORT"
curl -fsS "$BASE/image-studio/projects/$PROJECT" | grep -q '"title":"Smoke"' || fail "project lost across restart"
[ "$(status -H 'Host: studio.example.com' "http://127.0.0.1:$STANDALONE_PORT/image-studio/projects")" = 403 ] \
  || fail "standalone without a token must refuse non-localhost hosts"

echo "== platform host + standalone request is refused"
if docker run --name "$PREFIX-bad" -e SKILLSMASTER_MODE=platform -e IMAGE_STUDIO_MODE=standalone "$IMAGE" >/dev/null 2>&1; then
  fail "mismatched modes must not start"
fi

echo "OK: $IMAGE passes the dual-mode smoke test"
