import path from 'path';
import fs from 'fs';
import { normalizeArray } from '../shared/collections.js';

function seedPlanCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
    ensureSeedsConfig,
    loadSeedRegistry,
    writeMergedSeedsSnapshot,
    activateSeeds,
    writeActiveSeedsSnapshot,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);
  ensureSeedsConfig(context);

  const mergedSeeds = loadSeedRegistry(context);
  const mergedPath = writeMergedSeedsSnapshot(context, mergedSeeds);
  const activePayload = activateSeeds(context, mergedSeeds);
  const activePath = writeActiveSeedsSnapshot(context, activePayload);

  console.log(`[entro] 已生成 seed 计划：共 ${mergedSeeds.length} 条种子，激活 ${activePayload.activeSeeds.length} 条`);
  console.log(`[entro] merged seeds: ${mergedPath}`);
  console.log(`[entro] active seeds: ${activePath}`);
}

async function seedExtractCommand(context, options, helpers) {
  const {
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
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);
  ensureSeedsConfig(context);

  const provider = loadDefaultProvider(context);
  const mergedSeeds = loadSeedRegistry(context);
  const { activeSeeds } = activateSeeds(context, mergedSeeds);
  const statuses = ['draft', 'needs-human', 'needs-review', 'approved'];
  const cards = statuses.flatMap(status => readCardsFromDirectory(path.join(context.paths.cards, status)));
  const targetSeeds = resolveTargetSeeds(activeSeeds, options.seed);

  if (!targetSeeds.length) {
    throw new Error('no active seeds to extract. Run `entro seed-plan` or check seeds config.');
  }

  const results = [];
  for (const seed of targetSeeds) {
    const promptInput = buildSeedExtractionInput(context, seed, cards);
    const agentAttempt = await executeAgentTask(context, {
      stage: `seed-extract-${seed.id}`,
      provider,
      promptFile: 'seed_extraction.md',
      promptInput,
      outputSchema: buildSeedExtractionSchema(),
    });

    if (!agentAttempt.ok) {
      throw new Error(`seed extraction failed for ${seed.headline}: ${agentAttempt.providerError || 'unknown provider error'}`);
    }

    const result = normalizeSeedExtractionResult(seed, agentAttempt.parsed);
    writeSeedDistillArtifacts(context, result, promptInput);
    if (result.status === 'resolved') {
      writeResolvedSeed(context, result);
    } else if (
      result.status === 'needs_human' ||
      (result.status === 'unsupported' && seed.source === 'business' && seed.priority === 'required')
    ) {
      const relatedCards = cards.filter(card =>
        normalizeArray(result.evidenceRefs).some(ref => normalizeArray(card.meta.evidenceRefs).includes(ref))
      );
      const question = createSeedQuestionDocument(seed, result, relatedCards);
      writeJson(path.join(context.paths.questions, 'open', `${question.meta.id}.json`), question);
    }

    const run = persistAgentRun(context, {
      stage: 'seed_extract',
      provider,
      input: promptInput,
      output: {
        result,
        strategy: 'agent-primary',
        agent: buildAgentSummary(agentAttempt),
      },
      options,
    });

    results.push({
      ...result,
      agentRunId: run.id,
    });
  }

  writeJson(path.join(context.paths.runtime, 'seeds', 'latest-seed-extract.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    results,
  });
  syncOpenQuestionsReport(context);

  const summary = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`[entro] 已完成 ${results.length} 条 seed 抽取：resolved ${summary.resolved || 0}，needs_human ${summary.needs_human || 0}，unsupported ${summary.unsupported || 0}`);
}

function resolveTargetSeeds(seeds, targetId) {
  if (!targetId) {
    return seeds;
  }
  return seeds.filter(seed => seed.id === targetId);
}

export {
  seedPlanCommand,
  seedExtractCommand,
};
