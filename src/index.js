import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { doctorCommand, installCodexCommand } from './commands/codex.js';
import { workflowCommand } from './commands/workflow.js';
import {
  applyConfirmedDefaultToCard,
  buildSyncPlan,
  createAnswer,
  createCard,
  createFollowUpQuestion,
  createQuestion,
  decisionToStatus,
  findCardPath,
  findQuestionPath,
  promoteRelatedCardsToNeedsReview,
  removeRelatedOpenFollowUpQuestions,
  dedupeOpenQuestionsByRoot,
  readAllCards,
  readCard,
  readCardsFromDirectory,
  renderAgents,
  renderEvidenceList,
  renderPublishReport,
  renderSkill,
  replaceExt,
  upsertMinedCard,
  upsertMinedQuestion,
  writeCardV2,
} from './domain/artifacts.js';
import { initCommand } from './services/app-init.js';
import {
  buildCodexInstallPlan,
  buildCodexPluginManifest,
  buildCodexPluginReadme,
  buildCodexSkillMarkdown,
  buildCodexSkillOpenAiYaml,
  normalizeCodexInstallMode,
  resolveCodexHome,
  resolveCodexIntegrationDefinition,
} from './services/codex-integration.js';
import {
  buildAnswerPayloadFromText,
  getLastAnswerRef,
  normalizeAnswer,
  promptForAnswer,
} from './services/hitl-runtime.js';
import {
  countQuestions,
  summarizePaths,
  summarizeState,
} from './services/json-state.js';
import {
  deriveFullAppScopes,
  discoverTopicsForScope,
  filterChangedFilesForScope,
  filterSourcesForScope,
  findOwner,
  resolveScopes,
} from './services/mining-heuristics.js';
import { createJsonErrorPayload, createJsonSuccessPayload, printJsonPayload } from './shared/json-output.js';
import {
  activateSeeds,
  ensureSeedsConfig,
  loadSeedRegistry,
  writeActiveSeedsSnapshot,
  writeMergedSeedsSnapshot,
} from './services/seed-registry.js';
import {
  clearGeneratedCandidateState,
  clearGeneratedOpenQuestions,
  clearScopeGeneratedState,
  migrateLegacyFiles,
  syncOpenQuestionsReport,
} from './services/state.js';
import { normalizeArray } from './shared/collections.js';
import { ensureDir, readJson, writeJson, writeText } from './shared/fs.js';
import { createContext, DEFAULT_ROOT, toRepoRelative } from './context.js';

const PACKAGE_VERSION = readPackageVersion();
const KNOWN_COMMANDS = new Set([
  'chat',
  'init',
  'extract',
  'question',
  'build',
  'run',
  'paths',
  'clean',
  'scan',
  'classify-sources',
  'discover',
  'distill',
  'mine',
  'seed-plan',
  'seed-extract',
  'answer',
  'reconcile',
  'review',
  'enrich',
  'publish',
  'consolidate',
  'diff',
  'doctor',
  'install-codex',
  'workflow',
  'help',
]);

