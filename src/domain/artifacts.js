import fs from 'fs';
import path from 'path';
import { DEFAULT_ROOT } from '../context.js';
import { CARD_STATUSES, QUESTION_STATUSES } from '../shared/constants.js';
import { normalizeArray, uniqueBy } from '../shared/collections.js';
import { readJson, writeJson, ensureDir } from '../shared/fs.js';

function createCard({
  id,
  kind,
  title,
  status,
  publishTarget,
  scopePaths,
  ownerHints,
  confidence,
  triggers,
  evidence,
  sections,
  lineage,
}) {
  return {
    schemaVersion: 2,
    meta: {
      id,
      kind,
      title,
      status,
      publishTarget,
      confidence,
      scopePaths,
      ownerHints,
      triggers,
      evidenceRefs: evidence,
      createdAt: new Date().toISOString(),
      lineage,
      review: null,
    },
    body: {
      sections,
      counterexamples: [],
      notes: [],
    },
  };
}

function createQuestion({
  id,
  title,
  level,
  scopePaths,
  owners,
  relatedCardIds,
  prompt,
  background,
  expectedAnswer,
  rationale,
}) {
  return {
    schemaVersion: 2,
    meta: {
      id,
      status: 'open',
      level,
      scopePaths,
      owners,
      relatedCardIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    body: {
      title,
      prompt,
      background,
      expectedAnswer,
      rationale,
      answerRefs: [],
      followUpFrom: null,
      reconciliation: null,
    },
  };
}

function createAnswer({ id, question, answerPayload, providedBy, source }) {
  return {
    schemaVersion: 2,
    meta: {
      id,
      questionId: question.meta.id,
      source,
      providedBy,
      createdAt: new Date().toISOString(),
    },
    body: {
      ...answerPayload,
    },
  };
}

function renderAgents(cards) {
  const header = [
    '# AGENTS 草案（Entro 生成）',
    '',
    '该文件由 `entro publish` 自动生成，供人工确认后再决定是否同步回仓库正式 AGENTS 文档。',
    '',
  ];

  const body = cards.map(card => {
    return [
      `## ${card.meta.title}`,
      '',
      safeSection(card.body.sections, 'recommendation'),
      '',
      `适用范围：${normalizeArray(card.meta.scopePaths).join('，')}`,
      `依据来源：${normalizeArray(card.meta.evidenceRefs).join('，')}`,
      normalizeArray(card.body.notes).length ? `已确认默认做法：${normalizeArray(card.body.notes).map(item => item.note).join('；')}` : '',
      '',
    ].join('\n');
  });

  return header.concat(body).join('\n');
}

function renderSkill(card) {
  const recommendation = safeSection(card.body.sections, 'recommendation');
  const preflight = safeSection(card.body.sections, 'preflight');
  const steps = safeSection(card.body.sections, 'steps');
  const entrypoints = safeSection(card.body.sections, 'entrypoints');
  const pitfalls = safeSection(card.body.sections, 'pitfalls');
  const validation = safeSection(card.body.sections, 'validation');
  const notes = normalizeArray(card.body.notes).map(item => `- ${item.note}`);
  return [
    '---',
    `name: ${card.meta.id}`,
    `description: ${card.meta.title}`,
    'author: entro',
    '---',
    '',
    `# ${card.meta.title}`,
    '',
    '## 适用问题',
    safeSection(card.body.sections, 'problem'),
    '',
    recommendation ? '## 推荐做法' : '',
    recommendation || '',
    recommendation ? '' : '',
    preflight ? '## 前置判断' : '',
    preflight || '',
    preflight ? '' : '',
    entrypoints ? '## 先看这些文件' : '',
    entrypoints || '',
    entrypoints ? '' : '',
    steps ? '## 操作步骤' : '',
    steps || '',
    steps ? '' : '',
    pitfalls ? '## 常见坑' : '',
    pitfalls || '',
    pitfalls ? '' : '',
    validation ? '## 最小验证清单' : '',
    validation || '',
    validation ? '' : '',
    notes.length ? '## 已确认默认做法' : '',
    ...notes,
    notes.length ? '' : '',
    '## 适用边界',
    safeSection(card.body.sections, 'boundary'),
    '',
    '## 取证来源',
    safeSection(card.body.sections, 'evidence'),
    '',
  ].join('\n');
}

function renderReference(card) {
  return [
    `# ${card.meta.title}`,
    '',
    '## 适用问题',
    safeSection(card.body.sections, 'problem'),
    '',
    '## 推荐做法',
    safeSection(card.body.sections, 'recommendation'),
    '',
    '## 适用边界',
    safeSection(card.body.sections, 'boundary'),
    '',
    '## 取证来源',
    safeSection(card.body.sections, 'evidence'),
    '',
  ].join('\n');
}

function safeSection(sections, key) {
  return sections && sections[key] ? sections[key] : '';
}

function renderEvidenceList(items) {
  return normalizeArray(items)
    .map(item => `- ${item}`)
    .join('\n');
}

function renderPublishReport({ dryRun, compiledAgents, compiledSkills, compiledRefs }) {
  return [
    '# 发布报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 是否 dry run：${dryRun ? '是' : '否'}`,
    `- AGENTS 片段数：${compiledAgents.length}`,
    `- Skill 数量：${compiledSkills.length}`,
    `- 参考文档数量：${compiledRefs.length}`,
    '',
    '## AGENTS 片段',
    ...compiledAgents.map(card => `- ${card.meta.id}: ${card.meta.title}`),
    '',
    '## Skills',
    ...compiledSkills.map(card => `- ${card.meta.id}: ${card.meta.title}`),
    '',
    '## 参考文档',
    ...compiledRefs.map(card => `- ${card.meta.id}: ${card.meta.title}`),
    '',
  ].join('\n');
}

function buildSyncPlan(publishConfig, compiledAgents, compiledSkills) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dryRunOnly: true,
    agents: [
      {
        target: {
          id: 'app-output-agents',
          path: '.entro/output/AGENTS.md',
          mode: 'draft-only',
        },
        source: '.entro/output/AGENTS.md',
        cardIds: compiledAgents.map(card => card.meta.id),
      },
    ],
    skills: [
      {
        target: {
          id: 'app-output-skills',
          path: '.entro/output/skills',
          mode: 'draft-only',
        },
        source: '.entro/output/skills',
        cardIds: compiledSkills.map(card => card.meta.id),
      },
    ],
  };
}

