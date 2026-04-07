# negentro

negentro is a repository knowledge distillation CLI for frontend-heavy codebases. It extracts project conventions, implementation patterns, and human-confirmed decisions into reusable artifacts such as `AGENTS.md` and skills.

It is designed for teams working in complex business repositories where the hardest problems are not syntax, but context: hidden conventions, historical behavior, repeated implementation patterns, and project-specific decisions that are easy to miss.

## Why negentro Exists

Modern coding agents can generate code quickly, but they often miss the local rules that make a large repository safe to change.

negentro exists to bridge that gap. It helps teams:

- discover recurring implementation patterns in a repository
- surface ambiguous decisions that still need human confirmation
- convert confirmed project knowledge into reusable agent-facing artifacts
- drive structured workflows from CLI or agent environments such as Codex

## Design Philosophy

negentro is built around a few simple ideas.

### 1. Human-in-the-loop beats blind automation
Some repository knowledge can be mined from code. Some cannot. negentro treats unresolved ambiguity as a first-class concept and asks for human confirmation one question at a time.

### 2. Structured output is the protocol
negentro provides JSON-friendly command output so agent environments can orchestrate workflows without scraping prose from terminal logs.

### 3. Repository knowledge should be reusable
The goal is not a one-off summary. The goal is durable artifacts that future humans and agents can reuse:

- `AGENTS.md`
- skills
- knowledge cards
- workflow review bridges

### 4. Process matters in complex codebases
In repositories with heavy business logic and historical constraints, safer change velocity comes from better process: staged workflows, explicit review points, and lightweight knowledge capture.

## Core Concepts

### Extraction
negentro scans an app or repository scope and produces structured candidate knowledge.

### Questions
When the code alone is not enough, negentro creates confirmation questions for humans.

### Cards
Knowledge is captured as lightweight structured units that can later be reviewed, promoted, or published.

### Publications
Confirmed knowledge can be rendered into stable artifacts such as `AGENTS.md` and skills.

### Workflow Mode
Workflow mode adds a stricter staged interaction layer for complex frontend tasks, including knowledge capture and team review hooks.

## Key Use Cases

negentro is especially useful when:

- a repository has many local conventions that are not fully documented
- coding agents need project-specific context before making changes
- teams want reusable agent-facing documentation rather than repeated onboarding
- frontend work involves complex forms, validation, workflows, and legacy behavior
- human review needs to be preserved while still enabling agent automation

## Installation

### Global install

```bash
npm install -g negentro
```

Then:

```bash
entro help
```

### Run with npx

```bash
npx negentro help
```

### Local development

Inside this repository:

```bash
node ./src/cli.js help
```

## Quick Start

A common flow for one app looks like this:

```bash
entro run --app /abs/path/to/app
entro question next --app /abs/path/to/app
entro answer --app /abs/path/to/app --question <id> --text "1"
entro reconcile --app /abs/path/to/app --question <id>
entro build --app /abs/path/to/app
```

This does three things:

1. extract repository knowledge
2. resolve ambiguous questions with human input
3. build reusable agent-facing artifacts

## Basic CLI Usage

Recommended commands:

```bash
entro run --app /abs/path/to/app
entro build --app /abs/path/to/app
entro question next --app /abs/path/to/app
entro answer --app /abs/path/to/app --question <id> --text "1"
entro reconcile --app /abs/path/to/app --question <id>
```

## JSON / Agent Integration

For agent orchestration, prefer `--json`:

```bash
entro doctor --app /abs/path/to/app --json
entro paths --app /abs/path/to/app --json
entro run --app /abs/path/to/app --json
entro question next --app /abs/path/to/app --json
entro answer --app /abs/path/to/app --question <id> --text "skip" --json
entro reconcile --app /abs/path/to/app --question <id> --json
entro build --app /abs/path/to/app --json
```

Use JSON mode when an agent or external tool needs structured state rather than terminal-oriented output.

## Codex Integration

If you want developers to drive negentro directly from Codex instead of switching to a separate TUI, install the Codex integration:

```bash
entro install-codex --mode both
```

