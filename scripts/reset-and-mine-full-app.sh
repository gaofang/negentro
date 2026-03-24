#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="${1:-apps/goods/ffa-goods}"
ENTRO_ROOT="$ROOT_DIR/$APP/.entro"

echo "[entro-reset] app: $APP"
echo "[entro-reset] cleaning generated topics/patterns/questions/draft cards"

rm -rf "$ENTRO_ROOT/system/candidates/topics" \
       "$ENTRO_ROOT/system/candidates/patterns" \
       "$ENTRO_ROOT/system/candidates/questions" \
       "$ENTRO_ROOT/system/questions/open" \
       "$ENTRO_ROOT/system/cards/draft" \
       "$ENTRO_ROOT/system/cards/needs-human"

bash "$ROOT_DIR/packages/entro/scripts/mine-full-app.sh" "$APP"
