import fs from 'fs';
import path from 'path';

import { createStrictWorkflowRuntime } from '../services/strict-workflow.js';
import { createWorkflowKnowledgeService } from '../services/workflow-knowledge.js';

function extractCommand(context, options, helpers) {
  const {
    ensureInitializedOrInit,
    runScanCommand,
    runClassifySourcesCommand,
    seedPlanCommand,
    seedExtractCommand,
  } = helpers;

  return ensureInitializedOrInit(context, () => {
    runScanCommand(context, options, helpers.scanHelpers);
    runClassifySourcesCommand(context, options, helpers.classifyHelpers);
    seedPlanCommand(context, options, helpers.seedPlanHelpers);
    return seedExtractCommand(context, options, helpers.seedExtractHelpers);
  });
}

async function runCommand(context, options, helpers) {
  const {
    ensureInitializedOrInit,
    extractCommand,
    consolidateCommand,
  } = helpers;

  return ensureInitializedOrInit(context, async () => {
    await extractCommand(context, options, helpers.extractHelpers);
    const openQuestions = countOpenQuestions(context);
    if (openQuestions > 0) {
      console.log(`[entro] 已完成自动流程，但当前仍有 ${openQuestions} 个待确认问题，请先使用 \`entro question\` 完成人工确认，再执行 \`entro build\``);
      return;
    }

    await consolidateCommand(context, options, helpers.buildHelpers);
  });
}

function workflowCommand(context, options = {}, helpers = {}) {
  const subcommand = normalizeWorkflowSubcommand(options._?.[0]);

  switch (subcommand) {
    case 'install-codex':
      return runWorkflowInstallCodex(context, options, helpers);
    case 'run':
      return runStrictWorkflowCommand(context, options, helpers, 'run');
    case 'next':
      return runStrictWorkflowCommand(context, options, helpers, 'next');
    case 'status':
      return runStrictWorkflowCommand(context, options, helpers, 'status');
    case 'ack-stop':
      return runStrictWorkflowCommand(context, options, helpers, 'ack-stop');
    case 'capture':
      return runWorkflowKnowledgeCommand(context, options, helpers, 'capture');
    case 'review':
      return runWorkflowKnowledgeCommand(context, options, helpers, 'review');
    case 'keep':
      return runWorkflowKnowledgeCommand(context, options, helpers, 'keep');
    case 'discard':
      return runWorkflowKnowledgeCommand(context, options, helpers, 'discard');
    case 'list':
      return runWorkflowKnowledgeCommand(context, options, helpers, 'list');
    case 'promote':
      return runWorkflowKnowledgeCommand(context, options, helpers, 'promote');
    case 'help':
      return createWorkflowHelpResult();
    default:
      return createWorkflowPlaceholderResult({
        subcommand,
        status: 'unsupported_subcommand',
        message: `Unsupported workflow subcommand: ${subcommand}`,
        nextSteps: ['Run `entro workflow help` to see the available workflow subcommands.'],
      });
  }
}

function runWorkflowInstallCodex(context, options, helpers) {
  if (!helpers.installCodexCommand) {
    throw new Error('workflow install-codex requires installCodexCommand helper');
  }

  const integration = normalizeWorkflowIntegration(options.integration);
  const installOptions = {
    ...options,
    integration,
  };

  if (!installOptions.skill && integration === 'strict-frontend-workflow') {
    installOptions.skill = 'strict-frontend-workflow';
  }

  return {
    command: 'workflow',
    subcommand: 'install-codex',
    integration,
    status: 'installed',
    install: helpers.installCodexCommand(context, installOptions, helpers.installCodexHelpers),
  };
}

function runStrictWorkflowCommand(context, options, helpers, action) {
  const runtime = createStrictWorkflowRuntime(context, {
    readJson: helpers.readJson,
    writeJson: helpers.writeJson,
    ensureDir: helpers.ensureDir,
    promptArtifactPath: helpers.promptArtifactPath,
  });

  if (action === 'run') {
    return runtime.run(options);
  }

  if (action === 'next') {
    return runtime.next(options);
  }

  if (action === 'ack-stop') {
    return runtime.status(options);
  }

  return runtime.status(options);
}

