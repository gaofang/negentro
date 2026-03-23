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

function migrateConfigFile(context) {
  const configPath = path.join(context.paths.config, 'entro.config.json');
  const config = readJson(configPath);
  if (!config) {
    return;
  }

  const normalized = {
    version: 2,
    defaultScopes: config.defaultScopes || ['goods.publish', 'goods.list', 'goods.tracking'],
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

  const defaults = {
    publish: {
      label: '商品发布',
      primaryRoots: [
        toRepoRelative(context, path.join(context.appRoot, 'src/pages/create-goods')),
        toRepoRelative(context, path.join(context.appRoot, 'src/biz-components')),
        'packages/goods-sdk',
      ],
      excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
    },
    list: {
      label: '商品列表',
      primaryRoots: [toRepoRelative(context, path.join(context.appRoot, 'src/pages/list'))],
      excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
    },
    tracking: {
      label: '商品埋点',
      primaryRoots: [toRepoRelative(context, context.appRoot), 'packages/goods-sdk'],
      excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
    },
  };

  let changed = false;
  const scopes = config.scopes.map(scope => {
    const nextId = normalizeScopeId(scope.id);
    const preset = defaults[nextId];
    if (!preset) {
      return {
        ...scope,
        id: nextId,
      };
    }

    const merged = {
      ...scope,
      id: nextId,
      label: preset.label,
      primaryRoots: preset.primaryRoots,
      excludeRoots: preset.excludeRoots,
    };

    if (JSON.stringify(merged) !== JSON.stringify(scope)) {
      changed = true;
    }

    return merged;
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

  writeText(path.join(context.paths.publications, 'questions.todo.md'), lines.join('\n'));
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
}

function normalizeScopeId(value) {
  if (value === 'goods.publish') {
    return 'publish';
  }
  if (value === 'goods.list') {
    return 'list';
  }
  if (value === 'goods.tracking') {
    return 'tracking';
  }
  return value;
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
  migrateConfigFile,
  migrateScopesConfig,
  migrateProvidersConfig,
  syncOpenQuestionsReport,
  ensureBuiltinPrompts,
};