async function run(argv) {
  const [firstToken, ...rest] = argv;
  const firstLooksLikeOption = !firstToken || String(firstToken).startsWith('--');
  const command = firstLooksLikeOption ? 'chat' : firstToken;
  const optionTokens = firstLooksLikeOption ? argv : rest;
  const options = parseOptions(optionTokens);
  const enterChat = shouldEnterChatMode(firstToken, options);
  const context = enterChat
    ? (options.app || options.root ? createContext(options.app || options.root || DEFAULT_ROOT) : null)
    : createContext(options.app || options.root || DEFAULT_ROOT);

  if (options.json) {
    return runJsonCommand(command, context, options, enterChat);
  }

  switch (command) {
    case 'chat':
      return runChatCommand(context, options);
    case 'init':
      return initCommand(context);
    case 'extract':
      return runExtractCommand(context, options);
    case 'build':
      return runBuildCommand(context, options);
    case 'run':
      return runWorkflowCommand(context, options);
    case 'paths':
      return printPaths(context);
    case 'clean':
      return cleanCommand(context, options);
    case 'scan':
      return runScanOnlyCommand(context, options);
    case 'classify-sources':
      return runClassifyOnlyCommand(context, options);
    case 'discover':
      return runDiscoverCommand(context, options);
    case 'distill':
      return runDistillCommand(context, options);
    case 'mine':
      return runMineCommand(context, options);
    case 'question':
      return runQuestionCommand(context, options);
    case 'seed-plan':
      return runSeedPlanCommand(context, options);
    case 'seed-extract':
      return runSeedExtractCommand(context, options);
    case 'answer':
      return runAnswerCommand(context, options);
    case 'reconcile':
      return runReconcileCommand(context, options);
    case 'review':
      return runReviewCommand(context, options);
    case 'enrich':
      return runEnrichCommand(context, options);
    case 'publish':
      return runPublishCommand(context, options);
    case 'consolidate':
      return runBuildCommand(context, options);
    case 'diff':
      return runDiffCommand(context, options);
    case 'doctor':
      printJsonPayload(createJsonSuccessPayload({
        command,
        data: doctorCommand(context, options, buildDoctorHelpers()),
      }));
      return;
    case 'install-codex': {
      const result = installCodexCommand(context, options, buildInstallCodexHelpers());
      console.log(`[entro] 已安装 Codex 集成：mode=${result.mode}, integration=${result.integration}`);
      if (result.installed.skill) {
        console.log(`[entro] skill: ${result.installed.skill.path}`);
      }
      if (result.installed.plugin) {
        console.log(`[entro] plugin: ${result.installed.plugin.path}`);
      }
      return;
    }
    case 'workflow':
      return runWorkflowEntryCommand(context, options);
    case 'help':
      return printHelp();
    default:
      if (enterChat) {
        return runChatCommand(context, options);
      }
      return printHelp();
  }
}

async function runChatCommand(context, options) {
  const { chatTuiCommand } = await import('./commands/chat-tui.js');
  return chatTuiCommand(context, options, await buildChatHelpers());
}

async function loadWorkflowModule() {
  return import('./commands/workflow.js');
}

async function loadHitlModule() {
  return import('./commands/hitl.js');
}

async function loadMiningModule() {
  return import('./commands/mining.js');
}

async function loadSeedsModule() {
  return import('./commands/seeds.js');
}

async function loadPublicationModule() {
  return import('./commands/publication.js');
}

async function loadRepoScanModule() {
  return import('./services/repo-scan.js');
}

async function loadAgentRuntimeModule() {
  return import('./services/agent-runtime.js');
}

async function loadConsolidationModule() {
  return import('./services/consolidation.js');
}

async function loadMiningTasksModule() {
  return import('./services/mining-tasks.js');
}

async function loadProviderConfigModule() {
  return import('./services/provider-config.js');
}

async function loadRunRecordsModule() {
  return import('./services/run-records.js');
}

async function loadSeedDistillModule() {
  return import('./services/seed-distill.js');
}

async function loadPublicationStateModule() {
  return import('./services/publication-state.js');
}

async function runExtractCommand(context, options) {
  const { extractCommand } = await loadWorkflowModule();
  return extractCommand(context, options, await buildExtractHelpers());
}

async function runBuildCommand(context, options) {
  const { consolidateCommand } = await loadPublicationModule();
  return consolidateCommand(context, options, await buildConsolidateHelpers());
}

async function runWorkflowCommand(context, options) {
  const { runCommand } = await loadWorkflowModule();
  return runCommand(context, options, await buildRunHelpers());
}

