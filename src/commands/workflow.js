import fs from 'fs';
import path from 'path';

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

function countOpenQuestions(context) {
  const directory = path.join(context.paths.questions, 'open');
  if (!fs.existsSync(directory)) {
    return 0;
  }

  return fs.readdirSync(directory).filter(file => file.endsWith('.json')).length;
}

export {
  extractCommand,
  runCommand,
};
