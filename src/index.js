import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { answerCommand, enrichCommand, questionCommand, reconcileCommand, reviewCommand } from './commands/hitl.js';
import { discoverCommand, distillCommand, mineCommand } from './commands/mining.js';
import { diffCommand, publishCommand } from './commands/publication.js';
import {
  applyConfirmedDefaultToCard,
  createAnswer,
  createCard,
  createFollowUpQuestion,
  createQuestion,
  decisionToStatus,
  findCardPath,
  findQuestionPath,
  promoteRelatedCardsToNeedsReview,
  readAllCards,
  readCard,
  readCardsFromDirectory,
  renderEvidenceList,
  replaceExt,
  upsertMinedCard,
  upsertMinedQuestion,
  writeCardV2,
} from './domain/artifacts.js';
import { printAgentRunSummaries } from './services/agent-runtime.js';
import { runDiscoveryTask, runRepositoryDistillation } from './services/mining-tasks.js';
import {
  buildOwnersConfig,
  classifySourcesCommand as runClassifySourcesCommand,
  scanCommand as runScanCommand,
} from './services/repo-scan.js';
import {
  clearGeneratedCandidateState,
  clearGeneratedOpenQuestions,
  ensureBuiltinPrompts,
  ensureOperationalSubdirs,
  migrateConfigFile,
  migrateLegacyFiles,
  migrateScopesConfig,
  syncOpenQuestionsReport,
} from './services/state.js';
import { normalizeArray, uniqueBy } from './shared/collections.js';
import {
  DEFAULT_DERIVED_RULES,
  DEFAULT_IGNORE_RULES,
  DEFAULT_PRIMARY_DOC_RULES,
  DEFAULT_PROCESS_RULES,
  ENTRO_DIR,
  OUTPUT_DIR,
} from './shared/constants.js';
import { ensureDir, readJson, writeJson, writeJsonIfAbsent, writeText, writeTextIfAbsent } from './shared/fs.js';
import { createContext, DEFAULT_ROOT, toRepoRelative } from './context.js';

async function run(argv) {
  const [command = 'help', ...rest] = argv;
  const options = parseOptions(rest);

  const context = createContext(options.app || options.root || DEFAULT_ROOT);

  switch (command) {
    case 'init':
      return initCommand(context);
    case 'scan':
      return runScanCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        writeJson,
        toRepoRelative,
      });
    case 'classify-sources':
      return runClassifySourcesCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        writeJson,
        toRepoRelative,
      });
    case 'discover':
      return discoverCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        resolveScopes,
        runDiscoveryTask,
        loadDefaultProvider,
        discoverTopicsForScope,
        toRepoRelative,
        filterChangedFilesForScope,
        filterSourcesForScope,
        persistAgentRun,
        printAgentRunSummaries,
        writeJson,
      });
    case 'distill':
      return distillCommand(context, options, {
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
      });
    case 'mine':
      return mineCommand(context, options, {
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
      });
    case 'question':
      return questionCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        findQuestionPath,
        normalizeArray,
      });
    case 'answer':
      return answerCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        findQuestionPath,
        readJson,
        buildAnswerPayloadFromText,
        promptForAnswer,
        createAnswer,
        writeJson,
        syncOpenQuestionsReport,
      });
    case 'reconcile':
      return reconcileCommand(context, options, {
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
      });
    case 'review':
      return reviewCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        findCardPath,
        readCard,
        decisionToStatus,
        writeCardV2,
      });
    case 'enrich':
      return enrichCommand(context, options, {
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
      });
    case 'publish':
      return publishCommand(context, options, {
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
      });
    case 'diff':
      return diffCommand(context, options, {
        ensureInitialized,
        migrateLegacyFiles,
        readJson,
        readAllCards,
        filterChangedFilesForScope,
        normalizeArray,
        writeJson,
      });
    case 'help':
    default:
      return printHelp();
  }
}

function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith('--')) {
      if (!options._) {
        options._ = [];
      }
      options._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    const hasValue = next && !next.startsWith('--');

    if (hasValue) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return options;
}