function decisionToStatus(decision) {
  switch (decision) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'deprecate':
      return 'deprecated';
    default:
      throw new Error(`unsupported decision: ${decision}`);
  }
}

function findCardPath(cardsRoot, cardId) {
  for (const status of CARD_STATUSES) {
    const jsonPath = path.join(cardsRoot, status, `${cardId}.json`);
    if (fs.existsSync(jsonPath)) {
      return jsonPath;
    }
    const markdownPath = path.join(cardsRoot, status, `${cardId}.md`);
    if (fs.existsSync(markdownPath)) {
      return markdownPath;
    }
  }
  return null;
}

function findCardPaths(cardsRoot, cardId) {
  const results = [];
  for (const status of CARD_STATUSES) {
    const jsonPath = path.join(cardsRoot, status, `${cardId}.json`);
    if (fs.existsSync(jsonPath)) {
      results.push(jsonPath);
    }
    const markdownPath = path.join(cardsRoot, status, `${cardId}.md`);
    if (fs.existsSync(markdownPath)) {
      results.push(markdownPath);
    }
  }
  return results;
}

function findQuestionPath(questionsRoot, questionId) {
  for (const status of QUESTION_STATUSES) {
    const jsonPath = path.join(questionsRoot, status, `${questionId}.json`);
    if (fs.existsSync(jsonPath)) {
      return jsonPath;
    }
  }
  return null;
}

