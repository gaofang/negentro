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

function buildWorkflowRecommendation(scope) {
  if (scope.id === 'publish') {
    return [
      '1. 先阅读发布页架构文档，再进入代码搜索，先判断问题落在应用层、goods-sdk 还是 schema 协议层。',
      '2. 新增字段或联动时，优先判断能否通过 schema 驱动、helper 配置或场景 actions 解决，再考虑写定制组件逻辑。',
      '3. 涉及组件扩展时，先判断是 simple component / config-components，还是必须升级为新的 pg-* 实体组件。',
      '4. 变更完成后，需要连带检查 create 链路、发布校验、组件映射与场景编排是否一起成立。',
    ].join('\n');
  }

  if (scope.id === 'list') {
    return [
      '1. 先阅读列表页架构文档，确认改动是在路由入口、Tabs 壳、SearchComp，还是中间运营区。',
      '2. 新增筛选或列表能力时，先梳理参数格式化、URL 同步、首屏预取和刷新链路是否要同步改动。',
      '3. 保持表单状态、URL 参数、首搜行为和手动刷新语义一致，避免出现 reset 后脏参数回填。',
      '4. 如果涉及 tab、白名单或店铺形态差异，需要额外检查分流逻辑和跨 tab 影响面。',
    ].join('\n');
  }

  return [
    '1. 先确认是自动埋点扩展还是业务手动埋点，并梳理事件语义、字段口径和触发时机。',
    '2. 默认复用现有埋点封装，不要直接散落底层上报逻辑。',
    '3. 提交前补齐埋点字段、验收方式与回查路径，避免“代码发了但无法查数”。',
  ].join('\n');
}

function buildRuleRecommendation(scope) {
  if (scope.id === 'publish') {
    return [
      '- 发布页优先遵守 schema 驱动原则：显隐、必填、校验、联动、默认值尽量放到 schema 与 actions 中。',
      '- 可配置的提示文案、问号说明、助手内容，优先沉淀到 helper 配置，不要散落在组件 JSX 里。',
      '- 只有在复杂交互、副作用、额外请求或强业务复用封装出现时，才升级成新的实体组件。',
    ].join('\n');
  }

  if (scope.id === 'list') {
    return [
      '- 列表页改动默认要保持筛选状态与 URL 参数同步。',
      '- 改动首屏、路由或容器能力时，要回头验证 prefetch 与初始化搜索是否仍然成立。',
      '- SearchComp 是数据流收敛点，能收敛在参数格式化和容器层的逻辑，不要向各 tab 分散。',
    ].join('\n');
  }

  return [
    '- 业务埋点默认走统一工具层，不要直接新增原始上报调用。',
    '- 埋点实现与字段设计、查数口径、验证路径要一起沉淀。',
  ].join('\n');
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
    '## 推荐做法',
    recommendation,
    '',
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
          path: '.entro/output/AGENTS.generated.md',
          mode: 'draft-only',
        },
        source: '.entro/output/AGENTS.generated.md',
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

function normalizeQuestionDocument(question) {
  if (!question || !question.body) {
    return question;
  }

  const next = {
    ...question,
    body: {
      ...question.body,
    },
  };

  if (question.meta && question.meta.id === 'q_goods_tracking_default_api_v1') {
    next.body.title = '确认商品域默认埋点 API 用法';
    next.body.rationale = '这个答案决定了埋点 skill 能否安全给出统一默认 API，并避免业务代码散落底层调用。';
  }

  if (question.meta && question.meta.id === 'q_goods_list_default_container_v1') {
    next.body.title = '确认商品列表页默认容器选型';
    next.body.rationale = '这个答案会直接决定生成的列表 skill 是推荐保守起步方案，还是默认走性能优先方案。';
  }

  if (question.meta && (question.meta.id === 'q_goods_publish_recommended_path' || question.meta.id === 'q_goods_publish_component_path_v2')) {
    next.body.title = '确认商品发布字段新增的默认组件实现路径';
    next.body.rationale = '只有先确认默认实现路径，发布组件开发经验才能沉淀成可复用且可信的 skill。';
  }

  return next;
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
  const priority = ['closed', 'answered', 'open'];
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

  switch (question.meta.id) {
    case 'q_goods_publish_recommended_path':
    case 'q_goods_publish_component_path_v2':
      return '当需求本质上只是“一个 schema 字段 + 一个基础控件”时，优先走基于 config-components / generateMagicComponents / MagicComponent 的 simple component 路径；只有在存在复杂交互、副作用、额外请求或更强的可复用业务封装诉求时，才新建 pg-* 实体组件。';
    case 'q_goods_list_default_container_v1':
      return `新建列表页优先从 ${normalizeListContainer(extracted.default_container || 'Search')} 起步；只有在${normalizeListUpgradeCondition(extracted.upgrade_condition || '存在明确的缓存或首屏性能诉求')}时，再升级到 SwrSearch 或 SearchWithSwrLocal。典型例外：${normalizeCanonicalExample(extracted.canonical_example || '/list 核心实现')}。`;
    case 'q_goods_tracking_default_api_v1':
      return [
        `商品域业务自定义埋点默认使用 ${normalizeTrackingPreferredApi(extracted.preferred_api || 'sendEvent')}。`,
        `业务代码不要直接调用 ${normalizeTrackingAvoidApi(extracted.avoid_api || 'apps/goods/ffa-goods/src/single/tea.ts')}。`,
        `只有在 ${normalizeTrackingException(extracted.exception_cases || '明确要求 mera_custom_event 口径')} 时，才使用 reportEvent。`,
        `参考示例：${normalizeExampleFiles(extracted.example_files || 'packages/goods-sdk/utils/src/utils/tea/index.ts')}。`,
      ].join('');
    default:
      return '';
  }
}