async function runWorkflowEntryCommand(context, options) {
  const result = workflowCommand(context, options, {
    installCodexCommand,
    installCodexHelpers: buildInstallCodexHelpers(),
    readJson,
    writeJson,
    ensureDir,
    promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
  });

  if (result?.subcommand === 'help') {
    console.log(
      [
        'entro workflow 子命令：',
        '  workflow install-codex [--integration entro-distill|strict-frontend-workflow] [--mode skill|plugin|both]',
        '  workflow run',
        '  workflow next',
        '  workflow status',
        '  workflow capture --type experience|correction --summary "..." [--details "..."] [--target reference|skills|agents]',
        '  workflow list [--type experience|correction] [--state pending|kept|discarded|promoted]',
        '  workflow review --card <id> --decision keep|discard|promote [--note "..."]',
        '  workflow promote --card <id> [--target reference|skills|agents]',
        '  workflow help',
      ].join('\n'),
    );
    return result;
  }

  printWorkflowEntryResult(result);
  return result;
}

function printWorkflowEntryResult(result) {
  if (!result) {
    return;
  }

  if (result.workflow) {
    const lines = [
      `[workflow] ${result.message || 'workflow updated'}`,
      `  stage: ${result.workflow.currentStage.name} (${result.workflow.currentStage.slug})`,
    ];

    if (result.workflow.nextStage) {
      lines.push(`  next: ${result.workflow.nextStage.name} (${result.workflow.nextStage.slug})`);
    }

    if (result.nextAction && result.nextAction.type) {
      lines.push(`  action: ${result.nextAction.type}`);
    }

    console.log(lines.join('\n'));
    return;
  }

  if (result.card) {
    const lines = [
      `[workflow] ${result.subcommand} ok`,
      `  card: ${result.card.id}`,
      `  type: ${result.card.type}`,
      `  state: ${result.card.reviewState}`,
    ];

    if (result.bridgeEntry) {
      lines.push(`  promoted: ${result.bridgeEntry.target}`);
    }

    console.log(lines.join('\n'));
    return;
  }

  if (Array.isArray(result.cards)) {
    console.log(`[workflow] listed ${result.cards.length} card(s)`);
    return;
  }

  if (result.install) {
    console.log(`[workflow] installed integration: ${result.integration}`);
    return;
  }

  console.log(result.message || '[workflow] done');
}

async function runScanOnlyCommand(context, options) {
  const { scanCommand } = await loadRepoScanModule();
  return scanCommand(context, options, buildScanHelpers());
}

async function runClassifyOnlyCommand(context, options) {
  const { classifySourcesCommand } = await loadRepoScanModule();
  return classifySourcesCommand(context, options, buildClassifyHelpers());
}

async function runDiscoverCommand(context, options) {
  const { discoverCommand } = await loadMiningModule();
  return discoverCommand(context, options, await buildDiscoverHelpers());
}

async function runDistillCommand(context, options) {
  const { distillCommand } = await loadMiningModule();
  return distillCommand(context, options, await buildMineHelpers());
}

async function runMineCommand(context, options) {
  const { mineCommand } = await loadMiningModule();
  return mineCommand(context, options, await buildMineHelpers());
}

async function runQuestionCommand(context, options) {
  const { questionCommand } = await loadHitlModule();
  return questionCommand(context, options, buildQuestionHelpers());
}

async function runSeedPlanCommand(context, options) {
  const { seedPlanCommand } = await loadSeedsModule();
  return seedPlanCommand(context, options, buildSeedPlanHelpers());
}

async function runSeedExtractCommand(context, options) {
  const { seedExtractCommand } = await loadSeedsModule();
  return seedExtractCommand(context, options, await buildSeedExtractHelpers());
}

async function runAnswerCommand(context, options) {
  const { answerCommand } = await loadHitlModule();
  return answerCommand(context, options, buildAnswerHelpers());
}

async function runReconcileCommand(context, options) {
  const { reconcileCommand } = await loadHitlModule();
  return reconcileCommand(context, options, buildReconcileHelpers());
}

