import fs from 'fs';

import { answerCommand, enrichCommand, questionCommand, reconcileCommand, reviewCommand } from './commands/hitl.js';
import { discoverCommand, distillCommand, mineCommand } from './commands/mining.js';
import { consolidateCommand, diffCommand, publishCommand } from './commands/publication.js';
import { seedExtractCommand, seedPlanCommand } from './commands/seeds.js';
import { extractCommand, runCommand } from './commands/workflow.js';
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
import { printAgentRunSummaries } from './services/agent-runtime.js';
import { buildAgentSummary, executeAgentTask } from './services/agent-runtime.js';
import { initCommand } from './services/app-init.js';
import {
  buildAnswerPayloadFromText,
  getLastAnswerRef,
  normalizeAnswer,
  promptForAnswer,
} from './services/hitl-runtime.js';
import {
  deriveFullAppScopes,
  discoverTopicsForScope,
  filterChangedFilesForScope,
  filterSourcesForScope,
  findOwner,
  resolveScopes,
} from './services/mining-heuristics.js';
import { runDiscoveryTask, runRepositoryDistillation } from './services/mining-tasks.js';
import { loadDefaultProvider } from './services/provider-config.js';
import {
  classifySourcesCommand as runClassifySourcesCommand,
  scanCommand as runScanCommand,
} from './services/repo-scan.js';
import { persistAgentRun } from './services/run-records.js';
import {
  activateSeeds,
  ensureSeedsConfig,
  loadSeedRegistry,
  writeActiveSeedsSnapshot,
  writeMergedSeedsSnapshot,
} from './services/seed-registry.js';
import {
  buildConsolidationOutputPaths,
  buildConsolidationInput,
  buildConsolidationSchema,
  createConsolidatedQuestionDocument,
  normalizeConsolidationResult,
  renderAgentsDocument,
  renderSkillDocument,
  renderConsolidatedQuestions,
} from './services/consolidation.js';
import {
  buildSeedExtractionInput,
  buildSeedExtractionSchema,
  buildSeedPlan,
  createSeedQuestionDocument,
  normalizeSeedExtractionResult,
  writeResolvedSeed,
  writeSeedDistillArtifacts,
} from './services/seed-distill.js';
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