Install only the skill:

```bash
entro install-codex --mode skill
```

Install only the plugin:

```bash
entro install-codex --mode plugin
```

Default install targets:

- `~/.codex/skills/entro-distill`
- `~/.codex/plugins/negentro`

Inspect install output as JSON:

```bash
entro install-codex --mode both --json
```

## Workflow Mode

Workflow mode is a stricter interaction layer for complex frontend work.

It is intended for tasks where directly generating code is risky because the repository has:

- heavy business logic
- historical behavior or compatibility constraints
- multi-stage flows such as forms, validation, review, or submission

### Install workflow mode into Codex

```bash
entro workflow install-codex --mode both
```

### Codex-first usage

After installing `strict-frontend-workflow`, developers should not need to manually drive each workflow subcommand.

Instead, they can describe the task in natural language inside Codex, for example:

- “Handle this frontend task with the strict workflow before writing code.”
- “This change touches historical form logic; use the strict workflow.”
- “Continue the workflow automatically unless you hit a real decision point.”

In this mode, Codex treats `entro workflow --json` as the protocol layer and automatically:

- starts or resumes workflow state
- reads the current stage and next action
- advances stages by default
- pauses only at meaningful decision points
- collects experience cards or correction cards near the end of the flow

The CLI is still available, but it is not meant to be the primary interface for end users in Codex.

### Underlying workflow protocol

These commands remain the underlying interfaces used by orchestration:

```bash
entro workflow run --json
entro workflow next --json
entro workflow status --json
entro workflow capture --type experience --summary "Review one workflow step at a time" --details "Narrow the scope before expanding" --target skills --json
entro workflow capture --type correction --summary "Do not merge review and publish decisions" --target reference --json
entro workflow list --state pending --json
entro workflow review --card <cardId> --decision keep --note "Keep for team review" --json
entro workflow review --card <cardId> --decision discard --note "Outdated" --json
entro workflow review --card <cardId> --decision promote --target skills --json
entro workflow promote --card <cardId> --target agents --sectionHeading "Workflow review defaults" --json
```

Promoted cards currently land in bridge artifacts compatible with future `reference`, `skills`, and `AGENTS` generation. The current release keeps this bridge lightweight and does not fully automate all downstream publication behavior.

## Example End-to-End Flow

### Repository distillation flow

```bash
entro run --app /abs/path/to/app
entro question next --app /abs/path/to/app --json
entro answer --app /abs/path/to/app --question <id> --text "skip" --json
entro reconcile --app /abs/path/to/app --question <id> --json
entro build --app /abs/path/to/app --json
```

### Strict workflow flow

In Codex, a user can start with natural language. The orchestration layer should then:

1. enter the workflow
2. clarify scope only if necessary
3. advance through staged work
4. stop only at decision points
5. capture reusable knowledge at the end

## Output Artifacts

Depending on the flow, negentro can produce or maintain:

- `.entro/output/AGENTS.md`
- `.entro/output/skills/`
- workflow knowledge cards
- publication bridge artifacts
- runtime reports and structured state

## Current Status

Already supported:

- app initialization, scanning, classification, seed extraction, and knowledge distillation
- one-question-at-a-time HITL confirmation
- `.entro/output/AGENTS.md` and `.entro/output/skills`
- Codex skill / plugin installation
- JSON-oriented orchestration interfaces
- strict workflow runtime and lightweight workflow knowledge bridge

Still evolving:

- stronger end-to-end Codex orchestration behavior in real-world sessions
- broader JSON command coverage
- tighter workflow-driven publication into final reusable artifacts
- better external packaging and open-source polish

## Development

Run the test suite:

```bash
npm test
```

Run a focused test file:

```bash
node --test ./test/hitl-flow.test.js
```

## Contributing

This project is still being actively shaped. Contributions are easiest when they:

- keep user-facing behavior simple
- preserve structured machine-readable outputs
- avoid overfitting to one business domain in public interfaces
- improve the bridge between real repository knowledge and reusable agent artifacts

## License

License details are not finalized yet.
