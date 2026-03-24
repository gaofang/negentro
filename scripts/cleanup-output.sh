#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="${1:-apps/goods/ecop}"
OUTPUT_DIR="$ROOT_DIR/$APP/.entro/output"

echo "[entro-cleanup] app: $APP"
echo "[entro-cleanup] cleaning legacy output artifacts under $OUTPUT_DIR"

rm -rf "$OUTPUT_DIR/AGENTS.consolidated.md" \
       "$OUTPUT_DIR/.AGENTS.consolidated.md.swp" \
       "$OUTPUT_DIR/AGENTS.generated.md" \
       "$OUTPUT_DIR/questions-consolidated.md" \
       "$OUTPUT_DIR/questions-consolidated" \
       "$OUTPUT_DIR/questions.todo.md" \
       "$OUTPUT_DIR/reports" \
       "$OUTPUT_DIR/sync-plans"
