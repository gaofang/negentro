import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toRepoRelative } from '../context.js';
import { CARD_STATUSES, QUESTION_STATUSES } from '../shared/constants.js';
import { normalizeArray } from '../shared/collections.js';
import { readJson, writeJson, writeText, writeTextIfAbsent, ensureDir } from '../shared/fs.js';
import {
  normalizePublishConfig,
  normalizeQuestionDocument,
  readCard,
  writeCardV2,
} from '../domain/artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function migrateLegacyFiles(context) {
  migrateLegacyEntroLayout(context);
  migrateConfigFile(context);
  migrateScopesConfig(context);
  migrateProvidersConfig(context);
  migrateLegacyConfig(context);
  migrateLegacyCards(context);
  migrateLegacyQuestions(context);
}

function ensureOperationalSubdirs(context) {
  [
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
  ].forEach(ensureDir);
}

function clearGeneratedCandidateState(context) {
  [
    path.join(context.paths.candidates, 'topics'),
    path.join(context.paths.candidates, 'patterns'),
    path.join(context.paths.candidates, 'questions'),
  ].forEach(clearJsonDirectory);
}

function clearGeneratedOpenQuestions(context) {
  clearJsonDirectory(path.join(context.paths.questions, 'open'));
}

function clearScopeGeneratedState(context, scopes) {
  const scopePaths = normalizeArray(scopes).flatMap(scope => normalizeArray(scope.paths));
  if (!scopePaths.length) {
    clearGeneratedCandidateState(context);
    clearGeneratedOpenQuestions(context);
    clearScopeDraftCards(context, []);
    return;
  }

  [
    path.join(context.paths.candidates, 'topics'),
    path.join(context.paths.candidates, 'patterns'),
    path.join(context.paths.candidates, 'questions'),
  ].forEach(directory => {
    clearJsonDirectoryByPredicate(directory, filePath => belongsToScope(filePath, scopePaths));
  });

  clearJsonDirectoryByPredicate(path.join(context.paths.questions, 'open'), filePath => belongsToScope(filePath, scopePaths));
  clearScopeDraftCards(context, scopePaths);
}

function clearScopeDraftCards(context, scopePaths) {
  clearJsonDirectoryByPredicate(path.join(context.paths.cards, 'draft'), filePath => belongsToScope(filePath, scopePaths));
  clearJsonDirectoryByPredicate(path.join(context.paths.cards, 'needs-human'), filePath => belongsToScope(filePath, scopePaths));
}

function clearJsonDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  fs.readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .forEach(file => {
      fs.unlinkSync(path.join(directory, file));
    });
}

