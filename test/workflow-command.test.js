import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  createWorkflowHelpResult,
  normalizeWorkflowIntegration,
  workflowCommand,
} from '../src/commands/workflow.js';
import { createContext } from '../src/context.js';
import { ensureDir, readJson, writeJson } from '../src/shared/fs.js';

test('normalizeWorkflowIntegration defaults to strict frontend workflow', () => {
  assert.equal(normalizeWorkflowIntegration(undefined), 'strict-frontend-workflow');
  assert.equal(normalizeWorkflowIntegration('entro-distill'), 'entro-distill');
});

test('normalizeWorkflowIntegration rejects unsupported integrations', () => {
  assert.throws(
    () => normalizeWorkflowIntegration('goods-publish'),
    /unsupported workflow integration/,
  );
});


test('workflow install-codex routes generic integration into codex installer', () => {
  let receivedOptions = null;
  const result = workflowCommand(
    { appRoot: '/tmp/demo' },
    { _: ['install-codex'], mode: 'skill' },
    {
      installCodexCommand(context, options) {
        receivedOptions = { context, options };
        return {
          mode: options.mode,
          integration: options.integration,
          installed: {
            skill: {
              name: options.skill,
              path: '/tmp/.codex/skills/strict-frontend-workflow',
            },
            plugin: null,
          },
        };
      },
      installCodexHelpers: {},
    },
  );

  assert.equal(result.integration, 'strict-frontend-workflow');
  assert.equal(receivedOptions.options.integration, 'strict-frontend-workflow');
  assert.equal(receivedOptions.options.skill, 'strict-frontend-workflow');
  assert.equal(result.install.installed.skill.name, 'strict-frontend-workflow');
});

function makeTempWorkflowContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entro-workflow-'));
  const appRoot = path.join(root, 'apps', 'demo');
  fs.mkdirSync(appRoot, { recursive: true });
  process.env.ENTRO_RUNTIME_HOME = path.join(root, '.entro-runtime');
  const context = createContext(appRoot);
  ensureDir(path.join(context.paths.runtime, 'workflow'));
  return context;
}

test('workflow run starts the strict workflow runtime with stage metadata', () => {
  const context = makeTempWorkflowContext();
  const result = workflowCommand(context, { _: ['run'] }, {
    readJson,
    writeJson,
    ensureDir,
    promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
  });

  assert.equal(result.command, 'workflow');
  assert.equal(result.subcommand, 'run');
  assert.equal(result.status, 'ok');
  assert.equal(result.workflow.currentStage.slug, 'intake');
  assert.equal(result.workflow.stages.length, 6);
  assert.equal(result.workflow.promptArtifact, path.join(context.repoRoot, 'prompts', 'workflow_main.md'));
  assert.equal(result.nextAction.type, 'advance');
});

test('workflow next advances through the strict workflow stages', () => {
  const context = makeTempWorkflowContext();
  const helpers = {
    readJson,
    writeJson,
    ensureDir,
    promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
  };

  workflowCommand(context, { _: ['run'] }, helpers);
  const result = workflowCommand(context, { _: ['next'] }, helpers);

  assert.equal(result.subcommand, 'next');
  assert.equal(result.status, 'ok');
  assert.equal(result.advanced, true);
  assert.equal(result.workflow.currentStage.slug, 'plan');
  assert.equal(result.workflow.nextStage.slug, 'prepare');
});