function findQuestionPaths(questionsRoot, questionId) {
  const results = [];
  for (const status of QUESTION_STATUSES) {
    const jsonPath = path.join(questionsRoot, status, `${questionId}.json`);
    if (fs.existsSync(jsonPath)) {
      results.push(jsonPath);
    }
  }
  return results;
}

function readCardsFromDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter(file => file.endsWith('.json') || file.endsWith('.md'))
    .map(file => readCard(path.join(directory, file)));
}

function readAllCards(cardsRoot) {
  const cards = [];
  CARD_STATUSES.forEach(status => {
    cards.push(...readCardsFromDirectory(path.join(cardsRoot, status)));
  });
  return cards;
}

function writeCardV2(filePath, card) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(card, null, 2)}\n`);
}

function readCard(filePath) {
  if (filePath.endsWith('.json')) {
    const card = readJson(filePath);
    if (card.schemaVersion === 2) {
      return card;
    }
    return migrateLegacyCardDocument(card);
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const match = contents.match(/^```json\n([\s\S]*?)\n```\n\n# ([^\n]+)\n\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`invalid card format: ${filePath}`);
  }

  const meta = JSON.parse(match[1]);
  const title = match[2];
  const remaining = match[3];
  const sections = {};
  let currentHeading = null;

  remaining.split('\n').forEach(line => {
    if (line.startsWith('## ')) {
      currentHeading = line.slice(3).toLowerCase();
      sections[currentHeading] = '';
      return;
    }

    if (!currentHeading) {
      return;
    }

    sections[currentHeading] += sections[currentHeading] ? `\n${line}` : line;
  });

  return migrateLegacyCardDocument({
    meta: {
      ...meta,
      title,
      scopePaths: meta.scope || [],
      evidenceRefs: meta.evidence || [],
    },
    body: {
      sections,
    },
  });
}

function migrateLegacyCardDocument(card) {
  const meta = card.meta || {};
  const body = card.body || {};
  return {
    schemaVersion: 2,
    meta: {
      id: meta.id,
      kind: meta.kind,
      title: meta.title || card.title || meta.id,
      status: meta.status,
      publishTarget: meta.publishTarget,
      confidence: meta.confidence,
      scopePaths: meta.scopePaths || meta.scope || [],
      ownerHints: meta.ownerHints || [],
      triggers: meta.triggers || [],
      evidenceRefs: meta.evidenceRefs || meta.evidence || [],
      createdAt: meta.createdAt || meta.reviewedAt || new Date().toISOString(),
      lineage: meta.lineage || null,
      review: meta.review || (meta.reviewDecision
        ? {
            decision: meta.reviewDecision,
            reviewedAt: meta.reviewedAt,
            note: meta.reviewNote || '',
            reviewer: meta.reviewer || 'unknown',
          }
        : null),
    },
    body: {
      sections: body.sections || {},
      counterexamples: body.counterexamples || [],
      notes: body.notes || [],
    },
  };
}

function promoteRelatedCardsToNeedsReview(context, question) {
  const promoted = [];
  normalizeArray(question.meta.relatedCardIds).forEach(cardId => {
    const cardPath = findCardPath(context.paths.cards, cardId);
    if (!cardPath) {
      return;
    }
    const card = readCard(cardPath);
    if (card.meta.status === 'approved') {
      return;
    }
    card.meta.status = 'needs-review';
    const targetPath = path.join(context.paths.cards, 'needs-review', `${card.meta.id}.json`);
    writeCardV2(targetPath, card);
    if (cardPath !== targetPath) {
      fs.unlinkSync(cardPath);
    }
    promoted.push(card.meta.id);
  });
  return promoted;
}

function createFollowUpQuestion(context, question, normalized) {
  const followUpId = `${question.meta.id}_followup_${Date.now()}`;
  const followUp = createQuestion({
    id: followUpId,
    title: `${question.body.title}（补充追问）`,
    level: question.meta.level,
    scopePaths: question.meta.scopePaths,
    owners: question.meta.owners,
    relatedCardIds: question.meta.relatedCardIds,
    prompt: `${question.body.prompt}\n请补充以下缺失字段: ${normalized.judgement.missingFields.join(', ')}`,
    background: question.body.background,
    expectedAnswer: {
      fields: normalized.judgement.missingFields,
    },
    rationale: '上一轮回答不足以支撑卡片进入评审，需要继续补充关键信息。',
  });
  followUp.body.followUpFrom = question.meta.id;
  writeJson(path.join(context.paths.questions, 'open', `${followUp.meta.id}.json`), followUp);
}

function removeRelatedOpenFollowUpQuestions(questionsRoot, questionId) {
  const openDir = path.join(questionsRoot, 'open');
  if (!fs.existsSync(openDir)) {
    return [];
  }

  const removed = collectOpenFollowUpDescendants(questionsRoot, questionId);
  removed.forEach(descendantId => {
    const filePath = path.join(openDir, `${descendantId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
  return removed;
}

