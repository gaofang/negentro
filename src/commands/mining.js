import fs from 'fs';
import path from 'path';

async function discoverCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    resolveScopes,
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
  const targetScopes = resolveScopes(config.scopes, options.scope);
  const catalog = readJson(path.join(context.paths.evidence, 'catalog', 'sources.json'));

  if (!catalog || !Array.isArray(catalog.sources)) {
    throw new Error('source catalog missing. Run `entro classify-sources` first.');
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
    readJson,
    resolveScopes,
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
  clearGeneratedCandidateState(context);
  clearGeneratedOpenQuestions(context);

  const summary = readJson(path.join(context.paths.evidence, 'repo-scan', 'workspace-summary.json'));
  if (!summary) {
    throw new Error('scan evidence missing. Run `entro scan` first.');
  }

  const config = readJson(path.join(context.paths.config, 'scopes.json')) || { scopes: [] };
  const owners = readJson(path.join(context.paths.config, 'owners.json')) || { owners: [] };
  const targetScopes = resolveScopes(config.scopes, options.scope);
  const catalog = readJson(path.join(context.paths.evidence, 'catalog', 'sources.json'));

  if (!catalog || !Array.isArray(catalog.sources)) {
    throw new Error('source catalog missing. Run `entro classify-sources` first.');
  }

  const result = await runRepositoryDistillation(context, {
    scopes: targetScopes,
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
