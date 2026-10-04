#!/usr/bin/env sh
# Packages the image for skillsmaster upload (#8): one archive used for both modes.
#
#   scripts/package-image.sh [out-dir]          (default ./release)
#
# Produces, for VERSION taken from module.json:
#   image-studio-VERSION.tar.gz         docker save of image-studio:VERSION
#   image-studio-VERSION.tar.gz.sha256  checksum of the archive
#   image-studio-VERSION.release.json   module id, version, image id, git commit, checksum
#   image-studio-VERSION.tar.gz.sig     only with IMAGE_STUDIO_SIGNING_KEY=<private key PEM>:
#                                       openssl SHA-256 signature of the archive
# Set SKIP_BUILD=1 to package an already built image-studio:VERSION.
# Verify with: openssl dgst -sha256 -verify public.pem -signature X.tar.gz.sig X.tar.gz
set -eu
cd "$(dirname "$0")/.."
OUT="${1:-release}"
VERSION=$(node -p 'require("./module.json").version')
MODULE_ID=$(node -p 'require("./module.json").moduleId')
TAG="image-studio:$VERSION"
ARCHIVE="$OUT/image-studio-$VERSION.tar.gz"

mkdir -p "$OUT"
[ "${SKIP_BUILD:-0}" = 1 ] || docker build -t "$TAG" .
scripts/smoke-image.sh "$TAG"

docker save "$TAG" | gzip -n > "$ARCHIVE"
CHECKSUM=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
echo "$CHECKSUM  $(basename "$ARCHIVE")" > "$ARCHIVE.sha256"

SIGNATURE=null
if [ -n "${IMAGE_STUDIO_SIGNING_KEY:-}" ]; then
  openssl dgst -sha256 -sign "$IMAGE_STUDIO_SIGNING_KEY" -out "$ARCHIVE.sig" "$ARCHIVE"
  SIGNATURE="\"$(basename "$ARCHIVE").sig\""
fi

cat > "$OUT/image-studio-$VERSION.release.json" <<JSON
{
  "moduleId": "$MODULE_ID",
  "version": "$VERSION",
  "image": "$TAG",
  "imageId": "$(docker image inspect --format '{{.Id}}' "$TAG")",
  "gitCommit": "$(git rev-parse HEAD 2>/dev/null || echo unknown)",
  "archive": "$(basename "$ARCHIVE")",
  "sha256": "$CHECKSUM",
  "signature": $SIGNATURE,
  "containerPort": $(node -p 'require("./module.json").containerPort'),
  "runAs": "101:101",
  "readOnlyRootFilesystem": true
}
JSON
echo "packaged $ARCHIVE ($CHECKSUM)"