test('workflow stop points are not re-emitted after being acknowledged', () => {
  const context = makeTempWorkflowContext();
  const helpers = {
    readJson,
    writeJson,
    ensureDir,
    promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
  };

  const first = workflowCommand(context, {
    _: ['run'],
    stopPointId: 'intake-scope-confirmation',
    stopPointMessage: 'Confirm whether the scope is PC only or PC + OPEN.',
  }, helpers);

  assert.equal(first.workflow.currentStopPoint.id, 'intake-scope-confirmation');
  assert.equal(first.workflow.currentStopPoint.status, 'pending');

  const second = workflowCommand(context, {
    _: ['status'],
  }, helpers);

  assert.equal(second.workflow.currentStopPoint.id, 'intake-scope-confirmation');
  assert.equal(second.workflow.currentStopPoint.status, 'pending');
  assert.equal(second.workflow.currentStopPoint.repeatable, false);

  const acknowledged = workflowCommand(context, {
    _: ['ack-stop'],
    stopPointId: 'intake-scope-confirmation',
  }, helpers);

  assert.equal(acknowledged.workflow.currentStopPoint, null);

  const afterAck = workflowCommand(context, {
    _: ['status'],
  }, helpers);

  assert.equal(afterAck.workflow.currentStopPoint, null);

  const rerunWithSameStopPoint = workflowCommand(context, {
    _: ['run'],
    stopPointId: 'intake-scope-confirmation',
    stopPointMessage: 'Confirm whether the scope is PC only or PC + OPEN.',
  }, helpers);

  assert.equal(rerunWithSameStopPoint.workflow.currentStopPoint, null);
});

test('workflow status is read-only before run', () => {
  const context = makeTempWorkflowContext();
  const statePath = path.join(context.paths.runtime, 'workflow', 'strict-workflow-state.json');
  const result = workflowCommand(context, { _: ['status'] }, {
    readJson,
    writeJson,
    ensureDir,
    promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
  });

  assert.equal(result.subcommand, 'status');
  assert.equal(result.status, 'not_started');
  assert.equal(result.workflow, null);
  assert.equal(fs.existsSync(statePath), false);
});

test('workflow help exposes supported subcommands including status', () => {
  const result = createWorkflowHelpResult();

  assert.equal(result.command, 'workflow');
  assert.equal(result.subcommand, 'help');
  assert.deepEqual(
    result.subcommands.map(item => item.name),
    ['install-codex', 'run', 'next', 'status', 'capture', 'list', 'review', 'keep', 'discard', 'promote', 'help'],
  );
});

test('workflow capture/list/review/promote manage lightweight knowledge cards', () => {
  const context = makeTempWorkflowContext();
  const helpers = {
    readJson,
    writeJson,
    ensureDir,
    promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
  };

  const capture = workflowCommand(context, {
    _: ['capture'],
    type: 'experience',
    summary: 'Team prefers narrowing workflow prompts before review',
    details: 'Keep the first review pass focused on a single workflow outcome.',
    target: 'skills',
    skillId: 'review-narrowing',
  }, helpers);

  assert.equal(capture.status, 'ok');
  assert.equal(capture.card.type, 'experience');
  assert.equal(capture.card.reviewState, 'pending');

  const listedPending = workflowCommand(context, { _: ['list'], state: 'pending' }, helpers);
  assert.equal(listedPending.cards.length, 1);
  assert.equal(listedPending.counts.byState.pending, 1);

  const kept = workflowCommand(context, {
    _: ['keep'],
    card: capture.card.id,
    note: 'Keep for team discussion',
  }, helpers);
  assert.equal(kept.subcommand, 'keep');
  assert.equal(kept.card.reviewState, 'kept');
  assert.equal(kept.bridgeEntry, null);

  const promoted = workflowCommand(context, {
    _: ['promote'],
    card: capture.card.id,
    target: 'skills',
    bridgeBody: 'Review one change at a time before expanding workflow automation.',
  }, helpers);
  assert.equal(promoted.card.reviewState, 'promoted');
  assert.equal(promoted.bridgeEntry.target, 'skills');
  assert.equal(promoted.bridgeEntry.output.kind, 'skill_stub');
  assert.equal(promoted.bridgeEntry.output.skill.id.length > 0, true);

  const listedPromoted = workflowCommand(context, { _: ['list'], state: 'promoted' }, helpers);
  assert.equal(listedPromoted.cards.length, 1);
  assert.equal(listedPromoted.cards[0].id, capture.card.id);
});
