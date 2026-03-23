import path from 'path';

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
    writeText(path.join(context.paths.publications, 'AGENTS.generated.md'), agentsOutput);
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

  writeJson(path.join(context.paths.publications, 'manifest.json'), manifest);
  writeJson(
    path.join(context.paths.publications, 'sync-plans', 'latest-sync-plan.json'),
    buildSyncPlan(config.publish, compiledAgents, compiledSkills)
  );
  writeText(
    path.join(context.paths.publications, 'reports', 'latest-publish-report.md'),
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

  writeJson(path.join(context.paths.publications, 'reports', 'latest-drift-report.json'), report);

  console.log(`[entro] 已为 ${drift.length} 个 scope 生成主干漂移报告`);
}

export {
  publishCommand,
  diffCommand,
};