async function runReviewCommand(context, options) {
  const { reviewCommand } = await loadHitlModule();
  return reviewCommand(context, options, buildReviewHelpers());
}

async function runEnrichCommand(context, options) {
  const { enrichCommand } = await loadHitlModule();
  return enrichCommand(context, options, buildEnrichHelpers());
}

async function runPublishCommand(context, options) {
  const { publishCommand } = await loadPublicationModule();
  return publishCommand(context, options, buildPublishHelpers());
}

async function runDiffCommand(context, options) {
  const { diffCommand } = await loadPublicationModule();
  return diffCommand(context, options, buildDiffHelpers());
}

async function runJsonCommand(command, context, options, enterChat) {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args) => {
    logs.push(args.map(item => String(item)).join(' '));
  };

  console.log = capture;
  console.error = capture;

  try {
    const data = await executeJsonCommand(command, context, options, enterChat);
    console.log = originalLog;
    console.error = originalError;
    printJsonPayload(createJsonSuccessPayload({
      command,
      data,
      logs,
    }));
  } catch (error) {
    console.log = originalLog;
    console.error = originalError;
    printJsonPayload(createJsonErrorPayload({
      command,
      error,
      logs,
    }));
    process.exitCode = 1;
  }
}

async function executeJsonCommand(command, context, options, enterChat) {
  switch (command) {
    case 'paths':
      return { paths: summarizePaths(context) };
    case 'doctor':
      return doctorCommand(context, options, buildDoctorHelpers());
    case 'install-codex':
      return installCodexCommand(context, options, buildInstallCodexHelpers());
    case 'workflow':
      return workflowCommand(context, options, {
        installCodexCommand,
        installCodexHelpers: buildInstallCodexHelpers(),
        readJson,
        writeJson,
        ensureDir,
        promptArtifactPath: path.join(context.repoRoot, 'prompts', 'workflow_main.md'),
      });
    case 'run':
      await runWorkflowCommand(context, options);
      return {
        phase: countQuestions(context, 'open') > 0 ? 'needs_human' : 'ready_to_build',
        state: summarizeState(context, readJson),
      };
    case 'build':
      await runBuildCommand(context, options);
      return {
        phase: 'built',
        state: summarizeState(context, readJson),
      };
    case 'question': {
      const action = (options._ && options._[0]) || 'list';
      if (action === 'next') {
        return {
          question: summarizeState(context, readJson).questions.next,
          state: summarizeState(context, readJson),
        };
      }
      await runQuestionCommand(context, options);
      return {
        state: summarizeState(context, readJson),
      };
    }
    case 'answer':
      await runAnswerCommand(context, options);
      return {
        state: summarizeState(context, readJson),
      };
    case 'reconcile':
      await runReconcileCommand(context, options);
      return {
        state: summarizeState(context, readJson),
      };
    case 'clean':
      cleanCommand(context, options);
      return {
        paths: summarizePaths(context),
      };
    case 'chat':
      if (enterChat) {
        return {
          phase: 'chat_requested',
          mode: 'json',
          message: 'JSON 模式下不进入交互式聊天，请改用 run/question/answer/build 等结构化命令。',
        };
      }
      return {
        phase: 'noop',
      };
    default:
      throw new Error(`command ${command} does not support --json yet`);
  }
}

function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith('--')) {
      if (!options._) {
        options._ = [];
      }
      options._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    const hasValue = next && !next.startsWith('--');

    if (hasValue) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return options;
}

function ensureInitialized(context) {
  if (!context || !context.entroRoot || !context.appRoot) {
    throw new Error('entro context is invalid');
  }

  if (!fs.existsSync(context.entroRoot) || !hasAnyInitializationState(context)) {
    throw new Error('entro is not initialized. Run `entro init` first.');
  }
}

function ensureInitializedOrInit(context, runner) {
  if (!fs.existsSync(context.entroRoot) || !hasAnyInitializationState(context)) {
    initCommand(context);
  }
  return runner();
}