function initCommand(context) {
  ensureDir(context.entroRoot);

  [
    context.systemRoot,
    context.outputRoot,
    context.paths.config,
    path.join(context.paths.config, 'prompts'),
    path.join(context.paths.evidence, 'catalog'),
    path.join(context.paths.evidence, 'repo-scan'),
    path.join(context.paths.evidence, 'code'),
    path.join(context.paths.evidence, 'docs'),
    path.join(context.paths.evidence, 'git'),
    path.join(context.paths.evidence, 'human'),
    path.join(context.paths.evidence, 'bundles'),
    path.join(context.paths.tasks, 'queued'),
    path.join(context.paths.tasks, 'running'),
    path.join(context.paths.tasks, 'done'),
    path.join(context.paths.tasks, 'failed'),
    path.join(context.paths.candidates, 'topics'),
    path.join(context.paths.candidates, 'patterns'),
    path.join(context.paths.candidates, 'questions'),
    path.join(context.paths.cards, 'draft'),
    path.join(context.paths.cards, 'needs-human'),
    path.join(context.paths.cards, 'needs-review'),
    path.join(context.paths.cards, 'approved'),
    path.join(context.paths.cards, 'rejected'),
    path.join(context.paths.cards, 'deprecated'),
    path.join(context.paths.questions, 'open'),
    path.join(context.paths.questions, 'answered'),
    path.join(context.paths.questions, 'closed'),
    path.join(context.paths.answers, 'raw'),
    path.join(context.paths.answers, 'normalized'),
    path.join(context.paths.publications, 'skills'),
    path.join(context.paths.publications, 'reports'),
    path.join(context.paths.publications, 'sync-plans'),
    path.join(context.paths.snapshots, 'last-scan'),
    path.join(context.paths.snapshots, 'last-publish'),
    path.join(context.paths.runs, 'agent'),
    context.paths.drift,
    path.join(context.paths.eval, 'tasks'),
    path.join(context.paths.eval, 'runs'),
    path.join(context.paths.eval, 'reports'),
    context.paths.runtime,
    path.join(context.paths.runtime, 'codex-home'),
  ].forEach(ensureDir);

  writeJsonIfAbsent(path.join(context.paths.config, 'entro.config.json'), {
    version: 2,
    appRoot: toRepoRelative(context, context.appRoot),
    defaultScopes: ['publish', 'list', 'tracking'],
    language: 'zh-CN',
    publish: {
      writeToWorkspace: false,
      outputDir: path.join(ENTRO_DIR, OUTPUT_DIR),
    },
    humanInTheLoop: {
      channel: 'console',
      console: {
        editorHint: '通过 `entro question ask` 查看问题，再用 `entro answer` 录入人工补充上下文。',
      },
    },
    authoring: {
      language: 'zh-CN',
      audience: 'repo-maintainer',
      requireChineseArtifacts: true,
      requireStructuredSections: true,
      notesPlacement: 'section-only',
      style: {
        avoidLightFormat: true,
        avoidMixedLanguageTitles: true,
        preferActionableAdvice: true,
      },
    },
  });

  writeJsonIfAbsent(path.join(context.paths.config, 'scopes.json'), {
    scopes: [
      {
        id: 'publish',
        label: '商品发布',
        paths: [toRepoRelative(context, context.appRoot), 'packages/goods-sdk'],
        primaryRoots: [
          toRepoRelative(context, path.join(context.appRoot, 'src/pages/create-goods')),
          toRepoRelative(context, path.join(context.appRoot, 'src/biz-components')),
          'packages/goods-sdk',
        ],
        excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
      },
      {
        id: 'list',
        label: '商品列表',
        paths: [toRepoRelative(context, path.join(context.appRoot, 'src/pages/list'))],
        primaryRoots: [toRepoRelative(context, path.join(context.appRoot, 'src/pages/list'))],
        excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
      },
      {
        id: 'tracking',
        label: '商品埋点',
        paths: [toRepoRelative(context, context.appRoot), 'packages/goods-sdk'],
        primaryRoots: [toRepoRelative(context, context.appRoot), 'packages/goods-sdk'],
        excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
      },
    ],
  });

  writeJsonIfAbsent(path.join(context.paths.config, 'providers.json'), {
    default: 'codex_sdk',
    providers: {
      codex_sdk: {
        type: 'codex-sdk',
        model: 'default',
        timeout_ms: 12000,
        max_output_tokens: 16000,
      },
    },
  });

  writeJsonIfAbsent(path.join(context.paths.config, 'provider.env.json'), {
    providers: {
      codex_sdk: {},
    },
  });

  writeJsonIfAbsent(path.join(context.paths.config, 'source-rules.json'), {
    ignore: DEFAULT_IGNORE_RULES,
    derived: DEFAULT_DERIVED_RULES,
    process: DEFAULT_PROCESS_RULES,
    primaryDocs: DEFAULT_PRIMARY_DOC_RULES,
  });

  writeJsonIfAbsent(path.join(context.paths.config, 'owners.json'), buildOwnersConfig(context));

  writeJsonIfAbsent(path.join(context.paths.config, 'publish-rules.json'), {
    agentsKinds: ['rule', 'boundary'],
    skillKinds: ['workflow', 'recipe'],
    referenceKinds: ['counterexample'],
    minConfidence: 0.6,
    sync: {
      enabled: true,
      dryRunOnly: true,
    },
  });

  writeJsonIfAbsent(path.join(context.paths.config, 'schemas.json'), {
    cardVersion: 2,
    questionVersion: 2,
    answerVersion: 2,
    publicationVersion: 1,
  });

  writeTextIfAbsent(
    path.join(context.entroRoot, 'README.md'),
    [
      '# Entro',
      '',
      '这里保存当前应用的 entro 状态与产物。',
      '',
      '- `system/`：系统内部状态、中间产物、证据和运行记录',
      '- `output/`：对业务研发可见的 AGENTS/skills 草案与报告',
    ].join('\n'),
  );

  migrateConfigFile(context);
  migrateScopesConfig(context);
  migrateLegacyFiles(context);
  ensureOperationalSubdirs(context);
  ensureBuiltinPrompts();
  syncOpenQuestionsReport(context);

  console.log(`[entro] initialized at ${context.entroRoot}`);
}