async function run(argv) {
  const [command = 'help', ...rest] = argv;
  const options = parseOptions(rest);
  const context = createContext(options.app || options.root || DEFAULT_ROOT);

  switch (command) {
    case 'init':
      return initCommand(context);
    case 'extract':
      return extractCommand(context, options, {
        ensureInitializedOrInit,
        runScanCommand,
        runClassifySourcesCommand,
        seedPlanCommand,
        seedExtractCommand,
        scanHelpers: {
          ensureInitialized,
          migrateLegacyFiles,
          writeJson,
          toRepoRelative,
        },
        classifyHelpers: {
          ensureInitialized,
          migrateLegacyFiles,
          readJson,
          writeJson,
          toRepoRelative,
        },
        seedPlanHelpers: {
          ensureInitialized,
          migrateLegacyFiles,
          ensureSeedsConfig,
          loadSeedRegistry,
          writeMergedSeedsSnapshot,
          activateSeeds,
          writeActiveSeedsSnapshot,
        },
        seedExtractHelpers: {
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
          buildSeedExtractionInput,
          buildSeedExtractionSchema,
          normalizeSeedExtractionResult,
          writeSeedDistillArtifacts,
          writeResolvedSeed,
          createSeedQuestionDocument,
          writeJson,
          syncOpenQuestionsReport,
        },
      });
    case 'build':
      return consolidateCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readCardsFromDirectory,
        readJson,
        buildConsolidationInput,
        buildConsolidationSchema,
        normalizeConsolidationResult,
        renderAgentsDocument,
        renderSkillDocument,
        createConsolidatedQuestionDocument,
        ensureDir,
        writeText,
        writeJson,
        loadDefaultProvider,
        executeAgentTask,
        buildAgentSummary,
        persistAgentRun,
        renderConsolidatedQuestions,
        buildConsolidationOutputPaths,
      });
    case 'run':
      return runCommand(context, options, {
        ensureInitializedOrInit,
        extractCommand,
        consolidateCommand,
        extractHelpers: {
          ensureInitializedOrInit,
          runScanCommand,
          runClassifySourcesCommand,
          seedPlanCommand,
          seedExtractCommand,
          scanHelpers: {
            ensureInitialized,
            migrateLegacyFiles,
            writeJson,
            toRepoRelative,
          },
          classifyHelpers: {
            ensureInitialized,
            migrateLegacyFiles,
            readJson,
            writeJson,
            toRepoRelative,
          },
          seedPlanHelpers: {
            ensureInitialized,
            migrateLegacyFiles,
            ensureSeedsConfig,
            loadSeedRegistry,
            writeMergedSeedsSnapshot,
            activateSeeds,
            writeActiveSeedsSnapshot,
          },
          seedExtractHelpers: {
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
            buildSeedExtractionInput,
            buildSeedExtractionSchema,
            normalizeSeedExtractionResult,
            writeSeedDistillArtifacts,
            writeResolvedSeed,
            createSeedQuestionDocument,
            writeJson,
            syncOpenQuestionsReport,
          },
        },
        buildHelpers: {
          ensureInitialized,
          migrateLegacyFiles,
          readCardsFromDirectory,
          readJson,
          buildConsolidationInput,
          buildConsolidationSchema,
          normalizeConsolidationResult,
          renderAgentsDocument,
          renderSkillDocument,
          createConsolidatedQuestionDocument,
          ensureDir,
          writeText,
          writeJson,
          loadDefaultProvider,
          executeAgentTask,
          buildAgentSummary,
          persistAgentRun,
          renderConsolidatedQuestions,
          buildConsolidationOutputPaths,
        },
      });
    case 'scan':
      return runScanCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        writeJson,
        toRepoRelative,
      });
    case 'classify-sources':
      return runClassifySourcesCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        writeJson,
        toRepoRelative,
      });
    case 'discover':
      return discoverCommand(context, options, {
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
      });
    case 'distill':
      return distillCommand(context, options, {
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
      });
    case 'mine':
      return mineCommand(context, options, {
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
      });
    case 'question':
      return questionCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        findQuestionPath,
        normalizeArray,
      });
    case 'seed-plan':
      return seedPlanCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        ensureSeedsConfig,
        loadSeedRegistry,
        writeMergedSeedsSnapshot,
        activateSeeds,
        writeActiveSeedsSnapshot,
      });
    case 'seed-extract':
      return seedExtractCommand(context, options, {
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
        buildSeedExtractionInput,
        buildSeedExtractionSchema,
        normalizeSeedExtractionResult,
        writeSeedDistillArtifacts,
        writeResolvedSeed,
        writeJson,
      });
    case 'answer':
      return answerCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        findQuestionPath,
        readJson,
        buildAnswerPayloadFromText,
        promptForAnswer,
        createAnswer,
        writeJson,
        syncOpenQuestionsReport,
      });
    case 'reconcile':
      return reconcileCommand(context, options, {
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
      });
    case 'review':
      return reviewCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        findCardPath,
        readCard,
        decisionToStatus,
        writeCardV2,
      });
    case 'enrich':
      return enrichCommand(context, options, {
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
      });
    case 'publish':
      return publishCommand(context, options, {
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
      });
    case 'consolidate':
      return consolidateCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readCardsFromDirectory,
        readJson,
        buildConsolidationInput,
        buildConsolidationSchema,
        normalizeConsolidationResult,
        renderAgentsDocument,
        renderSkillDocument,
        createConsolidatedQuestionDocument,
        ensureDir,
        writeText,
        writeJson,
        loadDefaultProvider,
        executeAgentTask,
        buildAgentSummary,
        persistAgentRun,
        renderConsolidatedQuestions,
        buildConsolidationOutputPaths,
      });
    case 'diff':
      return diffCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        readAllCards,
        filterChangedFilesForScope,
        normalizeArray,
        writeJson,
      });
    case 'help':
    default:
      return printHelp();
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

  if (!fs.existsSync(context.entroRoot)) {
    throw new Error('entro is not initialized. Run `entro init` first.');
  }
}

function ensureInitializedOrInit(context, runner) {
  if (!fs.existsSync(context.entroRoot)) {
    initCommand(context);
  }
  return runner();
}

function printHelp() {
  console.log(
    [
      'entro 主命令：',
      '  init',
      '  extract',
      '  question [list|ask --id <questionId>]',
      '  build',
      '  run',
      '',
      '调试命令：',
      '  scan [--scope <scope>] [--changed-only --base <ref>]',
      '  classify-sources',
      '  mine [--scope <scope>] [--full-app]',
      '  seed-plan',
      '  seed-extract [--seed <seedId>]',
      '  answer --question <questionId> [--text <answer>]',
      '  reconcile --question <questionId> [--answer <answerId>]',
      '  review --card <cardId> --decision <approve|reject|deprecate> [--note <note>]',
      '  enrich',
      '  consolidate [--statuses draft,needs-review,approved]',
      '  publish [--dry-run]',
      '  diff',
    ].join('\n'),
  );
}

export { run };