function collectOpenFollowUpDescendants(questionsRoot, questionId) {
  const openDir = path.join(questionsRoot, 'open');
  if (!fs.existsSync(openDir)) {
    return [];
  }

  const questions = fs.readdirSync(openDir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson(path.join(openDir, file)))
    .filter(Boolean);

  const descendants = [];
  const queue = [questionId];

  while (queue.length) {
    const currentId = queue.shift();
    questions.forEach(question => {
      if (!question || !question.body || question.body.followUpFrom !== currentId) {
        return;
      }
      const nextId = question.meta && question.meta.id;
      if (!nextId || descendants.includes(nextId)) {
        return;
      }
      descendants.push(nextId);
      queue.push(nextId);
    });
  }

  return descendants;
}

function getQuestionRootId(question, questionMap) {
  let current = question;
  const visited = new Set();

  while (current && current.body && current.body.followUpFrom && !visited.has(current.meta && current.meta.id)) {
    visited.add(current.meta && current.meta.id);
    const parentId = current.body.followUpFrom;
    current = questionMap.get(parentId) || null;
    if (!current) {
      return parentId;
    }
  }

  return current && current.meta ? current.meta.id : question && question.meta ? question.meta.id : '';
}

function dedupeOpenQuestionsByRoot(questions, questionsRoot) {
  const allQuestions = [];
  QUESTION_STATUSES.forEach(status => {
    const directory = path.join(questionsRoot, status);
    if (!fs.existsSync(directory)) {
      return;
    }
    fs.readdirSync(directory)
      .filter(file => file.endsWith('.json'))
      .forEach(file => {
        const question = readJson(path.join(directory, file));
        if (question) {
          allQuestions.push(question);
        }
      });
  });

  const questionMap = new Map(allQuestions.map(question => [question.meta.id, question]));
  const deduped = new Map();

  normalizeArray(questions).forEach(question => {
    const rootId = getQuestionRootId(question, questionMap);
    const existing = deduped.get(rootId);
    if (!existing) {
      deduped.set(rootId, question);
      return;
    }

    const existingDepth = String(existing.meta && existing.meta.id || '').split('_followup_').length;
    const nextDepth = String(question.meta && question.meta.id || '').split('_followup_').length;
    if (nextDepth < existingDepth) {
      deduped.set(rootId, question);
    }
  });

  return Array.from(deduped.values()).sort((left, right) =>
    String(left.meta && left.meta.id || '').localeCompare(String(right.meta && right.meta.id || ''))
  );
}

function normalizeQuestionDocument(question) {
  return question;
}

