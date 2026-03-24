import fs from 'fs';
import path from 'path';

function questionCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const action = options._[0];
  if (!action || action === 'list') {
    return listQuestions(context, options, helpers);
  }
  if (action === 'ask') {
    return askQuestion(context, options, helpers);
  }

  throw new Error(`unsupported question action: ${action}`);
}

function listQuestions(context, options, helpers) {
  const { readJson } = helpers;
  const status = options.status || 'open';
  const directory = path.join(context.paths.questions, status);
  const files = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(file => file.endsWith('.json'))
    : [];

  if (!files.length) {
    console.log(`[entro] 当前没有状态为 ${status} 的问题`);
    return;
  }

  files.forEach(file => {
    const question = readJson(path.join(directory, file));
    console.log(`${question.meta.id} [${question.meta.status}] ${question.body.title}`);
  });
}

function askQuestion(context, options, helpers) {
  const { findQuestionPath, readJson, normalizeArray } = helpers;
  const questionId = options.id || options.question;
  if (!questionId) {
    throw new Error('missing --id <questionId>');
  }

  const questionPath = findQuestionPath(context.paths.questions, questionId);
  if (!questionPath) {
    throw new Error(`question not found: ${questionId}`);
  }

  const question = readJson(questionPath);

  console.log(`问题：${question.body.title}`);
  console.log(`提问：${question.body.prompt}`);
  console.log(`背景：${question.body.background}`);
  console.log(`负责人：${question.meta.owners.join(', ') || '未分配'}`);
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    console.log('可选项：');
    normalizeArray(question.body.expectedAnswer.options).forEach((option, index) => {
      console.log(`${index + 1}. [${option.id}] ${option.label}`);
      if (option.description) {
        console.log(`   ${option.description}`);
      }
    });
    if (question.body.expectedAnswer.allowComment) {
      console.log('可选补充：如有必要，可额外补一句备注。');
    }
    return;
  }

  console.log(
    `期望字段：${(question.body.expectedAnswer && question.body.expectedAnswer.fields.join(', ')) || '自由回答'}`
  );
}

async function answerCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
    findQuestionPath,
    readJson,
    buildAnswerPayloadFromText,
    promptForAnswer,
    createAnswer,
    writeJson,
    syncOpenQuestionsReport,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const questionId = options.question || options.id || options._[0];
  if (!questionId) {
    throw new Error('缺少问题 ID，请使用 `entro answer --question <id>`');
  }

  const questionPath = findQuestionPath(context.paths.questions, questionId);
  if (!questionPath) {
    throw new Error(`question not found: ${questionId}`);
  }

  const question = readJson(questionPath);
  const answerPayload = options.text
    ? buildAnswerPayloadFromText(question, options.text)
    : await promptForAnswer(question);
  const answerId = `ans_${questionId}_${Date.now()}`;

  const answer = createAnswer({
    id: answerId,
    question,
    answerPayload,
    providedBy: options.by || process.env.USER || 'console-user',
    source: 'console',
  });

  writeJson(path.join(context.paths.answers, 'raw', `${answer.meta.id}.json`), answer);

  question.meta.status = 'answered';
  question.meta.updatedAt = new Date().toISOString();
  question.body.answerRefs.push(answer.meta.id);

  writeJson(path.join(context.paths.questions, 'answered', `${question.meta.id}.json`), question);
  if (questionPath !== path.join(context.paths.questions, 'answered', `${question.meta.id}.json`)) {
    fs.unlinkSync(questionPath);
  }
  syncOpenQuestionsReport(context);

  console.log(`[entro] 已记录回答 ${answer.meta.id}，对应问题 ${questionId}`);
}