function resolveScopes(scopes, scopeOption) {
  if (!scopeOption) {
    return scopes;
  }

  return scopes.filter(scope => scope.id === scopeOption);
}

function findOwner(pathsToCheck, ownersConfig) {
  const ownerRecord = ownersConfig.owners.find(entry =>
    pathsToCheck.some(candidate => entry.pattern.includes(candidate.replace(/^\//, ''))),
  );

  return ownerRecord ? ownerRecord.reviewers : [];
}

function collectScopeEvidence(scope, changedFiles) {
  return {
    paths: scope.paths,
    changedFiles,
  };
}

function buildScopeCardsFromPatterns(scope, patterns, { owner, changedFiles }) {
  return patterns.map(pattern =>
    createCard({
      id: `kc_${pattern.topic_id}`,
      kind: pattern.pattern_kind === 'workflow' ? 'workflow' : 'rule',
      title: pattern.title,
      status: 'draft',
      publishTarget: pattern.pattern_kind === 'workflow' ? 'skill' : 'agents',
      scopePaths: scope.paths,
      ownerHints: owner,
      confidence: pattern.confidence,
      triggers: [`处理 ${scope.id} 相关需求`, pattern.title],
      evidence: pattern.evidenceRefsPrimary,
      sections: {
        problem: buildProblemFromPattern(pattern),
        recommendation: buildRecommendationFromPattern(pattern),
        boundary: `适用于以下路径：${scope.paths.join('，')}`,
        evidence: renderEvidenceList(pattern.evidenceRefsPrimary),
      },
      lineage: {
        source: 'entro.mine.pattern',
        topicId: pattern.topic_id,
        changedFiles,
      },
    }),
  );
}

function discoverTopicsForScope(scope, sources, changedFiles = []) {
  const scopeSources = filterSourcesForScope(sources, scope).filter(source => source.evidence_class === 'primary');
  const grouped = new Map();

  scopeSources.forEach(source => {
    const topic = inferTopicFromSource(scope, source);
    if (!topic) {
      return;
    }
    const existing = grouped.get(topic.id) || {
      ...topic,
      evidence_refs_primary: [],
      changed_files: [],
      confidence: 0.7,
    };
    existing.evidence_refs_primary.push(source.path);
    grouped.set(topic.id, existing);
  });

  return Array.from(grouped.values()).map(topic => ({
    schemaVersion: 1,
    id: topic.id,
    scope: scope.id,
    title: topic.title,
    why_it_matters: topic.why_it_matters,
    evidence_refs_primary: uniqueBy(topic.evidence_refs_primary, item => item).slice(0, 12),
    changed_files: filterChangedFilesForScope(changedFiles, scope.paths),
    confidence: topic.confidence,
  }));
}

function buildPatternCandidates(scope, topics) {
  return topics.map(topic => {
    const patternKind = inferPatternKind(topic);
    const evidenceRefsPrimary = normalizeArray(topic.evidence_refs_primary);
    const sources = evidenceRefsPrimary.map(ref => String(ref).toLowerCase());
    const uncertaintyReasons = [];

    if (patternKind === 'workflow' && sources.length < 3) {
      uncertaintyReasons.push('工作流证据覆盖面不足，尚不足以支撑稳定默认路径。');
    }
    if (patternKind === 'workflow' && /开发流程|workflow/.test(String(topic.title))) {
      uncertaintyReasons.push('源码能证明链路存在，但无法仅凭静态证据判断团队当前默认推荐路径。');
    }
    if (patternKind === 'rule' && sources.some(item => item.includes('todo') || item.includes('demo'))) {
      uncertaintyReasons.push('部分证据来自示例或占位文件，需要确认是否代表正式实现。');
    }
    if (scope.id === 'publish' && topic.id === 'publish_form_item') {
      uncertaintyReasons.push(
        '仅能确认 PublishFormItem 是高频复用壳层，但“优先 simple component 还是 pg-* 实体组件”仍需要维护人确认。',
      );
    }
    if (scope.id === 'tracking' && topic.id === 'tracking_workflow') {
      uncertaintyReasons.push('当前同时看到了应用侧和 SDK 侧埋点封装，默认应该调用哪层 API 仍有歧义。');
    }
    if (scope.id === 'list' && topic.id === 'list_workflow') {
      uncertaintyReasons.push('列表容器的默认起步方案、是否默认启用预取与缓存策略，无法只靠静态代码直接下结论。');
    }

    return {
      schemaVersion: 1,
      id: `pattern_${topic.id}`,
      topic_id: topic.id,
      scope: scope.id,
      title: topic.title,
      pattern_kind: patternKind,
      statement: topic.why_it_matters,
      evidenceRefsPrimary,
      confidence: uncertaintyReasons.length ? 0.62 : topic.confidence,
      uncertainty: {
        requiresHuman: uncertaintyReasons.length > 0,
        reasons: uncertaintyReasons,
      },
    };
  });
}

function buildQuestionsFromPatterns(scope, patterns, owner) {
  return normalizeArray(patterns)
    .filter(pattern => pattern.uncertainty && pattern.uncertainty.requiresHuman)
    .map(pattern =>
      createQuestion({
        id: `q_${pattern.topic_id}_default_v1`,
        title: buildChoiceQuestionTitle(scope, pattern),
        level: 'scope-decision',
        scopePaths: scope.paths,
        owners: normalizeArray(owner),
        relatedCardIds: [`kc_${pattern.topic_id}`],
        prompt: buildChoiceQuestionPrompt(scope, pattern),
        background: buildChoiceQuestionBackground(scope, pattern),
        expectedAnswer: buildChoiceExpectedAnswer(scope, pattern),
        rationale: [
          '这个问题决定了最终沉淀是“推荐 skill”，还是只能保留成弱约束描述。',
          ...normalizeArray(pattern.uncertainty && pattern.uncertainty.reasons),
        ].join(' '),
      }),
    );
}

function buildProblemFromPattern(pattern) {
  const base = `${pattern.title} 是当前应用中值得沉淀的实现主题，需要把其高频改动点、关键约束或通用流程整理成可复用经验。`;
  const uncertainty = normalizeArray(pattern.uncertainty && pattern.uncertainty.reasons);
  if (!uncertainty.length) {
    return base;
  }
  return `${base}\n\n当前仍存在待确认点：${uncertainty.join('；')}`;
}

function buildRecommendationFromPattern(pattern) {
  if (pattern.uncertainty && pattern.uncertainty.requiresHuman) {
    return [
      `- 目前可以确认“${pattern.title}”在仓库内存在稳定实现，但默认推荐路径仍待维护人确认。`,
      '- 编码时优先沿已有实现入口补强，不要在未确认默认方案前额外发明新的接入方式。',
      `- 待确认点：${normalizeArray(pattern.uncertainty.reasons).join('；')}`,
    ].join('\n');
  }

  if (pattern.pattern_kind === 'workflow') {
    return [
      `1. 修改前先围绕“${pattern.title}”阅读相关实现入口与关键链路。`,
      '2. 先确认改动落点，再统一梳理相关状态、请求、联动和边界影响。',
      '3. 完成改动后，回头检查同主题下的初始化、刷新、校验或提交流程是否一起成立。',
    ].join('\n');
  }

  return [
    `- 涉及“${pattern.title}”时，优先保持现有实现链路的收敛与一致性。`,
    '- 不要把同一主题的逻辑拆散到多个无关层级，优先沿既有入口补强。',
    '- 改动前后都要确认关键边界条件与异常路径没有被破坏。',
  ].join('\n');
}

function filterSourcesForScope(sources, scope) {
  const scopePaths = normalizeArray(scope.primaryRoots).length
    ? normalizeArray(scope.primaryRoots)
    : normalizeArray(scope.paths);
  return normalizeArray(sources).filter(
    source =>
      source &&
      source.evidence_class === 'primary' &&
      source.source_role !== 'agent-guidance' &&
      scopePaths.some(scopePath => String(source.path || '').startsWith(scopePath)),
  );
}

function inferTopicFromSource(scope, source) {
  const sourcePath = source.path || '';

  if (scope.id === 'publish') {
    if (
      sourcePath.includes('publish-button') ||
      sourcePath.includes('asyncCheck') ||
      sourcePath.includes('publish-store')
    ) {
      return {
        id: 'publish_server_validation',
        title: '商品发布服务端校验与提交流程',
        why_it_matters: '发布链路涉及本地校验、异步校验、提交流程与错误协议，属于高风险改动点。',
      };
    }
    if (sourcePath.includes('publish-form-item') || sourcePath.includes('formItemProps')) {
      return {
        id: 'publish_form_item',
        title: '商品发布组件的表单壳能力复用',
        why_it_matters: '发布业务组件经常复用标签、错误、helper 与说明能力，适合沉淀统一模式。',
      };
    }
    if (
      sourcePath.includes('create-goods') ||
      sourcePath.includes('goods-container') ||
      sourcePath.includes('publish-layout')
    ) {
      return {
        id: 'publish_workflow',
        title: '商品发布开发流程',
        why_it_matters: '发布页链路长、分层多，适合先沉淀稳定流程和基本约束。',
      };
    }
  }

  if (scope.id === 'list') {
    if (sourcePath.includes('url-search-params') || sourcePath.includes('useManualSearch')) {
      return {
        id: 'list_url_sync',
        title: '商品列表 URL 同步与首搜行为',
        why_it_matters: 'URL 回放、reset 和首搜行为容易回归，适合沉淀统一约束。',
      };
    }
    if (sourcePath.includes('reach-optimize') || sourcePath.includes('listTractionItems')) {
      return {
        id: 'list_force_reach_optimize',
        title: '商品列表强触达优化区接入',
        why_it_matters: '列表中部运营区有独立数据流和渲染机制，属于高耦合扩展点。',
      };
    }
    if (sourcePath.includes('prefetch') || sourcePath.includes('searchComp') || sourcePath.includes('goodsList')) {
      return {
        id: 'list_workflow',
        title: '商品列表开发流程',
        why_it_matters: '列表页涉及 prefetch、SearchComp、tab 分流和表单状态，适合先沉淀通用流程。',
      };
    }
  }

  if (scope.id === 'tracking') {
    if (sourcePath.includes('sendEvent') || sourcePath.includes('reportEvent') || sourcePath.includes('tea')) {
      return {
        id: 'tracking_workflow',
        title: '商品埋点开发流程',
        why_it_matters: '埋点存在自动与手动两类链路，默认上报方式和验证路径容易分叉。',
      };
    }
  }

  return null;
}

function inferPatternKind(topic) {
  return topic.id.endsWith('workflow') ? 'workflow' : 'rule';
}

function buildChoiceQuestionTitle(scope, pattern) {
  if (scope.id === 'publish' && pattern.topic_id === 'publish_form_item') {
    return '新增发布组件时，默认先走哪条路径';
  }
  if (scope.id === 'tracking' && pattern.topic_id === 'tracking_workflow') {
    return '商品域业务埋点默认优先调用哪层 API';
  }
  if (scope.id === 'list' && pattern.topic_id === 'list_workflow') {
    return '新建商品列表页时，默认先从哪种容器起步';
  }
  if (scope.id === 'publish' && pattern.topic_id === 'publish_workflow') {
    return '处理发布需求时，默认先从哪层实现开始排查与修改';
  }
  return `确认“${pattern.title}”的默认推荐路径`;
}

function buildChoiceQuestionPrompt(scope, pattern) {
  if (scope.id === 'publish' && pattern.topic_id === 'publish_form_item') {
    return [
      '当需求是“新增一个发布页业务组件/字段”时，默认先采用哪条实现路径？',
      '请选择最符合团队当前默认做法的一项。',
    ].join('\n');
  }
  if (scope.id === 'tracking' && pattern.topic_id === 'tracking_workflow') {
    return ['当业务需要新增自定义埋点时，默认应优先调用哪层 API？', '请选择最符合团队当前默认做法的一项。'].join('\n');
  }
  if (scope.id === 'list' && pattern.topic_id === 'list_workflow') {
    return ['当新建一个典型的“筛选 + 列表”页面时，默认先从哪种容器起步？', '请选择最符合团队当前默认做法的一项。'].join(
      '\n',
    );
  }
  if (scope.id === 'publish' && pattern.topic_id === 'publish_workflow') {
    return ['接到一个典型的发布需求后，默认先从哪层实现开始定位和改动？', '请选择最符合团队当前默认做法的一项。'].join(
      '\n',
    );
  }
  return [
    `请确认“${scope.label} / ${pattern.title}”在当前仓库中的默认推荐路径。`,
    '请选择最符合团队当前默认做法的一项。',
  ].join('\n');
}

function buildChoiceQuestionBackground(scope, pattern) {
  if (scope.id === 'publish' && pattern.topic_id === 'publish_form_item') {
    return '源码能看出发布组件既有配置式做法，也有实体组件做法，但无法仅凭静态代码判断哪条才是团队默认起步路径。';
  }
  if (scope.id === 'tracking' && pattern.topic_id === 'tracking_workflow') {
    return '当前同时看到了应用侧和 SDK 侧埋点封装，需要维护人确认默认应该复用哪层 API。';
  }
  if (scope.id === 'list' && pattern.topic_id === 'list_workflow') {
    return '当前能看到列表页存在不同容器与预取策略，但无法仅凭静态代码判断团队新需求的默认起步方案。';
  }
  if (scope.id === 'publish' && pattern.topic_id === 'publish_workflow') {
    return '发布需求经常横跨应用层、goods-sdk、schema/actions 等多层，工具需要先确认维护人默认的排查和改动起点。';
  }
  return `当前仅从一手源码看到了“${pattern.title}”相关实现，但还无法可靠判断默认做法与例外边界。`;
}

function buildChoiceExpectedAnswer(scope, pattern) {
  return {
    mode: 'single_choice',
    allowComment: true,
    options: buildChoiceOptions(scope, pattern),
  };
}

function buildChoiceOptions(scope, pattern) {
  if (scope.id === 'publish' && pattern.topic_id === 'publish_form_item') {
    return [
      {
        id: 'simple_component_first',
        label: '优先 simple/config 组件',
        description: '如果本质上只是 schema 字段加基础控件，先走 config-components / MagicComponent 一类路径。',
      },
      {
        id: 'pg_component_first',
        label: '优先 pg-* 实体组件',
        description: '默认就新建或扩展 pg-* 业务组件，再接入映射与场景编排。',
      },
      {
        id: 'depends_on_complexity',
        label: '先看复杂度判断',
        description: '没有固定默认，先根据是否有副作用、额外请求、复杂交互来判断。',
      },
    ];
  }

  if (scope.id === 'tracking' && pattern.topic_id === 'tracking_workflow') {
    return [
      {
        id: 'sdk_send_event',
        label: '优先 SDK 封装',
        description: '默认复用 goods-sdk 里统一封装的埋点 API，再由工具层分发。',
      },
      {
        id: 'app_tea_wrapper',
        label: '优先应用侧封装',
        description: '默认从 ffa-goods 应用自己的 tea 封装出发。',
      },
      {
        id: 'depends_on_event_kind',
        label: '按埋点类型区分',
        description: '自动埋点、业务事件、特殊口径分别走不同 API，没有单一默认值。',
      },
    ];
  }

  if (scope.id === 'list' && pattern.topic_id === 'list_workflow') {
    return [
      {
        id: 'search_first',
        label: '先用 Search',
        description: '默认从更基础的 Search 容器起步，只有明确性能诉求再升级。',
      },
      {
        id: 'swr_search_first',
        label: '先用 SwrSearch',
        description: '默认直接走带缓存/预取能力的容器。',
      },
      {
        id: 'depends_on_scenario',
        label: '按场景判断',
        description: '没有统一默认，要先看 tab、缓存、首屏性能和数据体量。',
      },
    ];
  }

  if (scope.id === 'publish' && pattern.topic_id === 'publish_workflow') {
    return [
      {
        id: 'app_layer_first',
        label: '先看应用层页面/容器',
        description: '默认先从 create-goods、biz-components、场景页面入口排查，再下钻到 SDK。',
      },
      {
        id: 'schema_actions_first',
        label: '先看 schema/actions',
        description: '默认先判断能否在 schema 配置、联动 actions、helper 配置层解决。',
      },
      {
        id: 'sdk_component_first',
        label: '先看 goods-sdk 组件',
        description: '默认先从 pg-*、publish-view、publish-layout 等共享层排查和改动。',
      },
    ];
  }

  return [
    {
      id: 'option_a',
      label: '方案 A',
      description: '默认推荐路径 A。',
    },
    {
      id: 'option_b',
      label: '方案 B',
      description: '默认推荐路径 B。',
    },
  ];
}

function ensureInitialized(context) {
  if (!fs.existsSync(context.entroRoot)) {
    throw new Error('entro is not initialized. Run `entro init` first.');
  }
}

function filterChangedFilesForScope(changedFiles, scopePaths) {
  return changedFiles.filter(file => scopePaths.some(scopePath => file.startsWith(scopePath)));
}

async function promptForAnswer(question) {
  console.log(`正在回答问题 ${question.meta.id}`);
  console.log(`提问：${question.body.prompt}`);
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    normalizeArray(question.body.expectedAnswer.options).forEach((option, index) => {
      console.log(`${index + 1}. [${option.id}] ${option.label}`);
      if (option.description) {
        console.log(`   ${option.description}`);
      }
    });
  } else {
    console.log(
      `期望字段：${(question.body.expectedAnswer && question.body.expectedAnswer.fields.join(', ')) || '自由回答'}`,
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    const selected = await new Promise(resolve => {
      rl.question('请输入选项编号或 option id：', value => {
        resolve(value);
      });
    });
    const comment = await new Promise(resolve => {
      rl.question('可选补充备注（可留空）：', value => {
        rl.close();
        resolve(value);
      });
    });
    return {
      selected: String(selected || '').trim(),
      comment: String(comment || '').trim(),
      rawText: String(selected || '').trim() + (comment ? `\ncomment: ${comment}` : ''),
    };
  }

  const answer = await new Promise(resolve => {
    rl.question('请输入回答：', value => {
      rl.close();
      resolve(value);
    });
  });

  return {
    rawText: answer,
  };
}

function getLastAnswerRef(question) {
  const refs = normalizeArray(question.body.answerRefs);
  return refs.length ? refs[refs.length - 1] : null;
}

function normalizeAnswer(question, answer) {
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    return normalizeSingleChoiceAnswer(question, answer);
  }

  const expectedFields = (question.body.expectedAnswer && normalizeArray(question.body.expectedAnswer.fields)) || [];
  const rawText = (answer.body.rawText || '').trim();
  const lower = rawText.toLowerCase();
  const extracted = {};

  expectedFields.forEach(field => {
    const regex = new RegExp(`${field}\\s*[:=]\\s*(.+)`, 'i');
    const match = rawText.match(regex);
    if (match) {
      extracted[field] = match[1].trim();
    }
  });

  const missingFields = expectedFields.filter(field => !extracted[field]);
  const sufficient =
    rawText.length > 0 &&
    (missingFields.length === 0 ||
      (expectedFields.length === 0 && rawText.length > 20) ||
      (expectedFields.length > 0 && lower.includes('scope') && lower.includes('path')));

  return {
    schemaVersion: 2,
    meta: {
      id: answer.meta.id,
      questionId: question.meta.id,
      normalizedAt: new Date().toISOString(),
    },
    body: {
      rawText,
      extracted,
    },
    judgement: {
      sufficient,
      missingFields: sufficient ? [] : missingFields,
    },
  };
}

function normalizeSingleChoiceAnswer(question, answer) {
  const options = normalizeArray(question.body.expectedAnswer && question.body.expectedAnswer.options);
  const selectedRaw = String(answer.body.selected || answer.body.rawText || '').trim();
  const normalizedSelected = normalizeSingleChoiceValue(selectedRaw, options);
  const matchedOption = options.find(option => option.id === normalizedSelected) || null;

  return {
    schemaVersion: 2,
    meta: {
      id: answer.meta.id,
      questionId: question.meta.id,
      normalizedAt: new Date().toISOString(),
    },
    body: {
      rawText: answer.body.rawText || selectedRaw,
      selectedOptionId: normalizedSelected || null,
      selectedOptionLabel: matchedOption ? matchedOption.label : null,
      comment: String(answer.body.comment || '').trim(),
      extracted: {
        selected_option_id: normalizedSelected || '',
        selected_option_label: matchedOption ? matchedOption.label : '',
        comment: String(answer.body.comment || '').trim(),
      },
    },
    judgement: {
      sufficient: Boolean(matchedOption),
      missingFields: matchedOption ? [] : ['selected_option_id'],
    },
  };
}

function normalizeSingleChoiceValue(rawValue, options) {
  if (!rawValue) {
    return '';
  }

  const trimmed = String(rawValue).trim();
  const byId = options.find(option => option.id === trimmed);
  if (byId) {
    return byId.id;
  }

  const byIndex = Number(trimmed);
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= options.length) {
    return options[byIndex - 1].id;
  }

  return '';
}

function buildAnswerPayloadFromText(question, text) {
  const raw = String(text || '').trim();
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    return {
      selected: raw,
      comment: '',
      rawText: raw,
    };
  }

  return {
    rawText: raw,
  };
}