function upsertMinedCard(context, card) {
  const existingPaths = findCardPaths(context.paths.cards, card.meta.id);
  const existingCards = existingPaths.map(filePath => ({
    filePath,
    card: readCard(filePath),
  }));

  const highestStatus = pickHighestCardStatus(existingCards.map(item => item.card.meta.status));
  const mergedNotes = uniqueBy(
    existingCards.flatMap(item => normalizeArray(item.card.body && item.card.body.notes)).concat(
      normalizeArray(card.body.notes)
    ),
    item => `${item.sourceQuestionId || ''}:${item.sourceAnswerId || ''}:${item.note || ''}`
  );

  const mergedEvidenceRefs = uniqueBy(
    existingCards.flatMap(item => normalizeArray(item.card.meta && item.card.meta.evidenceRefs)).concat(
      normalizeArray(card.meta.evidenceRefs)
    ),
    item => item
  );

  const targetStatus =
    highestStatus === 'approved' || highestStatus === 'needs-review'
      ? 'needs-review'
      : highestStatus === 'needs-human'
        ? 'needs-human'
        : 'draft';

  const nextCard = {
    ...card,
    meta: {
      ...card.meta,
      status: targetStatus,
      evidenceRefs: mergedEvidenceRefs,
      review: targetStatus === 'needs-review' ? null : card.meta.review,
    },
    body: {
      ...card.body,
      notes: mergedNotes,
    },
  };

  const targetPath = path.join(context.paths.cards, targetStatus, `${card.meta.id}.json`);
  writeCardV2(targetPath, nextCard);
  removeDuplicateFiles(existingPaths, targetPath);
}

function upsertMinedQuestion(context, question) {
  const existingPaths = findQuestionPaths(context.paths.questions, question.meta.id);
  const existingQuestions = existingPaths.map(filePath => ({
    filePath,
    question: readJson(filePath),
  }));

  const highestStatus = pickHighestQuestionStatus(existingQuestions.map(item => item.question.meta.status));
  if (highestStatus === 'closed' || highestStatus === 'answered') {
    const keptPath = existingQuestions.find(item => item.question.meta.status === highestStatus)?.filePath;
    removeDuplicateFiles(existingPaths, keptPath);
    return;
  }

  const existingOpen = existingQuestions.find(item => item.question.meta.status === 'open');
  const nextQuestion = existingOpen
    ? {
        ...question,
        body: {
          ...question.body,
          answerRefs: normalizeArray(existingOpen.question.body && existingOpen.question.body.answerRefs),
          followUpFrom: existingOpen.question.body ? existingOpen.question.body.followUpFrom : null,
          reconciliation: existingOpen.question.body ? existingOpen.question.body.reconciliation : null,
        },
      }
    : question;

  const targetPath = path.join(context.paths.questions, 'open', `${question.meta.id}.json`);
  writeJson(targetPath, nextQuestion);
  removeDuplicateFiles(existingPaths, targetPath);
}

function pickHighestCardStatus(statuses) {
  const priority = ['approved', 'needs-review', 'needs-human', 'draft', 'rejected', 'deprecated'];
  return (
    priority.find(status => normalizeArray(statuses).includes(status)) ||
    'draft'
  );
}

function pickHighestQuestionStatus(statuses) {
  const priority = ['closed', 'answered', 'deferred', 'open'];
  return (
    priority.find(status => normalizeArray(statuses).includes(status)) ||
    'open'
  );
}