function hasAnyInitializationState(context) {
  return (
    fs.existsSync(context.configRoot) ||
    fs.existsSync(path.join(context.legacySystemRoot, 'config')) ||
    fs.existsSync(path.join(context.entroRoot, 'config'))
  );
}

function shouldEnterChatMode(firstToken, options) {
  if (options['no-chat']) {
    return false;
  }

  if (!firstToken) {
    return true;
  }

  if (String(firstToken).startsWith('--')) {
    return true;
  }

  return !KNOWN_COMMANDS.has(firstToken);
}

function printHelp() {
  console.log(
    [
      'entro 主命令：',
      '  chat',
      '  init',
      '  extract',
      '  question [list|ask|next --id <questionId>]',
      '  answer --question <id> --text <reply>',
      '  reconcile --question <id>',
      '  build',
      '  run',
      '  doctor [--json]',
      '  install-codex [--mode skill|plugin|both] [--integration entro-distill|strict-frontend-workflow]',
      '  workflow <install-codex|run|next|status|capture|list|review|promote|help>',
      '  paths [--json]',
      '  clean [--all]',
      '',
      '直接执行 `entro` 会进入安全文本对话模式。',
      '如需启用 Ink 终端界面，请显式追加 `--tui`。',
      'Codex 编排时，优先使用 `--json`。',
      '',
      '调试命令：',
      '  scan [--scope <scope>] [--changed-only --base <ref>]',
      '  classify-sources',
      '  mine [--scope <scope>] [--full-app]',
      '  seed-plan',
      '  seed-extract [--seed <seedId>]',
      '  review --card <cardId> --decision <approve|reject|deprecate> [--note <note>]',
      '  enrich',
      '  consolidate [--statuses draft,needs-review,approved]',
      '  publish [--dry-run]',
      '  diff',
    ].join('\n'),
  );
}

function printPaths(context) {
  console.log(
    [
      '[entro] paths',
      `  app: ${context.appRoot}`,
      `  config: ${context.configRoot}`,
      `  output: ${context.outputRoot}`,
      `  runtime: ${context.runtimeRoot}`,
    ].join('\n'),
  );
}

function cleanCommand(context, options) {
  if (fs.existsSync(context.runtimeRoot)) {
    fs.rmSync(context.runtimeRoot, { recursive: true, force: true });
  }
  if (options.all && fs.existsSync(context.outputRoot)) {
    fs.rmSync(context.outputRoot, { recursive: true, force: true });
  }

  console.log(
    `[entro] cleaned ${options.all ? 'runtime + output' : 'runtime'} for ${context.appRoot}`
  );
}

function isInitialized(context) {
  return Boolean(context && fs.existsSync(context.entroRoot) && hasAnyInitializationState(context));
}

function buildScanHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    writeJson,
    toRepoRelative,
  };
}

function buildClassifyHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    writeJson,
    toRepoRelative,
  };
}

function buildSeedPlanHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    ensureSeedsConfig,
    loadSeedRegistry,
    writeMergedSeedsSnapshot,
    activateSeeds,
    writeActiveSeedsSnapshot,
  };
}

async function buildSeedExtractHelpers() {
  const [{ loadDefaultProvider }, { executeAgentTask, buildAgentSummary }, { persistAgentRun }, seedDistill] =
    await Promise.all([
      loadProviderConfigModule(),
      loadAgentRuntimeModule(),
      loadRunRecordsModule(),
      loadSeedDistillModule(),
    ]);

  return {
    ensureInitialized,
    migrateLegacyFiles,
    ensureSeedsConfig,
    loadSeedRegistry,
    activateSeeds,
    readCardsFromDirectory,
    loadDefaultProvider,
    executeAgentTask,
    buildAgentSummary,
    persistAgentRun,
    buildSeedExtractionInput: seedDistill.buildSeedExtractionInput,
    buildSeedExtractionSchema: seedDistill.buildSeedExtractionSchema,
    normalizeSeedExtractionResult: seedDistill.normalizeSeedExtractionResult,
    writeSeedDistillArtifacts: seedDistill.writeSeedDistillArtifacts,
    writeResolvedSeed: seedDistill.writeResolvedSeed,
    createSeedQuestionDocument: seedDistill.createSeedQuestionDocument,
    writeJson,
    syncOpenQuestionsReport,
  };
}