function printHelp() {
  console.log(
    [
      'entro 命令：',
      '  init',
      '  classify-sources',
      '  scan [--scope <scope>] [--changed-only --base <ref>]',
      '  mine [--scope <scope>]',
      '  question [list|ask --id <questionId>]',
      '  answer --question <questionId> [--text <answer>]',
      '  reconcile --question <questionId> [--answer <answerId>]',
      '  review --card <cardId> --decision <approve|reject|deprecate> [--note <note>]',
      '  enrich',
      '  publish [--dry-run]',
      '  diff',
    ].join('\n'),
  );
}

function sanitizeLeadingClause(value) {
  return String(value)
    .replace(/^only\s+upgrade\s+to\s+/i, '')
    .replace(/^do\s+not\s+/i, '')
    .replace(/^use\s+/i, 'use ')
    .replace(/^there\s+is\s+/i, '')
    .replace(/^only\s+when\s+/i, '')
    .trim();
}

function loadDefaultProvider(context) {
  const providersConfig = readJson(path.join(context.paths.config, 'providers.json')) || {
    default: 'codex_sdk',
    providers: {},
  };
  const providerEnvConfig = readJson(path.join(context.paths.config, 'provider.env.json')) || {
    providers: {},
  };
  const providerId = providersConfig.default || 'codex_sdk';
  const provider = (providersConfig.providers && providersConfig.providers[providerId]) || {};
  const providerEnv = (providerEnvConfig.providers && providerEnvConfig.providers[providerId]) || {};

  return {
    id: providerId,
    type: provider.type || 'codex-sdk',
    timeout_ms: provider.timeout_ms || 12000,
    max_output_tokens: provider.max_output_tokens || 16000,
  };
}

function persistAgentRun(context, { stage, provider, input, output, options }) {
  const runId = `${stage}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    schemaVersion: 1,
    id: runId,
    stage,
    provider,
    createdAt: new Date().toISOString(),
    mode: 'scaffold',
    options: {
      scope: options.scope || null,
      changedOnly: Boolean(options['changed-only']),
      base: options.base || null,
    },
    input,
    output,
  };

  writeJson(path.join(context.paths.runs, 'agent', `${runId}.json`), record);
  return record;
}

export { run };