function removeDuplicateFiles(paths, keepPath) {
  normalizeArray(paths).forEach(filePath => {
    if (keepPath && path.resolve(filePath) === path.resolve(keepPath)) {
      return;
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

function applyConfirmedDefaultToCard(card, question, normalizedAnswer) {
  const extracted = (normalizedAnswer.body && normalizedAnswer.body.extracted) || {};
  const note = buildConfirmedDefaultNote(question, extracted);
  if (!note) {
    return false;
  }

  const notes = card.body.notes || [];
  const existing = notes.find(item => item.sourceQuestionId === question.meta.id);
  if (existing && existing.note === note) {
    return false;
  }

  const recommendation = safeSection(card.body.sections, 'recommendation');
  const updatedRecommendation = mergeRecommendationWithDefault(recommendation, note);

  card.body.sections.recommendation = updatedRecommendation;
  card.body.notes = [
    ...notes.filter(item => item.sourceQuestionId !== question.meta.id),
    {
      sourceQuestionId: question.meta.id,
      sourceAnswerId: question.body.reconciliation.answerId,
      note,
      confirmedAt: question.meta.updatedAt,
    },
  ];
  card.meta.enrichedAt = new Date().toISOString();

  return true;
}

function buildConfirmedDefaultNote(question, extracted) {
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    return buildConfirmedChoiceNote(question, extracted);
  }

  const rawText = String((normalizedAnswerLikeText(extracted) || '')).trim();
  return rawText ? `维护人补充上下文：${rawText}` : '';
}

function buildConfirmedChoiceNote(question, extracted) {
  const optionId = String(extracted.selected_option_id || '').trim();
  const comment = String(extracted.comment || '').trim();
  const base = mapChoiceNote(optionId, question.body.title);

  if (!base) {
    return comment ? `维护人补充说明：${comment}` : '';
  }

  return comment ? `${base}。补充说明：${comment}` : base;
}

function mergeRecommendationWithDefault(currentRecommendation, note) {
  if (!note) {
    return currentRecommendation;
  }

  const marker = '补充确认：';
  if (String(currentRecommendation || '').includes(note)) {
    return currentRecommendation;
  }

  if (!String(currentRecommendation || '').trim()) {
    return `${marker}${note}`;
  }

  return `${currentRecommendation}\n\n${marker}${note}`;
}

function mapChoiceNote(optionId, title) {
  switch (optionId) {
    case 'confirm-default':
      return `维护人确认“${title}”存在统一默认做法，可按当前经验卡继续沉淀`;
    case 'depends-on-scenario':
      return `维护人确认“${title}”需要按子场景区分，不能抽象成单一路径`;
    case 'not-enough-evidence':
      return `维护人确认“${title}”当前证据不足，暂不宜提升为默认经验`;
    default:
      return '';
  }
}

function normalizedAnswerLikeText(extracted) {
  return Object.entries(extracted || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join('；');
}

function replaceExt(filePath, ext) {
  return `${filePath.replace(/\.[^.]+$/, '')}${ext}`;
}

function normalizePublishConfig(publishConfig) {
  if (publishConfig.agentsTargets || publishConfig.skillTargets) {
    return {
      writeToWorkspace: Boolean(publishConfig.writeToWorkspace),
      agentsTargets: normalizeArray(publishConfig.agentsTargets),
      skillTargets: normalizeArray(publishConfig.skillTargets),
    };
  }

  return {
    writeToWorkspace: Boolean(publishConfig.writeToWorkspace),
    agentsTargets: normalizeArray(publishConfig.writeAgentsTo).map((item, index) => ({
      id: `legacy-agents-${index + 1}`,
      path: path.isAbsolute(item) ? path.relative(DEFAULT_ROOT, item) || item : item,
      mode: 'merge',
    })),
    skillTargets: normalizeArray(publishConfig.writeSkillsTo).map((item, index) => ({
      id: `legacy-skills-${index + 1}`,
      path: path.isAbsolute(item) ? path.relative(DEFAULT_ROOT, item) || item : item,
      mode: 'copy',
    })),
  };
}

export {
  createCard,
  createQuestion,
  createAnswer,
  renderAgents,
  renderSkill,
  renderReference,
  safeSection,
  renderEvidenceList,
  renderPublishReport,
  buildSyncPlan,
  decisionToStatus,
  findCardPath,
  findCardPaths,
  findQuestionPath,
  findQuestionPaths,
  readCardsFromDirectory,
  readAllCards,
  writeCardV2,
  readCard,
  migrateLegacyCardDocument,
  promoteRelatedCardsToNeedsReview,
  createFollowUpQuestion,
  removeRelatedOpenFollowUpQuestions,
  dedupeOpenQuestionsByRoot,
  normalizeQuestionDocument,
  upsertMinedCard,
  upsertMinedQuestion,
  applyConfirmedDefaultToCard,
  mergeRecommendationWithDefault,
  replaceExt,
  normalizePublishConfig,
};
