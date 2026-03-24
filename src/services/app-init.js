import path from 'path';
import { toRepoRelative } from '../context.js';
import {
  DEFAULT_DERIVED_RULES,
  DEFAULT_IGNORE_RULES,
  DEFAULT_PRIMARY_DOC_RULES,
  DEFAULT_PROCESS_RULES,
  ENTRO_DIR,
  OUTPUT_DIR,
} from '../shared/constants.js';
import { ensureDir, writeJsonIfAbsent, writeTextIfAbsent } from '../shared/fs.js';
import { buildOwnersConfig } from './repo-scan.js';
import {
  ensureBuiltinPrompts,
  ensureOperationalSubdirs,
  migrateConfigFile,
  migrateLegacyFiles,
  migrateScopesConfig,
  syncOpenQuestionsReport,
} from './state.js';

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
    path.join(context.paths.snapshots, 'last-scan'),
    path.join(context.paths.snapshots, 'last-publish'),
    path.join(context.paths.runs, 'agent'),
    context.paths.drift,
    path.join(context.paths.eval, 'tasks'),
    path.join(context.paths.eval, 'runs'),
    path.join(context.paths.eval, 'reports'),
    context.paths.runtime,
    path.join(context.paths.runtime, 'codex-home'),
    path.join(context.paths.runtime, 'reports'),
    path.join(context.paths.runtime, 'sync-plans'),
    path.join(context.paths.runtime, 'hitl'),
    path.join(context.paths.runtime, 'consolidation'),
  ].forEach(ensureDir);

  writeJsonIfAbsent(path.join(context.paths.config, 'entro.config.json'), {
    version: 2,
    appRoot: toRepoRelative(context, context.appRoot),
    defaultScopes: ['app'],
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
        id: 'app',
        label: '应用默认范围',
        paths: [toRepoRelative(context, context.appRoot)],
        primaryRoots: [toRepoRelative(context, context.appRoot)],
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

export {
  initCommand,
};
