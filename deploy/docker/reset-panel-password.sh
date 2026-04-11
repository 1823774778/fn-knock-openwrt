#!/usr/bin/env sh
set -eu

exec node /opt/fn-knock/server/server-admin/reset-docker-admin-panel.js "$@"