async function buildExtractHelpers() {
  return {
    ensureInitializedOrInit,
    runScanCommand: (await loadRepoScanModule()).scanCommand,
    runClassifySourcesCommand: (await loadRepoScanModule()).classifySourcesCommand,
    seedPlanCommand: (await loadSeedsModule()).seedPlanCommand,
    seedExtractCommand: (await loadSeedsModule()).seedExtractCommand,
    scanHelpers: buildScanHelpers(),
    classifyHelpers: buildClassifyHelpers(),
    seedPlanHelpers: buildSeedPlanHelpers(),
    seedExtractHelpers: await buildSeedExtractHelpers(),
  };
}

async function buildConsolidateHelpers() {
  const [
    consolidation,
    { loadDefaultProvider },
    { executeAgentTask, buildAgentSummary },
    { persistAgentRun },
    publicationState,
  ] = await Promise.all([
    loadConsolidationModule(),
    loadProviderConfigModule(),
    loadAgentRuntimeModule(),
    loadRunRecordsModule(),
    loadPublicationStateModule(),
  ]);

  return {
    ensureInitialized,
    migrateLegacyFiles,
    readCardsFromDirectory,
    readJson,
    buildConsolidationInput: consolidation.buildConsolidationInput,
    buildConsolidationSchema: consolidation.buildConsolidationSchema,
    normalizeConsolidationResult: consolidation.normalizeConsolidationResult,
    renderAgentsDocument: consolidation.renderAgentsDocument,
    renderSkillDocument: consolidation.renderSkillDocument,
    createConsolidatedQuestionDocument: consolidation.createConsolidatedQuestionDocument,
    ensureDir,
    writeText,
    writeJson,
    loadDefaultProvider,
    executeAgentTask,
    buildAgentSummary,
    persistAgentRun,
    renderConsolidatedQuestions: consolidation.renderConsolidatedQuestions,
    buildConsolidationOutputPaths: consolidation.buildConsolidationOutputPaths,
    buildPublicationModel: publicationState.buildPublicationModel,
    applyPublicationModel: publicationState.applyPublicationModel,
  };
}

async function buildRunHelpers() {
  const { extractCommand, runCommand } = await loadWorkflowModule();
  const { consolidateCommand } = await loadPublicationModule();
  return {
    ensureInitializedOrInit,
    extractCommand,
    consolidateCommand,
    runCommand,
    extractHelpers: await buildExtractHelpers(),
    buildHelpers: await buildConsolidateHelpers(),
  };
}

async function buildMineHelpers() {
  const [
    { loadDefaultProvider },
    { runRepositoryDistillation },
    { executeAgentTask, buildAgentSummary, printAgentRunSummaries },
    { persistAgentRun },
  ] = await Promise.all([
    loadProviderConfigModule(),
    loadMiningTasksModule(),
    loadAgentRuntimeModule(),
    loadRunRecordsModule(),
  ]);

  return {
    ensureInitialized,
    migrateLegacyFiles,
    clearGeneratedCandidateState,
    clearGeneratedOpenQuestions,
    clearScopeGeneratedState,
    readJson,
    resolveScopes,
    deriveFullAppScopes,
    runRepositoryDistillation,
    loadDefaultProvider,
    toRepoRelative,
    filterChangedFilesForScope,
    filterSourcesForScope,
    findOwner,
    createCard,
    createQuestion,
    renderEvidenceList,
    persistAgentRun,
    printAgentRunSummaries,
    writeJson,
    upsertMinedQuestion,
    upsertMinedCard,
    syncOpenQuestionsReport,
  };
}

