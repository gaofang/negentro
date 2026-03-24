import path from 'path';
import fs from 'fs';

async function consolidateCommand(context, options, helpers) {
  const {
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
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const statuses = normalizeStatuses(options.statuses || 'draft,needs-review,approved');
  const cards = statuses.flatMap(status => readCardsFromDirectory(path.join(context.paths.cards, status)));
  const openQuestionsDir = path.join(context.paths.questions, 'open');
  const openQuestions = fs.existsSync(openQuestionsDir)
    ? fs.readdirSync(openQuestionsDir)
        .filter(file => file.endsWith('.json'))
        .map(file => readJson(path.join(openQuestionsDir, file)))
        .filter(Boolean)
    : [];
  const provider = loadDefaultProvider(context);
  const promptInput = buildConsolidationInput(context, cards, openQuestions);
  const agentAttempt = await executeAgentTask(context, {
    stage: 'consolidate',
    provider,
    promptFile: 'artifact_consolidation.md',
    promptInput,
    outputSchema: buildConsolidationSchema(),
  });

  if (!agentAttempt.ok) {
    throw new Error(`consolidation failed: ${agentAttempt.providerError || 'unknown provider error'}`);
  }

  const normalized = normalizeConsolidationResult(agentAttempt.parsed);
  const consolidatedQuestions = normalized.consolidatedQuestions;
  const outputPaths = buildConsolidationOutputPaths(context);

  removeLegacyConsolidationOutputs(context);
  resetDirectoryContents(outputPaths.skillDir);
  resetDirectoryContents(outputPaths.questionsDir);
  ensureDir(path.dirname(outputPaths.report));
  ensureDir(path.dirname(outputPaths.questionsReport));
  writeText(outputPaths.agents, renderAgentsDocument(normalized.agentsDocument));
  ensureDir(outputPaths.skillDir);
  ensureDir(outputPaths.questionsDir);
  normalized.skills.forEach(skill => {
    const skillDir = path.join(outputPaths.skillDir, skill.id);
    ensureDir(skillDir);
    writeText(path.join(skillDir, 'SKILL.md'), renderSkillDocument(skill));
  });
  consolidatedQuestions.forEach(question => {
    writeJson(path.join(outputPaths.questionsDir, `${question.id}.json`), createConsolidatedQuestionDocument(question));
  });
  writeText(outputPaths.questionsReport, renderConsolidatedQuestions(consolidatedQuestions));

  const run = persistAgentRun(context, {
    stage: 'consolidate',
    provider,
    input: promptInput,
    output: {
      agentsDocument: normalized.agentsDocument,
      skills: normalized.skills,
      consolidatedQuestions,
      strategy: 'agent-primary',
      agent: buildAgentSummary(agentAttempt),
    },
    options,
  });

  writeJson(outputPaths.report, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceStatuses: statuses,
    inputCardCount: cards.length,
    agentRunId: run.id,
    agentsDocument: {
      title: normalized.agentsDocument.title,
      sectionCount: normalized.agentsDocument.sections.length,
      evidenceRefs: normalized.agentsDocument.evidenceRefs,
    },
    consolidatedSkills: normalized.skills.map(skill => ({
      id: skill.id,
      title: skill.title,
      from: skill.sourceCardIds || [],
    })),
    consolidatedQuestions: consolidatedQuestions.map(question => ({
      id: question.id,
      title: question.title,
      from: question.relatedCardIds || [],
    })),
  });

  console.log(`[entro] 已归并 ${cards.length} 张卡片，生成 1 份 AGENTS 草案、${normalized.skills.length} 个 skill 草案，并收敛 ${consolidatedQuestions.length} 个待确认问题`);
}

function normalizeStatuses(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function resetDirectoryContents(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const currentPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(currentPath, { recursive: true, force: true });
      return;
    }
    fs.unlinkSync(currentPath);
  });
}

