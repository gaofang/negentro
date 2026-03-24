import fs from 'fs';
import path from 'path';
import { uniqueBy } from '../shared/collections.js';

function buildFullAppScope(context) {
  const appRelativePath = path.relative(context.repoRoot, context.appRoot) || '.';
  return {
    id: 'app',
    label: '应用全域',
    paths: [appRelativePath],
    primaryRoots: [appRelativePath],
    excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
  };
}

function resolveTargetScopes(context, config, options, resolveScopes) {
  if (options['full-app']) {
    return [buildFullAppScope(context)];
  }
  return resolveScopes(config.scopes, options.scope);
}

async function discoverCommand(context, options, helpers) {
  const {
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
    persistAgentRun,
    printAgentRunSummaries,
    writeJson,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const config = readJson(path.join(context.paths.config, 'scopes.json')) || { scopes: [] };
  const catalog = readJson(path.join(context.paths.evidence, 'catalog', 'sources.json'));

  if (!catalog || !Array.isArray(catalog.sources)) {
    throw new Error('source catalog missing. Run `entro classify-sources` first.');
  }
  const targetScopes = options['full-app']
    ? deriveFullAppScopes(context, catalog.sources, { maxScopes: 8 })
    : resolveTargetScopes(context, config, options, resolveScopes);
  if (!targetScopes.length) {
    throw new Error('no scopes resolved. Check scopes config or rerun with `--full-app`.');
  }

  const taskResult = await runDiscoveryTask(context, {
    scopes: targetScopes,
    sources: catalog.sources,
    changedFiles: [],
    options,
  }, {
    loadDefaultProvider,
    discoverTopicsForScope,
    toRepoRelative,
    filterChangedFilesForScope,
    persistAgentRun,
  });
  const topics = taskResult.topics;
  printAgentRunSummaries(taskResult.runs);

  topics.forEach(topic => {
    writeJson(path.join(context.paths.candidates, 'topics', `${topic.id}.json`), topic);
  });

  console.log(`[entro] 已发现 ${topics.length} 个主题候选`);
}

async function distillCommand(context, options, helpers) {
  const {
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
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const summary = readJson(path.join(context.paths.evidence, 'repo-scan', 'workspace-summary.json'));
  if (!summary) {
    throw new Error('scan evidence missing. Run `entro scan` first.');
  }

  const config = readJson(path.join(context.paths.config, 'scopes.json')) || { scopes: [] };
  const owners = readJson(path.join(context.paths.config, 'owners.json')) || { owners: [] };
  const catalog = readJson(path.join(context.paths.evidence, 'catalog', 'sources.json'));

  if (!catalog || !Array.isArray(catalog.sources)) {
    throw new Error('source catalog missing. Run `entro classify-sources` first.');
  }
  const targetScopes = options['full-app']
    ? deriveFullAppScopes(context, catalog.sources, { maxScopes: 8 })
    : resolveTargetScopes(context, config, options, resolveScopes);
  if (!targetScopes.length) {
    throw new Error('no scopes resolved. Check scopes config or rerun with `--full-app`.');
  }

  if (options.scope || options['full-app']) {
    clearScopeGeneratedState(context, targetScopes);
  } else {
    clearGeneratedCandidateState(context);
    clearGeneratedOpenQuestions(context);
    clearScopeGeneratedState(context, config.scopes);
  }

  if (options['full-app']) {
    console.log(`[entro] full-app 分桶数：${targetScopes.length}`);
  }
  const merged = {
    topics: [],
    patterns: [],
    questions: [],
    cards: [],
    runs: [],
  };

  for (const scope of targetScopes) {
    const result = await runRepositoryDistillation(context, {
      scopes: [scope],
      owners,
      sources: catalog.sources,
      changedFiles: Boolean(options['changed-only']) ? summary.changedFiles || [] : [],
      options,
    }, {
      loadDefaultProvider,
      toRepoRelative,
      filterChangedFilesForScope,
      filterSourcesForScope,
      findOwner,
      createCard,
      createQuestion,
      renderEvidenceList,
      persistAgentRun,
    });

    merged.topics.push(...result.topics);
    merged.patterns.push(...result.patterns);
    merged.questions.push(...result.questions);
    merged.cards.push(...result.cards);
    merged.runs.push(...result.runs);
  }

  const result = {
    topics: uniqueBy(merged.topics, item => item.id),
    patterns: uniqueBy(merged.patterns, item => item.id),
    questions: uniqueBy(merged.questions, item => item.meta && item.meta.id),
    cards: uniqueBy(merged.cards, item => item.meta && item.meta.id),
    runs: merged.runs,
  };

  printAgentRunSummaries(result.runs);

  result.topics.forEach(topic => {
    writeJson(path.join(context.paths.candidates, 'topics', `${topic.id}.json`), topic);
  });
  result.patterns.forEach(pattern => {
    writeJson(path.join(context.paths.candidates, 'patterns', `${pattern.id}.json`), pattern);
  });
  result.questions.forEach(question => {
    writeJson(path.join(context.paths.candidates, 'questions', `${question.meta.id}.json`), question);
    upsertMinedQuestion(context, question);
  });
  result.cards.forEach(card => {
    upsertMinedCard(context, card);
  });
  syncOpenQuestionsReport(context);

  if (result.runs.length) {
    writeJson(path.join(context.paths.runs, 'agent', 'latest-distill-run.json'), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      appRoot: toRepoRelative(context, context.appRoot),
      runIds: result.runs.map(run => run.id),
      scopeIds: targetScopes.map(scope => scope.id),
    });
  }

  console.log(`[entro] 已蒸馏 ${result.topics.length} 个主题、${result.patterns.length} 个模式、${result.cards.length} 张卡片、${result.questions.length} 个问题`);
}

async function mineCommand(context, options, helpers) {
  return distillCommand(context, options, helpers);
}

export {
  discoverCommand,
  distillCommand,
  mineCommand,
};