function buildConfirmedChoiceNote(question, extracted) {
  const selected = extracted.selected_option_id || '';
  switch (question.meta.id) {
    case 'q_publish_form_item_default_v1':
      if (selected === 'simple_component_first') {
        return '新增发布字段时，默认优先走 simple component / config-components / MagicComponent 这类配置式路径；只有在存在复杂交互、副作用、额外请求或更强业务复用诉求时，才升级为 pg-* 实体组件。';
      }
      if (selected === 'pg_component_first') {
        return '新增发布字段时，默认优先建设或扩展 pg-* 实体组件，再接入组件映射与场景编排；配置式 simple component 只用于非常轻量的展示或基础字段。';
      }
      if (selected === 'depends_on_complexity') {
        return '新增发布字段时，没有单一默认实现路径；先判断是否存在复杂交互、副作用、额外请求或强复用诉求，再决定走 simple component 还是 pg-* 实体组件。';
      }
      return '';
    case 'q_tracking_workflow_default_v1':
      if (selected === 'sdk_send_event') {
        return '商品域业务埋点默认优先复用 goods-sdk 的统一埋点封装，不直接散落应用层原始上报调用。';
      }
      if (selected === 'app_tea_wrapper') {
        return '商品域业务埋点默认优先从 ffa-goods 应用侧 tea 封装出发，再由应用统一管理上报细节。';
      }
      if (selected === 'depends_on_event_kind') {
        return '商品域埋点没有单一默认 API；需要先区分自动埋点、业务事件和特殊口径，再决定使用哪层封装。';
      }
      return '';
    case 'q_list_workflow_default_v1':
      if (selected === 'search_first') {
        return '新建商品列表页时，默认先从基础 Search 容器起步；只有在存在明确缓存、预取或首屏性能诉求时，再升级到 SwrSearch 一类方案。';
      }
      if (selected === 'swr_search_first') {
        return '新建商品列表页时，默认直接采用带缓存/预取能力的 SwrSearch 类容器，以保持首屏与刷新体验一致。';
      }
      if (selected === 'depends_on_scenario') {
        return '新建商品列表页时，没有固定默认容器；需要先根据 tab 分流、缓存诉求、首屏性能和数据体量来选择 Search 或 SwrSearch。';
      }
      return '';
    case 'q_publish_workflow_default_v1':
      if (selected === 'app_layer_first') {
        return '处理典型发布需求时，默认先从应用层页面入口与业务容器排查，再逐步下钻到 schema 或 goods-sdk 共享层。';
      }
      if (selected === 'schema_actions_first') {
        return '处理典型发布需求时，默认先判断能否在 schema、actions、helper 配置层解决，尽量避免一开始就改实体组件。';
      }
      if (selected === 'sdk_component_first') {
        return '处理典型发布需求时，默认先从 goods-sdk 共享组件和发布框架层排查，再回看应用侧接入与编排。';
      }
      return '';
    default:
      return '';
  }
}

function mergeRecommendationWithDefault(currentRecommendation, note) {
  return currentRecommendation;
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

function normalizeListContainer(value) {
  return String(value).replace(/^start with\s+/i, '').trim();
}

function normalizeListUpgradeCondition(value) {
  return String(value)
    .replace(/^only\s+when\s+/i, '')
    .replace(/^there\s+is\s+/i, '')
    .replace(/^a\s+/i, '')
    .trim();
}

function normalizeCanonicalExample(value) {
  return String(value)
    .replace(/^the\s+/i, '')
    .trim();
}

function normalizeTrackingPreferredApi(value) {
  return String(value)
    .replace(/^use\s+/i, '')
    .trim();
}

function normalizeTrackingAvoidApi(value) {
  return String(value)
    .replace(/^do\s+not\s+call\s+/i, '')
    .replace(/^call\s+/i, '')
    .replace(/\s+directly\s+from\s+business\s+code$/i, '')
    .trim();
}

function normalizeTrackingException(value) {
  return String(value)
    .replace(/^use\s+reportEvent\s+only\s+when\s+/i, '')
    .replace(/^only\s+when\s+/i, '')
    .replace(/^explicitly\s+/i, '')
    .trim();
}

function normalizeExampleFiles(value) {
  return String(value).trim();
}

export {
  createCard,
  createQuestion,
  createAnswer,
  buildWorkflowRecommendation,
  buildRuleRecommendation,
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
  normalizeQuestionDocument,
  upsertMinedCard,
  upsertMinedQuestion,
  applyConfirmedDefaultToCard,
  mergeRecommendationWithDefault,
  replaceExt,
  normalizePublishConfig,
};