function removeLegacyConsolidationOutputs(context) {
  const legacyPaths = [
    path.join(context.paths.publications, 'AGENTS.consolidated.md'),
    path.join(context.paths.publications, 'questions-consolidated.md'),
    path.join(context.paths.publications, 'questions-consolidated'),
    path.join(context.paths.publications, 'skills-consolidated'),
    path.join(context.paths.publications, '.AGENTS.consolidated.md.swp'),
    path.join(context.paths.publications, 'reports', 'latest-consolidation-report.json'),
  ];

  legacyPaths.forEach(targetPath => {
    if (!fs.existsSync(targetPath)) {
      return;
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
  });
}

function publishCommand(context, options, helpers) {
  const {
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
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const publishRules = readJson(path.join(context.paths.config, 'publish-rules.json')) || {
    agentsKinds: ['rule', 'boundary'],
    skillKinds: ['workflow', 'recipe'],
    referenceKinds: ['counterexample'],
    minConfidence: 0.6,
  };
  const config = readJson(path.join(context.paths.config, 'entro.config.json')) || { publish: {} };

  const approvedCards = readCardsFromDirectory(path.join(context.paths.cards, 'approved')).filter(card => {
    return Number(card.meta.confidence || 0) >= publishRules.minConfidence;
  });

  const compiledAgents = [];
  const compiledSkills = [];

  approvedCards.forEach(card => {
    if (publishRules.agentsKinds.includes(card.meta.kind)) {
      compiledAgents.push(card);
    } else if (publishRules.skillKinds.includes(card.meta.kind)) {
      compiledSkills.push(card);
    }
  });

  const agentsOutput = renderAgents(compiledAgents);
  const skillsOutput = compiledSkills.map(card => ({
    id: card.meta.id,
    content: renderSkill(card),
  }));

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(options['dry-run']),
    cards: approvedCards.map(card => card.meta.id),
    outputs: {
      agents: compiledAgents.map(card => card.meta.id),
      skills: compiledSkills.map(card => card.meta.id),
      refs: [],
    },
  };

  if (!options['dry-run']) {
    writeText(path.join(context.paths.publications, 'AGENTS.md'), agentsOutput);
    skillsOutput.forEach(item => {
      const skillDir = path.join(context.paths.publications, 'skills', item.id);
      ensureDir(skillDir);
      writeText(path.join(skillDir, 'SKILL.md'), item.content);
    });
    writeJson(path.join(context.paths.snapshots, 'last-publish', 'publish-summary.json'), {
      publishedAt: manifest.generatedAt,
      agentsCount: compiledAgents.length,
      skillsCount: compiledSkills.length,
      referencesCount: 0,
      dryRun: false,
    });
  }

  ensureDir(path.join(context.paths.runtime, 'sync-plans'));
  ensureDir(path.join(context.paths.runtime, 'reports'));
  writeJson(path.join(context.paths.runtime, 'manifest.json'), manifest);
  writeJson(
    path.join(context.paths.runtime, 'sync-plans', 'latest-sync-plan.json'),
    buildSyncPlan(config.publish, compiledAgents, compiledSkills)
  );
  writeText(
    path.join(context.paths.runtime, 'reports', 'latest-publish-report.md'),
    renderPublishReport({
      dryRun: Boolean(options['dry-run']),
      compiledAgents,
      compiledSkills,
      compiledRefs: [],
    })
  );
  syncOpenQuestionsReport(context);

  console.log(
    `[entro] ${options['dry-run'] ? '已规划' : '已发布'} ${compiledAgents.length} 个 AGENTS 片段、${compiledSkills.length} 个 skill、0 个参考文档`
  );
}

function diffCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    readAllCards,
    filterChangedFilesForScope,
    normalizeArray,
    writeJson,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const summary =
    readJson(path.join(context.paths.snapshots, 'last-scan', 'workspace-summary.json')) ||
    readJson(path.join(context.paths.evidence, 'repo-scan', 'workspace-summary.json'));
  if (!summary || !summary.changedOnly) {
    throw new Error('no changed-only scan snapshot found. Run `entro scan --changed-only --base <ref>` first.');
  }

  const config = readJson(path.join(context.paths.config, 'scopes.json')) || { scopes: [] };
  const activeCards = readAllCards(context.paths.cards);

  const drift = config.scopes.map(scope => {
    const changedFiles = filterChangedFilesForScope(summary.changedFiles || [], scope.paths);
    const relatedCards = activeCards.filter(card =>
      normalizeArray(card.meta.scopePaths).some(scopePath =>
        scope.paths.some(candidate => candidate === scopePath)
      )
    );

    let classification = 'unchanged';
    if (changedFiles.length > 0 && relatedCards.length === 0) {
      classification = 'new_pattern';
    } else if (changedFiles.length > 0 && relatedCards.length > 0) {
      classification = 'pattern_drift';
    }

    return {
      scope: scope.id,
      changedFiles,
      relatedCards: relatedCards.map(card => card.meta.id),
      classification,
    };
  });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    base: summary.diffBase,
    changedOnly: true,
    drift,
  };

  ensureDir(path.join(context.paths.runtime, 'reports'));
  writeJson(path.join(context.paths.runtime, 'reports', 'latest-drift-report.json'), report);

  console.log(`[entro] 已为 ${drift.length} 个 scope 生成主干漂移报告`);
}

export {
  consolidateCommand,
  publishCommand,
  diffCommand,
};