function clearJsonDirectoryByPredicate(directory, predicate) {
  if (!fs.existsSync(directory)) {
    return;
  }

  fs.readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .forEach(file => {
      const filePath = path.join(directory, file);
      if (predicate(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
}

function belongsToScope(filePath, scopePaths) {
  const document = readJson(filePath);
  if (!document) {
    return false;
  }

  const candidatePaths =
    normalizeArray(document.scopePaths)
      .concat(normalizeArray(document.meta && document.meta.scopePaths))
      .concat(normalizeArray(document.scope))
      .concat(typeof document.scope === 'string' ? [document.scope] : []);

  if (!candidatePaths.length) {
    return false;
  }

  return candidatePaths.some(candidate =>
    normalizeArray(scopePaths).some(scopePath =>
      String(candidate || '').startsWith(scopePath) || String(scopePath || '').startsWith(String(candidate || '')),
    ),
  );
}

function migrateConfigFile(context) {
  const configPath = path.join(context.paths.config, 'entro.config.json');
  const config = readJson(configPath);
  if (!config) {
    return;
  }

  const normalized = {
    version: 2,
    defaultScopes: config.defaultScopes || ['app'],
    publish: normalizePublishConfig(config.publish || {}),
    humanInTheLoop: {
      channel: (config.humanInTheLoop && config.humanInTheLoop.channel) || 'console',
      console: {
        editorHint: '通过 `entro question ask` 查看问题，再用 `entro answer` 录入人工补充上下文。',
        ...((config.humanInTheLoop && config.humanInTheLoop.console) || {}),
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
      ...(config.authoring || {}),
    },
  };

  writeJson(configPath, normalized);
}

function migrateLegacyConfig(context) {
  const legacyPath = path.join(context.paths.config, 'knowledge.config.json');
  const targetPath = path.join(context.paths.config, 'entro.config.json');
  if (fs.existsSync(legacyPath) && !fs.existsSync(targetPath)) {
    fs.renameSync(legacyPath, targetPath);
  }
}

function migrateProvidersConfig(context) {
  const providersPath = path.join(context.paths.config, 'providers.json');
  const config = readJson(providersPath);
  if (!config || !config.providers) {
    return;
  }

  const normalizedProviders = {};
  let changed = false;

  Object.entries(config.providers).forEach(([providerId, providerConfig]) => {
    if (providerConfig && providerConfig.type === 'codex-cli') {
      normalizedProviders.codex_sdk = {
        type: 'codex-sdk',
        model: providerConfig.model || 'default',
        timeout_ms: Math.min(Number(providerConfig.timeout_ms) || 12000, 12000),
        max_output_tokens: providerConfig.max_output_tokens || 16000,
      };
      changed = true;
      return;
    }

    normalizedProviders[providerId] = providerConfig;
  });

  if (!Object.keys(normalizedProviders).length) {
    normalizedProviders.codex_sdk = {
      type: 'codex-sdk',
      model: 'default',
      timeout_ms: 12000,
      max_output_tokens: 16000,
    };
    changed = true;
  }

  const currentDefault = config.default || 'codex_sdk';
  const nextDefault =
    currentDefault === 'codex' ||
    currentDefault === 'codex_cli' ||
    (config.providers[currentDefault] && config.providers[currentDefault].type === 'codex-cli')
      ? 'codex_sdk'
      : currentDefault;

  if (nextDefault !== currentDefault) {
    changed = true;
  }

  if (changed) {
    writeJson(providersPath, {
      ...config,
      default: nextDefault,
      providers: normalizedProviders,
    });
  }

  const providerEnvPath = path.join(context.paths.config, 'provider.env.json');
  const providerEnvConfig = readJson(providerEnvPath);
  if (providerEnvConfig && providerEnvConfig.providers && providerEnvConfig.providers.codex_sdk) {
    const current = providerEnvConfig.providers.codex_sdk;
    const normalizedCurrent = {};
    if (JSON.stringify(current) !== JSON.stringify(normalizedCurrent)) {
      writeJson(providerEnvPath, {
        ...providerEnvConfig,
        providers: {
          ...providerEnvConfig.providers,
          codex_sdk: normalizedCurrent,
        },
      });
    }
  }
}

function migrateLegacyCards(context) {
  CARD_STATUSES.forEach(status => {
    const directory = path.join(context.paths.cards, status);
    if (!fs.existsSync(directory)) {
      return;
    }
    fs.readdirSync(directory)
      .filter(file => file.endsWith('.md'))
      .forEach(file => {
        const legacyPath = path.join(directory, file);
        const card = readCard(legacyPath);
        const targetPath = path.join(directory, `${card.meta.id}.json`);
        writeCardV2(targetPath, card);
        fs.unlinkSync(legacyPath);
      });
  });
}

function migrateLegacyQuestions(context) {
  QUESTION_STATUSES.forEach(status => {
    const directory = path.join(context.paths.questions, status);
    if (!fs.existsSync(directory)) {
      return;
    }
    fs.readdirSync(directory)
      .filter(file => file.endsWith('.json'))
      .forEach(file => {
        const filePath = path.join(directory, file);
        const question = readJson(filePath);
        if (question && question.schemaVersion === 2) {
          const normalizedQuestion = normalizeQuestionDocument(question);
          if (JSON.stringify(normalizedQuestion) !== JSON.stringify(question)) {
            writeJson(filePath, normalizedQuestion);
          }
          return;
        }
        const migrated = {
          schemaVersion: 2,
          meta: {
            id: question.id,
            status: question.status,
            level: question.level,
            scopePaths: question.scope || [],
            owners: question.owner || [],
            relatedCardIds: question.relatedCards || [],
            createdAt: question.createdAt || new Date().toISOString(),
            updatedAt: question.createdAt || new Date().toISOString(),
          },
          body: {
            title: question.title || question.id,
            prompt: question.prompt,
            background: question.background || '',
            expectedAnswer: {
              fields: [],
            },
            rationale: '',
            answerRefs: [],
            followUpFrom: null,
            reconciliation: null,
          },
        };
        writeJson(filePath, normalizeQuestionDocument(migrated));
      });
  });
}

function migrateScopesConfig(context) {
  const scopesPath = path.join(context.paths.config, 'scopes.json');
  const config = readJson(scopesPath);
  if (!config || !Array.isArray(config.scopes)) {
    return;
  }

  let changed = false;
  const scopes = config.scopes.map(scope => {
    const normalizedScope = {
      ...scope,
      id: normalizeScopeId(scope.id),
      label: scope.label || scope.id,
      paths: normalizeArray(scope.paths),
      primaryRoots: normalizeArray(scope.primaryRoots).length ? normalizeArray(scope.primaryRoots) : normalizeArray(scope.paths),
      excludeRoots: normalizeArray(scope.excludeRoots).length
        ? normalizeArray(scope.excludeRoots)
        : ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
    };

    if (JSON.stringify(normalizedScope) !== JSON.stringify(scope)) {
      changed = true;
    }

    return normalizedScope;
  });

  if (changed) {
    writeJson(scopesPath, {
      ...config,
      scopes,
    });
  }
}

function syncOpenQuestionsReport(context) {
  const openDirectory = path.join(context.paths.questions, 'open');
  const files = fs.existsSync(openDirectory)
    ? fs.readdirSync(openDirectory).filter(file => file.endsWith('.json')).sort()
    : [];

  const lines = [
    '# 待确认问题',
    '',
  ];

  if (!files.length) {
    lines.push('当前没有待确认问题。', '');
  } else {
    files.forEach(file => {
      const question = readJson(path.join(openDirectory, file));
      lines.push(`## ${question.body.title}`);
      lines.push('');
      lines.push(`- ID：${question.meta.id}`);
      lines.push(`- 提问：${question.body.prompt}`);
      lines.push(`- 背景：${question.body.background}`);
      if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
        lines.push('- 可选项：');
        normalizeArray(question.body.expectedAnswer.options).forEach((option, index) => {
          lines.push(`  ${index + 1}. [${option.id}] ${option.label}：${option.description || ''}`);
        });
      }
      lines.push('');
    });
  }

  ensureDir(path.join(context.paths.runtime, 'hitl'));
  writeText(path.join(context.paths.runtime, 'hitl', 'questions.todo.md'), lines.join('\n'));
}

function ensureBuiltinPrompts() {
  const promptsDir = path.join(__dirname, '..', '..', 'prompts');
  ensureDir(promptsDir);

  writeTextIfAbsent(path.join(promptsDir, 'topic_discovery.md'), [
    '你是仓库经验主题发现器。',
    '任务：只基于提供的 primary evidence，识别当前应用中值得沉淀的高价值主题。',
    '要求：',
    '1. 不要引用 skills、AGENTS.md、.entro 产物作为结论依据。',
    '2. 每个主题必须附带 primary evidence。',
    '3. 输出必须结构化，且面向中文维护人可读。',
  ].join('\n'));

  writeTextIfAbsent(path.join(promptsDir, 'pattern_mining.md'), [
    '你是仓库经验模式归纳器。',
    '任务：只基于 primary evidence，识别稳定模式、实现分叉、反模式与高价值歧义。',
    '要求：',
    '1. 结论必须有证据支撑。',
    '2. 如果无法判断默认推荐路径，要显式标记需要人工确认。',
    '3. 不要从 skills、AGENTS 或 .entro 产物反向学习。',
  ].join('\n'));

  writeTextIfAbsent(path.join(promptsDir, 'question_generation.md'), [
    '你是仓库经验提问器。',
    '任务：把高价值歧义转换成面向维护人的确认问题。',
    '要求：',
    '1. 只问推荐路径、边界、例外，不问代码已能确认的事实。',
    '2. 问题、背景、预期回答都使用中文。',
    '3. 必须说明该问题为什么值得确认。',
  ].join('\n'));

  writeTextIfAbsent(path.join(promptsDir, 'card_synthesis.md'), [
    '你是仓库经验卡片合成器。',
    '任务：将已确认或证据充分的模式组织为中文经验卡。',
    '要求：',
    '1. 清晰区分适用问题、推荐做法、适用边界与取证来源。',
    '2. 不能夸大证据结论。',
    '3. 若存在未确认歧义，不得伪装成确定规则。',
  ].join('\n'));

  writeTextIfAbsent(path.join(promptsDir, 'repository_distillation.md'), [
    '你是仓库经验蒸馏 agent。',
    '任务：只基于提供的 primary evidence，一次性产出当前应用的主题、模式、待确认问题和草稿卡片。',
    '要求：',
    '1. 只能使用输入中的 primary evidence，不得参考 AGENTS.md、skills、.entro 等派生产物。',
    '2. 输出必须严格符合 schema，只返回 JSON，不要解释。',
    '3. 问题优先生成单点确认式单选题，减少维护人心智负担。',
    '4. 如果默认路径不确定，必须通过 question 表达不确定性，不能伪装成确定规则。',
    '5. 结论、问题、卡片正文全部使用中文。',
  ].join('\n'));

  writeTextIfAbsent(path.join(promptsDir, 'artifact_consolidation.md'), [
    '你是仓库经验产物归纳 agent。',
    '任务：只基于输入中的 resolvedSeeds、cards、openQuestions、源码目录快照、source paths、package.json 信息，归纳出最终面向研发可消费的 AGENTS.md 与通用 skills。',
    '要求：',
    '1. 不能预设 skill 分类，不要套固定 taxonomy，必须从输入证据归纳。',
    '2. skills 必须是跨页面、跨模块可复用的实现模式；如果某条经验只在单一页面成立，不要升级成通用 skill。',
    '3. AGENTS.md 必须是项目级画像和规范，不要与 skill 重复，不要写成经验卡片拼接。',
    '4. 严禁使用 AGENTS、skills、.entro 产物作为证据来源；只能使用输入中提供的 cards、questions、source paths、app scan 信息。',
    '5. 如果某类模式证据不足以支撑“通用经验”，宁可不产出，也不要强行泛化。',
    '6. 输出必须严格符合 schema，只返回 JSON，不要解释。',
    '7. 所有标题、正文、问题都使用中文。',
    '8. resolvedSeeds 是一级输入：如果某个模式已经通过种子抽取被明确解析，优先以 resolvedSeeds 为准，再用 cards/source paths 补充证据和边界。',
    '9. requiredResolvedSeeds 是最高优先级输入：这些是“AI 不能猜错的固定开发模式”，最终 skills 必须优先覆盖它们；不要被页面型 cards 冲淡。',
    '10. 对于已经在 resolvedSeeds 中明确给出默认规则的模式，优先直接生成面向生码的 skill；只有当它明显只是单页案例时才放弃。',
    '',
    'AGENTS.md 生成目标：为单个 Monorepo 子项目生成完整的 Project Rules 文档，帮助团队统一开发标准。',
    'AGENTS.md 必须优先覆盖以下内容：',
    '1. 项目概述：说明功能定位、应用类型、基础组件库。',
    '2. 目录结构规范：按目录层级说明各文件夹作用，尤其是 pages、components、hooks、utils、services、constants、types。',
    '3. 编码规范：文件格式、命名规范、TypeScript 类型安全要求、导入/遍历/解构等最佳实践。',
    '4. 组件开发规范：React 函数组件约定、Props 类型定义、样式约定、Hooks 使用规范、组件库使用规范。',
    '5. 状态管理与数据流：全局状态工具、复杂逻辑封装位置、分页/缓存/虚拟滚动等性能策略。',
    '6. 性能与错误处理：列表性能、组件缓存、API 错误处理、用户提示、错误边界等。',
    '7. 特殊规则：区分 PC/H5、移动端适配、公共组件抽取约定；如果证据不足可以保守描述。',
    '8. 核心依赖组件：必须结合 package.json 输入归纳。',
    'AGENTS.md 必须聚焦当前子项目，不要扩散到其他子项目。',
    '',
    'skills 生成目标：沉淀“在该子项目中跨页面复用的开发模式”，例如接口组织、埋点接入、搜索列表、抽屉弹窗、表单提交、常量映射等。',
    'skills 归纳要求：',
    '1. 如果某经验无法跨两个及以上页面/模块复用，不要生成 skill。',
    '2. skill 标题应该描述“实现模式”，不要直接使用页面名、业务名、具体模块名作为标题主体。',
    '3. 推荐做法必须能指导后续生码 agent 编码，既要可执行，也要避免伪泛化。',
    '4. skill 与 AGENTS.md 要分工明确：AGENTS.md 讲项目规则，skill 讲具体实现模式。',
    '5. 如果 resolvedSeeds 中已经给出了默认规则、Do、Don\'t、snippet，应优先转化为 skill 内容，而不是重新发明另一套表述。',
    '6. 最终 skill 应尽量包含：适用问题、默认推荐、Do、Don\'t、最小代码片段、适用边界、验证清单、取证来源。',
    '7. 优先产出“固定开发模式”skill，例如：HTTP 请求入口、接口分层、错误/埋点上报、弹窗默认打开方式、搜索列表默认骨架、权限接入方式；谨慎产出某个页面流转套路。',
    '8. 如果一个候选 skill 的取证来源主要集中在单一页面目录，默认不要产出。',
  ].join('\n'));

  writeTextIfAbsent(path.join(promptsDir, 'seed_extraction.md'), [
    '你是固定开发模式提取 agent。',
    '任务：围绕输入中的一个 seed 问题，只基于给定代码证据、相关 cards 和项目上下文，提取当前项目关于该问题的默认开发模式。',
    '要求：',
    '1. 必须先判断该问题在当前项目中是否存在稳定默认路径。',
    '2. 如果存在稳定默认路径，输出 resolved，并给出默认规则、Do、Don\'t、最小代码片段、适用边界和取证来源。',
    '3. 如果候选模式并存且无法确定默认路径，输出 needs_human，并把候选模式收敛成一个单选确认问题。',
    '4. 如果该问题在当前项目中缺乏相关证据，输出 unsupported，不要强行编造答案。',
    '5. 严禁发明私有 API、私有组件名或 import path；所有结论都必须能被 evidenceRefs 支撑。',
    '6. 输出必须严格符合 schema，只返回 JSON，不要解释。',
    '7. 所有标题、正文、问题、选项都使用中文。',
  ].join('\n'));
}

function normalizeScopeId(value) {
  return String(value || '').trim() || 'app';
}

function migrateLegacyEntroLayout(context) {
  const legacyDirectories = [
    'config',
    'evidence',
    'cards',
    'questions',
    'answers',
    'snapshots',
    'eval',
  ];

  legacyDirectories.forEach(name => {
    const legacyPath = path.join(context.entroRoot, name);
    const targetPath = path.join(context.systemRoot, name);
    if (!fs.existsSync(legacyPath) || fs.existsSync(targetPath)) {
      return;
    }
    ensureDir(path.dirname(targetPath));
    fs.renameSync(legacyPath, targetPath);
  });

  const legacyPublications = path.join(context.entroRoot, 'publications');
  if (fs.existsSync(legacyPublications)) {
    const legacyAgents = path.join(legacyPublications, 'agents', 'AGENTS.generated.md');
    const nextAgents = path.join(context.outputRoot, 'AGENTS.generated.md');
    if (fs.existsSync(legacyAgents) && !fs.existsSync(nextAgents)) {
      ensureDir(path.dirname(nextAgents));
      fs.copyFileSync(legacyAgents, nextAgents);
    }

    const legacySkills = path.join(legacyPublications, 'skills');
    const nextSkills = path.join(context.outputRoot, 'skills');
    if (fs.existsSync(legacySkills) && !fs.existsSync(nextSkills)) {
      copyDirectory(legacySkills, nextSkills);
    }

    const legacyReports = path.join(legacyPublications, 'reports');
    const nextReports = path.join(context.outputRoot, 'reports');
    if (fs.existsSync(legacyReports) && !fs.existsSync(nextReports)) {
      copyDirectory(legacyReports, nextReports);
    }

    const legacySyncPlans = path.join(legacyPublications, 'sync-plans');
    const nextSyncPlans = path.join(context.outputRoot, 'sync-plans');
    if (fs.existsSync(legacySyncPlans) && !fs.existsSync(nextSyncPlans)) {
      copyDirectory(legacySyncPlans, nextSyncPlans);
    }
  }
}

function copyDirectory(source, target) {
  ensureDir(target);
  fs.readdirSync(source, { withFileTypes: true }).forEach(entry => {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}

export {
  migrateLegacyFiles,
  ensureOperationalSubdirs,
  clearGeneratedCandidateState,
  clearGeneratedOpenQuestions,
  clearScopeGeneratedState,
  migrateConfigFile,
  migrateScopesConfig,
  migrateProvidersConfig,
  syncOpenQuestionsReport,
  ensureBuiltinPrompts,
};
