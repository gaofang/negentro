#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CLI="$ROOT_DIR/packages/entro/src/cli.js"
APP="${1:-apps/goods/ecop}"

echo "[entro-consolidate] app: $APP"
node "$CLI" consolidate --app "$APP"