async function buildDiscoverHelpers() {
  const [
    { loadDefaultProvider },
    { runDiscoveryTask },
    { persistAgentRun },
    { printAgentRunSummaries },
  ] = await Promise.all([
    loadProviderConfigModule(),
    loadMiningTasksModule(),
    loadRunRecordsModule(),
    loadAgentRuntimeModule(),
  ]);

  return {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    resolveScopes,
    deriveFullAppScopes,
    runDiscoveryTask,
    loadDefaultProvider,
    discoverTopicsForScope,
    toRepoRelative,
    filterChangedFilesForScope,
    filterSourcesForScope,
    persistAgentRun,
    printAgentRunSummaries,
    writeJson,
  };
}

function buildQuestionHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    findQuestionPath,
    normalizeArray,
  };
}

function buildAnswerHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    findQuestionPath,
    readJson,
    buildAnswerPayloadFromText,
    promptForAnswer,
    createAnswer,
    writeJson,
    syncOpenQuestionsReport,
  };
}

function buildReconcileHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    findQuestionPath,
    readJson,
    getLastAnswerRef,
    normalizeAnswer,
    writeJson,
    promoteRelatedCardsToNeedsReview,
    syncOpenQuestionsReport,
    createFollowUpQuestion,
    removeRelatedOpenFollowUpQuestions,
    removeQuestionFamily,
  };
}

function buildReviewHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    findCardPath,
    readCard,
    decisionToStatus,
    writeCardV2,
  };
}

function buildEnrichHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    normalizeArray,
    findCardPath,
    readCard,
    applyConfirmedDefaultToCard,
    writeCardV2,
    replaceExt,
    writeJson,
  };
}

function buildPublishHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    readCardsFromDirectory,
    renderAgents,
    renderSkill,
    ensureDir,
    writeText,
    writeJson,
    buildSyncPlan,
    renderPublishReport,
    syncOpenQuestionsReport,
  };
}

function buildDiffHelpers() {
  return {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    readAllCards,
    filterChangedFilesForScope,
    normalizeArray,
    writeJson,
  };
}

function buildDoctorHelpers() {
  return {
    summarizeState,
    summarizePaths,
    isInitialized,
    readJson,
  };
}

function buildInstallCodexHelpers() {
  return {
    ensureDir,
    writeJson,
    writeText,
    resolveCodexHome,
    normalizeCodexInstallMode,
    buildCodexInstallPlan,
    buildCodexPluginManifest,
    buildCodexPluginReadme,
    buildCodexSkillMarkdown,
    buildCodexSkillOpenAiYaml,
    resolveCodexIntegrationDefinition,
    packageVersion: PACKAGE_VERSION,
  };
}

async function buildChatHelpers() {
  const [{ extractCommand, runCommand }, { consolidateCommand }, { answerCommand, reconcileCommand }] =
    await Promise.all([
      loadWorkflowModule(),
      loadPublicationModule(),
      loadHitlModule(),
    ]);

  return {
    ensureInitialized,
    ensureInitializedOrInit,
    migrateLegacyFiles,
    readJson,
    findQuestionPath,
    dedupeOpenQuestionsByRoot,
    writeJson,
    ensureSeedsConfig,
    loadSeedRegistry,
    activateSeeds,
    printPaths,
    cleanCommand,
    extractCommand,
    consolidateCommand,
    runCommand,
    answerCommand,
    reconcileCommand,
    extractHelpers: await buildExtractHelpers(),
    buildHelpers: await buildConsolidateHelpers(),
    runHelpers: await buildRunHelpers(),
    answerHelpers: buildAnswerHelpers(),
    reconcileHelpers: buildReconcileHelpers(),
  };
}

function readPackageVersion() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(currentDir, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version || '0.0.0';
}

export { run };
