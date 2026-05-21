#!/bin/bash

# Build all Go reverse proxy binaries using Docker.
# This script uses the official golang image to cross-compile for all OpenWrt architectures.
#
# Usage: ./build-in-docker.sh [go-source-dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/.."
GO_SOURCE_DIR="${1:-}"

if [ -z "${GO_SOURCE_DIR}" ]; then
  echo "Usage: $0 <go-reauth-proxy-source-dir>"
  echo ""
  echo "The go-reauth-proxy source directory should contain cmd/go-reauth-proxy/main.go"
  exit 1
fi

if [ ! -d "${GO_SOURCE_DIR}/cmd/go-reauth-proxy" ]; then
  echo "ERROR: cmd/go-reauth-proxy/ not found in ${GO_SOURCE_DIR}"
  exit 1
fi

GO_SOURCE_DIR="$(cd "${GO_SOURCE_DIR}" && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/apps/fn-knock/app/server"
mkdir -p "${OUTPUT_DIR}"

echo "=== Building go-reauth-proxy for all architectures ==="
echo "Source: ${GO_SOURCE_DIR}"
echo "Output: ${OUTPUT_DIR}"

docker run --rm \
  -v "${GO_SOURCE_DIR}:/src" \
  -v "${OUTPUT_DIR}:/out" \
  -w /src \
  golang:1.23-bookworm \
  sh -c '
    set -e

    TARGETS="
      linux/amd64:go-reauth-proxy-linux-amd64
      linux/arm64:go-reauth-proxy-linux-arm64
      linux/arm:go-reauth-proxy-linux-arm
      linux/mips:go-reauth-proxy-linux-mips
      linux/mipsle:go-reauth-proxy-linux-mipsle
      linux/mips64:go-reauth-proxy-linux-mips64
      linux/mips64le:go-reauth-proxy-linux-mips64le
    "

    for target in $TARGETS; do
      IFS=":" read -r go_platform output_name <<< "${target}"

      echo ""
      echo "=== Building ${go_platform} -> ${output_name} ==="

      GOOS="${go_platform%/*}" \
      GOARCH="${go_platform#*/}" \
      CGO_ENABLED=0 \
        go build \
          -ldflags="-s -w" \
          -trimpath \
          -o "/out/${output_name}" \
          ./cmd/go-reauth-proxy && \
        chmod +x "/out/${output_name}" && \
        echo "  OK: ${output_name}" || \
        echo "  FAILED: ${go_platform}"
    done

    echo ""
    echo "=== Results ==="
    ls -lh /out/go-reauth-proxy-linux-* 2>/dev/null || echo "No binaries produced."
  '

echo ""
echo "=== Done ==="
ls -lh "${OUTPUT_DIR}"/go-reauth-proxy-linux-* 2>/dev/null || echo "No binaries produced."