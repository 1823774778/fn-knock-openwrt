#!/bin/bash

# Build Go reverse proxy for OpenWrt architectures.
#
# Prerequisites:
#   - Go 1.21+ installed
#   - Go source at ${GO_SOURCE_DIR}
#
# Output: apps/fn-knock/app/server/go-reauth-proxy-linux-{mips,mipsel,arm}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/../../.."
OUTPUT_DIR="${PROJECT_ROOT}/apps/fn-knock/app/server"

GO_SOURCE_DIR="${GO_SOURCE_DIR:-${PROJECT_ROOT}/../go-reauth-proxy}"

TARGETS=(
  "linux/mips:go-reauth-proxy-linux-mips"
  "linux/mipsel:go-reauth-proxy-linux-mipsle"
  "linux/mips64:go-reauth-proxy-linux-mips64"
  "linux/mips64el:go-reauth-proxy-linux-mips64le"
  "linux/arm:go-reauth-proxy-linux-arm"
  "linux/arm64:go-reauth-proxy-linux-arm64"
  "linux/amd64:go-reauth-proxy-linux-amd64"
)

CGO_ENABLED=0
LDFLAGS="-s -w"

echo "=== Cross-compiling go-reauth-proxy for OpenWrt ==="
echo "Source: ${GO_SOURCE_DIR}"
echo "Output: ${OUTPUT_DIR}"
echo ""

if [ ! -d "${GO_SOURCE_DIR}" ]; then
  echo "WARNING: Go source directory not found at ${GO_SOURCE_DIR}"
  echo "Skipping Go cross-compilation. Ensure pre-built binaries exist."
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"

cd "${GO_SOURCE_DIR}"

for target in "${TARGETS[@]}"; do
  IFS=':' read -r GOOS_GOARCH output_name <<< "${target}"

  echo "Building ${GOOS_GOARCH} -> ${output_name}..."

  GOOS="${GOOS_GOARCH%/*}" \
  GOARCH="${GOOS_GOARCH#*/}" \
  CGO_ENABLED="${CGO_ENABLED}" \
    go build \
      -ldflags "${LDFLAGS}" \
      -trimpath \
      -o "${OUTPUT_DIR}/${output_name}" \
      ./cmd/go-reauth-proxy 2>/dev/null || {
        echo "  SKIPPED: build failed (source may not support this target)"
        continue
      }

  chmod +x "${OUTPUT_DIR}/${output_name}"
  echo "  OK: ${output_name}"
done

echo ""
echo "=== Done ==="
ls -lh "${OUTPUT_DIR}"/go-reauth-proxy-linux-* 2>/dev/null || echo "No binaries produced."