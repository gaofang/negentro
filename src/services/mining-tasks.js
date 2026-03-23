import { normalizeArray } from '../shared/collections.js';
import {
  readBuiltinPrompt,
  executeAgentTask,
  buildAgentSummary,
} from './agent-runtime.js';
import {
  buildRepositoryDistillationInput,
  buildRepositoryDistillationSchema,
  buildTopicDiscoveryInput,
  buildPatternMiningInput,
  buildEvidenceBundleForScope,
  buildEvidenceBundleFromRefs,
  buildTopicDiscoverySchema,
  buildPatternMiningSchema,
  normalizeTopicsFromAgent,
  normalizePatternsFromAgent,
  normalizeDistillationResult,
} from './distill.js';

async function runDiscoveryTask(context, { scopes, sources, changedFiles, options }, helpers) {
  const {
    loadDefaultProvider,
    discoverTopicsForScope,
    toRepoRelative,
    filterChangedFilesForScope,
    filterSourcesForScope,
    persistAgentRun,
  } = helpers;

  const provider = loadDefaultProvider(context);
  const fallbackTopics = normalizeArray(scopes).flatMap(scope =>
    discoverTopicsForScope(scope, sources, changedFiles)
  );
  const promptInput = buildTopicDiscoveryInput(context, scopes, sources, changedFiles, {
    toRepoRelative,
    filterChangedFilesForScope,
    buildEvidenceBundleForScope,
    filterSourcesForScope,
  });
  const agentAttempt = await executeAgentTask(context, {
    stage: 'discover',
    provider,
    promptFile: 'topic_discovery.md',
    promptInput,
    outputSchema: buildTopicDiscoverySchema(),
  });
  const topics = normalizeTopicsFromAgent(agentAttempt.parsed, scopes, fallbackTopics);
  const run = persistAgentRun(context, {
    stage: 'discover',
    provider,
    input: promptInput,
    output: {
      topics,
      strategy: agentAttempt.ok ? 'agent-primary' : 'heuristic-fallback',
      agent: buildAgentSummary(agentAttempt),
    },
    options,
  });

  return {
    topics,
    runs: [run],
  };
}

async function runPatternMiningTask(context, { scope, topics, changedFiles, options }, helpers) {
  const {
    loadDefaultProvider,
    buildPatternCandidates,
    toRepoRelative,
    filterChangedFilesForScope,
    persistAgentRun,
  } = helpers;

  const provider = loadDefaultProvider(context);
  const fallbackPatterns = buildPatternCandidates(scope, topics);
  const promptInput = buildPatternMiningInput(context, scope, topics, changedFiles, {
    toRepoRelative,
    filterChangedFilesForScope,
    buildEvidenceBundleFromRefs,
  });
  const agentAttempt = await executeAgentTask(context, {
    stage: 'pattern_mining',
    provider,
    promptFile: 'pattern_mining.md',
    promptInput,
    outputSchema: buildPatternMiningSchema(),
  });
  const patterns = normalizePatternsFromAgent(agentAttempt.parsed, scope, fallbackPatterns);
  const run = persistAgentRun(context, {
    stage: 'pattern_mining',
    provider,
    input: promptInput,
    output: {
      patterns,
      strategy: agentAttempt.ok ? 'agent-primary' : 'heuristic-fallback',
      agent: buildAgentSummary(agentAttempt),
    },
    options,
  });

  return {
    patterns,
    runs: [run],
  };
}

function runQuestionGenerationTask(context, { scope, patterns, changedFiles, options, owner }, helpers) {
  const { loadDefaultProvider, buildQuestionsFromPatterns, persistAgentRun } = helpers;
  const provider = loadDefaultProvider(context);
  const questions = buildQuestionsFromPatterns(scope, patterns, owner);
  const run = persistAgentRun(context, {
    stage: 'question_generation',
    provider,
    input: {
      scope: {
        id: scope.id,
        label: scope.label,
      },
      changedFiles,
      patterns,
      promptTemplate: readBuiltinPrompt('question_generation.md'),
    },
    output: {
      questions,
      strategy: 'heuristic-fallback',
    },
    options,
  });

  return {
    questions,
    runs: [run],
  };
}

function runCardSynthesisTask(context, { scope, patterns, owner, changedFiles, options }, helpers) {
  const { loadDefaultProvider, buildScopeCardsFromPatterns, persistAgentRun } = helpers;
  const provider = loadDefaultProvider(context);
  const cards = buildScopeCardsFromPatterns(scope, patterns, { owner, changedFiles });
  const run = persistAgentRun(context, {
    stage: 'card_synthesis',
    provider,
    input: {
      scope: {
        id: scope.id,
        label: scope.label,
      },
      changedFiles,
      patterns,
      owner,
      promptTemplate: readBuiltinPrompt('card_synthesis.md'),
    },
    output: {
      cards,
      strategy: 'heuristic-fallback',
    },
    options,
  });

  return {
    cards,
    runs: [run],
  };
}

async function runRepositoryDistillation(context, { scopes, owners, sources, changedFiles, options }, helpers) {
  const {
    loadDefaultProvider,
    toRepoRelative,
    filterChangedFilesForScope,
    filterSourcesForScope,
    findOwner,
    createCard,
    createQuestion,
    renderEvidenceList,
    persistAgentRun,
  } = helpers;

  const provider = loadDefaultProvider(context);
  const promptInput = buildRepositoryDistillationInput(context, scopes, owners, sources, changedFiles, {
    toRepoRelative,
    filterChangedFilesForScope,
    buildEvidenceBundleForScope,
    filterSourcesForScope,
    findOwner,
  });
  const agentAttempt = await executeAgentTask(context, {
    stage: 'distill',
    provider,
    promptFile: 'repository_distillation.md',
    promptInput,
    outputSchema: buildRepositoryDistillationSchema(),
  });

  if (!agentAttempt.ok) {
    throw new Error(`distillation failed: ${agentAttempt.providerError || 'unknown provider error'}`);
  }

  const normalized = normalizeDistillationResult(scopes, owners, agentAttempt.parsed, {
    createCard,
    createQuestion,
    renderEvidenceList,
    findOwner,
  });
  const run = persistAgentRun(context, {
    stage: 'distill',
    provider,
    input: promptInput,
    output: {
      ...normalized,
      strategy: 'agent-primary',
      agent: buildAgentSummary(agentAttempt),
    },
    options,
  });

  return {
    ...normalized,
    runs: [run],
  };
}

export {
  runDiscoveryTask,
  runPatternMiningTask,
  runQuestionGenerationTask,
  runCardSynthesisTask,
  runRepositoryDistillation,
};