function runWorkflowKnowledgeCommand(context, options, helpers, action) {
  const service = (helpers.createWorkflowKnowledgeService || createWorkflowKnowledgeService)(context, {
    ensureDir: helpers.ensureDir,
    readJson: helpers.readJson,
    writeJson: helpers.writeJson,
  });

  if (action === 'capture') {
    const card = service.captureCard({
      id: options.id,
      type: options.type,
      category: options.category,
      title: options.title,
      summary: options.summary,
      details: options.details,
      source: options.source,
      tags: splitCsv(options.tags),
      references: splitCsv(options.references),
      promotionTarget: options.target,
      bridge: {
        title: options.bridgeTitle,
        summary: options.bridgeSummary,
        body: options.bridgeBody,
        skillId: options.skillId,
        sectionHeading: options.sectionHeading,
        references: splitCsv(options.references),
      },
    });
    return {
      command: 'workflow',
      subcommand: 'capture',
      status: 'ok',
      card,
    };
  }

  if (action === 'list') {
    const cards = service.listCards({
      type: options.type,
      reviewState: options.state,
    });
    return {
      command: 'workflow',
      subcommand: 'list',
      status: 'ok',
      cards,
      counts: summarizeKnowledgeCards(cards),
    };
  }

  if (action === 'review' || action === 'keep' || action === 'discard') {
    const cardId = options.card || options.id;
    const commandLabel = action === 'review' ? 'workflow review' : `workflow ${action}`;
    if (!cardId) {
      throw new Error(`${commandLabel} requires \`--card <cardId>\``);
    }
    const decision = action === 'review' ? (options.decision || 'keep') : action;
    const result = service.reviewCard(cardId, decision, {
      note: options.note,
      reviewer: options.by,
      target: options.target,
      bridge: {
        title: options.bridgeTitle,
        summary: options.bridgeSummary,
        body: options.bridgeBody,
        skillId: options.skillId,
        sectionHeading: options.sectionHeading,
        references: splitCsv(options.references),
      },
    });
    return {
      command: 'workflow',
      subcommand: action,
      status: 'ok',
      decision,
      card: result.card,
      bridgeEntry: result.bridgeEntry,
    };
  }

  const cardId = options.card || options.id;
  if (!cardId) {
    throw new Error('workflow promote requires `--card <cardId>`');
  }
  const result = service.promoteCard(cardId, {
    note: options.note,
    reviewer: options.by,
    target: options.target,
    bridge: {
      title: options.bridgeTitle,
      summary: options.bridgeSummary,
      body: options.bridgeBody,
      skillId: options.skillId,
      sectionHeading: options.sectionHeading,
      references: splitCsv(options.references),
    },
  });
  return {
    command: 'workflow',
    subcommand: 'promote',
    status: 'ok',
    card: result.card,
    bridgeEntry: result.bridgeEntry,
  };
}

function summarizeKnowledgeCards(cards) {
  return cards.reduce(
    (summary, card) => {
      summary.total += 1;
      summary.byState[card.reviewState] = (summary.byState[card.reviewState] || 0) + 1;
      summary.byType[card.type] = (summary.byType[card.type] || 0) + 1;
      return summary;
    },
    { total: 0, byState: {}, byType: {} },
  );
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeWorkflowSubcommand(value) {
  return String(value || 'help').trim().toLowerCase();
}

function normalizeWorkflowIntegration(value) {
  const normalized = String(value || 'strict-frontend-workflow').trim().toLowerCase();
  if (normalized === 'entro-distill' || normalized === 'strict-frontend-workflow') {
    return normalized;
  }
  throw new Error(`unsupported workflow integration: ${value}`);
}

function createWorkflowPlaceholderResult({ subcommand, status, message, nextSteps = [] }) {
  return {
    command: 'workflow',
    subcommand,
    status,
    message,
    nextSteps,
  };
}

function createWorkflowHelpResult() {
  return {
    command: 'workflow',
    subcommand: 'help',
    status: 'ok',
    usage: [
      'entro workflow install-codex [--integration entro-distill|strict-frontend-workflow] [--mode skill|plugin|both]',
      'entro workflow run',
      'entro workflow next',
      'entro workflow status',
      'entro workflow capture --type experience|correction --summary "..." [--details "..."] [--target reference|skills|agents]',
      'entro workflow list [--type experience|correction] [--state pending|kept|discarded|promoted]',
      'entro workflow review --card <id> --decision keep|discard|promote [--note "..."]',
      'entro workflow keep --card <id> [--note "..."]',
      'entro workflow discard --card <id> [--note "..."]',
      'entro workflow promote --card <id> [--target reference|skills|agents]',
      'entro workflow help',
    ],
    subcommands: [
      {
        name: 'install-codex',
        description: 'Install Codex assets for a selected workflow integration.',
      },
      {
        name: 'run',
        description: 'Start or resume the strict workflow runtime.',
      },
      {
        name: 'next',
        description: 'Advance the active strict workflow to the next stage.',
      },
      {
        name: 'status',
        description: 'Show the current strict workflow stage and next action.',
      },
      {
        name: 'capture',
        description: 'Capture a lightweight workflow knowledge card for later team review.',
      },
      {
        name: 'list',
        description: 'List captured workflow knowledge cards and their current review states.',
      },
      {
        name: 'review',
        description: 'Keep, discard, or promote a captured workflow knowledge card.',
      },
      {
        name: 'keep',
        description: 'Mark a captured workflow knowledge card as kept for team review.',
      },
      {
        name: 'discard',
        description: 'Discard a captured workflow knowledge card.',
      },
      {
        name: 'promote',
        description: 'Promote an agreed workflow knowledge card into publication bridge artifacts.',
      },
      {
        name: 'help',
        description: 'Show workflow command help.',
      },
    ],
  };
}

function countOpenQuestions(context) {
  const directory = path.join(context.paths.questions, 'open');
  if (!fs.existsSync(directory)) {
    return 0;
  }

  return fs.readdirSync(directory).filter(file => file.endsWith('.json')).length;
}

export {
  createWorkflowHelpResult,
  extractCommand,
  normalizeWorkflowIntegration,
  runCommand,
  workflowCommand,
};