function reconcileCommand(context, options, helpers) {
  const {
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
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const questionId = options.question || options.id;
  if (!questionId) {
    throw new Error('缺少 `--question <questionId>`');
  }

  const questionPath = findQuestionPath(context.paths.questions, questionId);
  if (!questionPath) {
    throw new Error(`question not found: ${questionId}`);
  }

  const question = readJson(questionPath);
  const answerId = options.answer || getLastAnswerRef(question);
  if (!answerId) {
    throw new Error(`question ${questionId} has no answer refs`);
  }

  const answerPath = path.join(context.paths.answers, 'raw', `${answerId}.json`);
  if (!fs.existsSync(answerPath)) {
    throw new Error(`answer not found: ${answerId}`);
  }

  const answer = readJson(answerPath);
  const normalized = normalizeAnswer(question, answer);
  writeJson(path.join(context.paths.answers, 'normalized', `${answer.meta.id}.json`), normalized);

  const sufficient = normalized.judgement.sufficient;
  question.meta.status = sufficient ? 'closed' : 'open';
  question.meta.updatedAt = new Date().toISOString();
  question.body.reconciliation = {
    answerId: answer.meta.id,
    sufficient,
    missingFields: normalized.judgement.missingFields,
  };

  const targetQuestionPath = path.join(
    context.paths.questions,
    sufficient ? 'closed' : 'open',
    `${question.meta.id}.json`
  );
  writeJson(targetQuestionPath, question);
  if (questionPath !== targetQuestionPath) {
    fs.unlinkSync(questionPath);
  }

  if (sufficient) {
    const promoted = promoteRelatedCardsToNeedsReview(context, question);
    syncOpenQuestionsReport(context);
    console.log(
      `[entro] 已对账 ${questionId}：信息已充分${promoted.length ? `，并提升 ${promoted.join(', ')} 到待评审` : '，暂无需要提升的卡片'}`
    );
    return;
  }

  createFollowUpQuestion(context, question, normalized);
  syncOpenQuestionsReport(context);
  console.log(
    `[entro] 已对账 ${questionId}：仍缺少字段 ${normalized.judgement.missingFields.join(', ')}`
  );
}

function reviewCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
    findCardPath,
    readCard,
    decisionToStatus,
    writeCardV2,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const cardId = options.card || options.id;
  const decision = options.decision || 'approve';

  if (!cardId) {
    throw new Error('缺少 `--card <cardId>`');
  }

  const sourcePath = findCardPath(context.paths.cards, cardId);
  if (!sourcePath) {
    throw new Error(`card not found: ${cardId}`);
  }

  const card = readCard(sourcePath);
  const targetStatus = decisionToStatus(decision);

  card.meta.status = targetStatus;
  card.meta.review = {
    decision,
    reviewedAt: new Date().toISOString(),
    note: options.note || '',
    reviewer: options.by || process.env.USER || 'console-reviewer',
  };

  const targetPath = path.join(context.paths.cards, targetStatus, `${card.meta.id}.json`);
  writeCardV2(targetPath, card);

  if (targetPath !== sourcePath && fs.existsSync(sourcePath)) {
    fs.unlinkSync(sourcePath);
  }

  console.log(`[entro] 已将 ${cardId} 评审为 ${targetStatus}`);
}

function enrichCommand(context, options, helpers) {
  const {
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
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const closedQuestionsDir = path.join(context.paths.questions, 'closed');
  const questionFiles = fs.existsSync(closedQuestionsDir)
    ? fs.readdirSync(closedQuestionsDir).filter(file => file.endsWith('.json'))
    : [];

  const enrichedCards = new Set();

  questionFiles.forEach(file => {
    const question = readJson(path.join(closedQuestionsDir, file));
    const reconciliation = question.body && question.body.reconciliation;
    if (!reconciliation || !reconciliation.sufficient) {
      return;
    }

    const answerId = reconciliation.answerId;
    const normalizedAnswer = readJson(path.join(context.paths.answers, 'normalized', `${answerId}.json`));
    if (!normalizedAnswer) {
      return;
    }

    normalizeArray(question.meta.relatedCardIds).forEach(cardId => {
      const cardPath = findCardPath(context.paths.cards, cardId);
      if (!cardPath) {
        return;
      }

      const card = readCard(cardPath);
      const changed = applyConfirmedDefaultToCard(card, question, normalizedAnswer);
      if (!changed) {
        return;
      }

      writeCardV2(cardPath.endsWith('.json') ? cardPath : replaceExt(cardPath, '.json'), card);
      if (cardPath.endsWith('.md') && fs.existsSync(cardPath)) {
        fs.unlinkSync(cardPath);
      }
      enrichedCards.add(card.meta.id);
    });
  });

  writeJson(path.join(context.paths.runtime, 'reports', 'latest-enrichment-report.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enrichedCardIds: Array.from(enrichedCards),
  });

  console.log(`[entro] 已基于已关闭问题补强 ${enrichedCards.size} 张卡片`);
}

export {
  questionCommand,
  answerCommand,
  reconcileCommand,
  reviewCommand,
  enrichCommand,
};
