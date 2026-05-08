#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/fn-knock-docker"
VERSION_FILE="${ROOT_DIR}/apps/server-admin/src/lib/app-version.ts"
MANIFEST_FILE="${APP_DIR}/manifest"

sync_manifest_version() {
  if [ ! -f "${VERSION_FILE}" ]; then
    echo "[fn-knock-docker-fpk] Missing version file: ${VERSION_FILE}" >&2
    exit 1
  fi

  local app_version
  app_version="$(sed -nE 's/^[[:space:]]*export[[:space:]]+const[[:space:]]+APP_LOCAL_VERSION[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "${VERSION_FILE}" | head -n1)"
  if [ -z "${app_version}" ]; then
    echo "[fn-knock-docker-fpk] Failed to parse APP_LOCAL_VERSION from ${VERSION_FILE}" >&2
    exit 1
  fi

  local current_manifest_version
  current_manifest_version="$(sed -nE 's/^version=(.*)$/\1/p' "${MANIFEST_FILE}" | head -n1)"

  if [ "${current_manifest_version}" = "${app_version}" ]; then
    echo "[fn-knock-docker-fpk] Manifest version is already up to date: ${app_version}"
    return 0
  fi

  local tmp_manifest
  tmp_manifest="$(mktemp)"
  awk -v version="${app_version}" '
    /^version=/ {
      print "version=" version
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print "version=" version
      }
    }
  ' "${MANIFEST_FILE}" > "${tmp_manifest}"
  mv "${tmp_manifest}" "${MANIFEST_FILE}"

  echo "[fn-knock-docker-fpk] Synced manifest version: ${current_manifest_version:-<empty>} -> ${app_version}"
}

prepare_package() {
  sync_manifest_version

  chmod +x \
    "${APP_DIR}/cmd/main" \
    "${APP_DIR}/cmd/install_init" \
    "${APP_DIR}/cmd/install_callback" \
    "${APP_DIR}/cmd/uninstall_init" \
    "${APP_DIR}/cmd/uninstall_callback" \
    "${APP_DIR}/cmd/upgrade_init" \
    "${APP_DIR}/cmd/upgrade_callback" \
    "${APP_DIR}/cmd/config_init" \
    "${APP_DIR}/cmd/config_callback"

  mkdir -p "${APP_DIR}/dist"
  echo "[fn-knock-docker-fpk] Docker FPK package directory is ready: ${APP_DIR}"
}

usage() {
  cat <<'EOF'
Usage:
  ./apps/fn-knock-docker/scripts/build-package.sh [prepare]

Commands:
  prepare  Sync metadata and ensure executable lifecycle scripts (default)
EOF
}

cmd="${1:-prepare}"
case "${cmd}" in
  prepare)
    prepare_package
    ;;
  *)
    usage
    exit 1
    ;;
esac
