#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CLI="$ROOT_DIR/packages/entro/src/cli.js"

APP="${1:-apps/goods/ffa-goods}"
APP_ABS="$ROOT_DIR/$APP"
ENTRO_ROOT="$APP_ABS/.entro"

echo "[entro-full] repo root: $ROOT_DIR"
echo "[entro-full] app: $APP"
echo

node "$CLI" init --app "$APP"
node "$CLI" scan --app "$APP"
node "$CLI" classify-sources --app "$APP"
node "$CLI" mine --app "$APP" --full-app

echo
echo "[entro-full] summary"
TOPIC_COUNT="$(find "$ENTRO_ROOT/system/candidates/topics" -name '*.json' | wc -l | tr -d ' ')"
PATTERN_COUNT="$(find "$ENTRO_ROOT/system/candidates/patterns" -name '*.json' | wc -l | tr -d ' ')"
OPEN_QUESTION_COUNT="$(find "$ENTRO_ROOT/system/questions/open" -name '*.json' | wc -l | tr -d ' ')"
ANSWERED_QUESTION_COUNT="$(find "$ENTRO_ROOT/system/questions/answered" -name '*.json' | wc -l | tr -d ' ')"
CLOSED_QUESTION_COUNT="$(find "$ENTRO_ROOT/system/questions/closed" -name '*.json' | wc -l | tr -d ' ')"
DRAFT_CARD_COUNT="$(find "$ENTRO_ROOT/system/cards/draft" -name '*.json' | wc -l | tr -d ' ')"
NEEDS_HUMAN_CARD_COUNT="$(find "$ENTRO_ROOT/system/cards/needs-human" -name '*.json' | wc -l | tr -d ' ')"
NEEDS_REVIEW_CARD_COUNT="$(find "$ENTRO_ROOT/system/cards/needs-review" -name '*.json' | wc -l | tr -d ' ')"

echo "  topics: $TOPIC_COUNT"
echo "  patterns: $PATTERN_COUNT"
echo "  open questions: $OPEN_QUESTION_COUNT"
echo "  answered questions: $ANSWERED_QUESTION_COUNT"
echo "  closed questions: $CLOSED_QUESTION_COUNT"
echo "  draft cards: $DRAFT_CARD_COUNT"
echo "  needs-human cards: $NEEDS_HUMAN_CARD_COUNT"
echo "  needs-review cards: $NEEDS_REVIEW_CARD_COUNT"
echo
echo "[entro-full] key paths"
echo "  output root: $ENTRO_ROOT/output"
echo "  questions report: $ENTRO_ROOT/output/questions.todo.md"
echo "  latest distill run: $ENTRO_ROOT/system/runs/agent/latest-distill-run.json"
echo "  topics dir: $ENTRO_ROOT/system/candidates/topics"
echo "  patterns dir: $ENTRO_ROOT/system/candidates/patterns"
echo "  cards dir: $ENTRO_ROOT/system/cards"
echo "  questions dir: $ENTRO_ROOT/system/questions"
