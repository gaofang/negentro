#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CLI="$ROOT_DIR/packages/entro/src/cli.js"

APP="${1:-apps/goods/ffa-goods}"
SCOPE="${2:-app}"

APP_ABS="$ROOT_DIR/$APP"
ENTRO_ROOT="$APP_ABS/.entro"

echo "[smoke] repo root: $ROOT_DIR"
echo "[smoke] app: $APP"
echo "[smoke] scope: $SCOPE"
echo

node "$CLI" init --app "$APP"
node "$CLI" scan --app "$APP"
node "$CLI" classify-sources --app "$APP"
node "$CLI" mine --app "$APP" --scope "$SCOPE"

echo
echo "[smoke] output summary"
TOPIC_COUNT="$(find "$ENTRO_ROOT/system/candidates/topics" -name '*.json' | wc -l | tr -d ' ')"
PATTERN_COUNT="$(find "$ENTRO_ROOT/system/candidates/patterns" -name '*.json' | wc -l | tr -d ' ')"
QUESTION_COUNT="$(find "$ENTRO_ROOT/system/questions/open" -name '*.json' | wc -l | tr -d ' ')"
CARD_DRAFT_COUNT="$(find "$ENTRO_ROOT/system/cards/draft" -name '*.json' | wc -l | tr -d ' ')"
CARD_NEEDS_HUMAN_COUNT="$(find "$ENTRO_ROOT/system/cards/needs-human" -name '*.json' | wc -l | tr -d ' ')"

echo "  topics: $TOPIC_COUNT"
echo "  patterns: $PATTERN_COUNT"
echo "  open questions: $QUESTION_COUNT"
echo "  draft cards: $CARD_DRAFT_COUNT"
echo "  needs-human cards: $CARD_NEEDS_HUMAN_COUNT"
echo
echo "[smoke] key files"
echo "  questions report: $ENTRO_ROOT/output/questions.todo.md"
echo "  latest run: $ENTRO_ROOT/system/runs/agent/latest-distill-run.json"
echo "  draft cards dir: $ENTRO_ROOT/system/cards/draft"
echo "  open questions dir: $ENTRO_ROOT/system/questions/open"
