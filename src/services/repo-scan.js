import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  DEFAULT_IGNORE_RULES,
  DEFAULT_DERIVED_RULES,
  DEFAULT_PROCESS_RULES,
  DEFAULT_PRIMARY_DOC_RULES,
} from '../shared/constants.js';
import { normalizeArray, uniqueBy } from '../shared/collections.js';
import { readJson, writeJson } from '../shared/fs.js';

function buildOwnersConfig(context) {
  const ownersFile = path.join(context.workspaceRoot, 'OWNERS');
  const contents = fs.existsSync(ownersFile) ? fs.readFileSync(ownersFile, 'utf8') : '';
  const owners = [];
  let currentPattern = null;

  contents.split('\n').forEach(line => {
    if (line.startsWith('  "/')) {
      const match = line.match(/"(.+)":/);
      if (match) {
        currentPattern = {
          pattern: match[1],
          reviewers: [],
        };
        owners.push(currentPattern);
      }
      return;
    }

    if (currentPattern && line.trim().startsWith('- ')) {
      currentPattern.reviewers.push(line.trim().slice(2));
    }
  });

  return { owners };
}

function buildScanEvidence(summary) {
  return [
    {
      id: 'ev_repo_packages',
      type: 'repo-scan',
      summary: `在 eden.monorepo.json 中识别到 ${summary.packages.length} 个工作区 package`,
      refs: summary.packages.slice(0, 50),
      confidence: 0.95,
    },
    {
      id: 'ev_repo_agents',
      type: 'repo-scan',
      summary: `检测到 ${summary.agentsFiles.length} 份 AGENTS/说明文档，仅用于辅助定位，不作为经验提取证据`,
      refs: summary.agentsFiles.slice(0, 20),
      confidence: 0.9,
    },
    {
      id: 'ev_repo_skills',
      type: 'repo-scan',
      summary: `检测到 ${summary.skillFiles.length} 个既有 skills，仅用于避免重复产出，不作为知识抽取输入`,
      refs: summary.skillFiles.slice(0, 20),
      confidence: 0.9,
    },
    {
      id: 'ev_repo_recent_commits',
      type: 'repo-scan',
      summary: `最近 ${summary.recentCommits.length} 条提交可用于辅助判断主干漂移范围`,
      refs: summary.recentCommits.map(commit => commit.hash),
      confidence: 0.8,
    },
  ];
}

function getWorkspacePackagePaths(root) {
  const monorepoConfig = readJson(path.join(root, 'eden.monorepo.json'));
  if (!monorepoConfig || !Array.isArray(monorepoConfig.packages)) {
    return [];
  }

  return monorepoConfig.packages.map(entry => entry.path);
}

function listFiles(root, predicate, options = {}) {
  if (!fs.existsSync(root)) {
    return options.allowMissing ? [] : [];
  }

  const results = [];
  const base = options.relativeTo || root;

  walk(root, candidate => {
    if (predicate(candidate)) {
      results.push(path.relative(base, candidate));
    }
  });

  return results.sort();
}

function walk(currentPath, onFile) {
  const stat = fs.statSync(currentPath);
  if (stat.isFile()) {
    onFile(currentPath);
    return;
  }

  fs.readdirSync(currentPath).forEach(entry => {
    if (entry === 'node_modules' || entry === '.git' || entry === '.entro') {
      return;
    }
    walk(path.join(currentPath, entry), onFile);
  });
}

function safeExec(command, cwd) {
  try {
    return execSync(command, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    return '';
  }
}

function getChangedFiles(cwd, base) {
  const output = safeExec(`git diff --name-only ${base}...HEAD`, cwd);
  return output ? output.split('\n').filter(Boolean) : [];
}

function classifySource(context, absolutePath, sourceRules) {
  const relativePath = path.relative(context.repoRoot, absolutePath);
  if (relativePath.includes(`${path.sep}.entro${path.sep}`)) {
    return null;
  }
  const normalizedPath = `${path.sep}${relativePath.split(path.sep).join(path.sep)}`;
  if (matchesRuleSet(normalizedPath, sourceRules.ignore)) {
    return null;
  }
  const extension = path.extname(absolutePath).toLowerCase();
  const isDoc = ['.md', '.mdx', '.txt'].includes(extension);
  const sourceRole = inferSourceRole(relativePath);

  let evidenceClass = 'primary';
  if (matchesRuleSet(normalizedPath, sourceRules.process)) {
    evidenceClass = 'process';
  } else if (matchesRuleSet(normalizedPath, sourceRules.derived)) {
    evidenceClass = 'derived';
  } else if (isDoc && !matchesRuleSet(normalizedPath, sourceRules.primaryDocs)) {
    evidenceClass = sourceRole === 'raw-doc' ? 'primary' : 'derived';
  }

  return {
    id: `src_${relativePath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
    path: relativePath,
    source_type: isDoc ? 'doc' : 'code',
    source_role: sourceRole,
    evidence_class: evidenceClass,
    scope_hints: inferScopeHints(relativePath),
  };
}

function loadSourceRules(context) {
  const sourceRulesPath = path.join(context.paths.config, 'source-rules.json');
  const current = readJson(sourceRulesPath) || {};
  const normalized = {
    ignore: mergeRuleSets(DEFAULT_IGNORE_RULES, current.ignore),
    derived: mergeRuleSets(DEFAULT_DERIVED_RULES, current.derived),
    process: mergeRuleSets(DEFAULT_PROCESS_RULES, current.process),
    primaryDocs: mergeRuleSets(DEFAULT_PRIMARY_DOC_RULES, current.primaryDocs),
  };

  if (JSON.stringify(current) !== JSON.stringify(normalized)) {
    writeJson(sourceRulesPath, normalized);
  }

  return normalized;
}

function mergeRuleSets(defaults, overrides) {
  return uniqueBy(
    normalizeArray(defaults).concat(normalizeArray(overrides)),
    item => `${item.kind}:${item.value}`
  );
}

function resolveEvidenceScanRoots(context, scopes) {
  const roots = [context.appRoot];
  normalizeArray(scopes).forEach(scope => {
    normalizeArray(scope.primaryRoots).forEach(root => {
      const absoluteRoot = path.isAbsolute(root) ? root : path.join(context.repoRoot, root);
      if (fs.existsSync(absoluteRoot)) {
        roots.push(absoluteRoot);
      }
    });
  });

  return uniqueBy(roots, item => path.resolve(item));
}

function matchesRuleSet(normalizedPath, rules) {
  return normalizeArray(rules).some(rule => {
    if (!rule || !rule.kind || !rule.value) {
      return false;
    }
    if (rule.kind === 'suffix') {
      return normalizedPath.endsWith(rule.value);
    }
    if (rule.kind === 'includes') {
      return normalizedPath.includes(rule.value);
    }
    return false;
  });
}

function inferSourceRole(relativePath) {
  if (relativePath.endsWith('AGENTS.md')) {
    return 'agent-guidance';
  }
  if (relativePath.includes(`${path.sep}.agents${path.sep}`)) {
    return 'agent-guidance';
  }
  if (relativePath.includes(`${path.sep}.trae${path.sep}skills${path.sep}`)) {
    return 'skill';
  }
  if (relativePath.includes(`${path.sep}docs${path.sep}`) || relativePath.includes(`${path.sep}design${path.sep}`) || relativePath.includes(`${path.sep}protocol${path.sep}`)) {
    return 'raw-doc';
  }
  return 'implementation';
}

function inferScopeHints(relativePath) {
  const hints = [];
  if (relativePath.includes(`${path.sep}create`) || relativePath.includes('publish')) {
    hints.push('publish');
  }
  if (relativePath.includes(`${path.sep}list${path.sep}`)) {
    hints.push('list');
  }
  if (relativePath.includes('tea') || relativePath.includes('tracking')) {
    hints.push('tracking');
  }
  return Array.from(new Set(hints));
}

function scanCommand(context, options, helpers) {
  const { ensureInitialized, migrateLegacyFiles, writeJson, toRepoRelative } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const packagePaths = getWorkspacePackagePaths(context.repoRoot);
  const agentsFiles = listFiles(context.appRoot, candidate => {
    const relative = path.relative(context.repoRoot, candidate);
    return relative.endsWith('AGENTS.md') || relative.includes(`${path.sep}.agents${path.sep}`);
  }, { relativeTo: context.repoRoot });
  const skillFiles = listFiles(
    path.join(context.repoRoot, '.trae', 'skills'),
    candidate => candidate.endsWith('SKILL.md'),
    { allowMissing: true, relativeTo: context.repoRoot }
  );

  const changedFiles = options['changed-only']
    ? getChangedFiles(context.repoRoot, options.base || 'HEAD~1')
    : [];
  const trackedFiles = safeExec('git ls-files', context.repoRoot)
    .split('\n')
    .filter(Boolean);
  const recentCommits = safeExec('git log -n 20 --pretty=format:%H::%s', context.repoRoot)
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const separatorIndex = line.indexOf('::');
      return {
        hash: line.slice(0, separatorIndex),
        subject: line.slice(separatorIndex + 2),
      };
    });

  const summary = {
    schemaVersion: 2,
    scannedAt: new Date().toISOString(),
    repoRoot: context.repoRoot,
    appRoot: context.appRoot,
    scope: options.scope || 'all',
    changedOnly: Boolean(options['changed-only']),
    diffBase: options.base || null,
    changedFiles,
    packages: packagePaths,
    agentsFiles,
    skillFiles,
    trackedFileCount: trackedFiles.length,
    recentCommits,
  };

  writeJson(path.join(context.paths.evidence, 'repo-scan', 'workspace-summary.json'), summary);

  const evidenceItems = buildScanEvidence(summary).map(item => ({
    ...item,
    schemaVersion: 2,
    createdAt: summary.scannedAt,
  }));

  evidenceItems.forEach(item => {
    writeJson(path.join(context.paths.evidence, 'repo-scan', `${item.id}.json`), item);
  });

  if (summary.changedOnly) {
    writeJson(path.join(context.paths.evidence, 'git', 'changed-files.json'), {
      schemaVersion: 1,
      generatedAt: summary.scannedAt,
      base: summary.diffBase,
      files: changedFiles,
    });
  }

  writeJson(path.join(context.paths.snapshots, 'last-scan', 'workspace-summary.json'), summary);

  console.log(
    `[entro] 已扫描应用 ${toRepoRelative(context, context.appRoot)}，识别 ${summary.packages.length} 个 package、${summary.agentsFiles.length} 份 AGENTS/说明文档、${summary.skillFiles.length} 个 skill${summary.changedOnly ? `，以及 ${summary.changedFiles.length} 个变更文件` : ''}`
  );
}

function classifySourcesCommand(context, options, helpers) {
  const {
    ensureInitialized,
    migrateLegacyFiles,
    readJson,
    writeJson,
    toRepoRelative,
  } = helpers;

  ensureInitialized(context);
  migrateLegacyFiles(context);

  const sourceRules = loadSourceRules(context);
  const config = readJson(path.join(context.paths.config, 'scopes.json')) || { scopes: [] };
  const scanRoots = resolveEvidenceScanRoots(context, config.scopes);
  const files = uniqueBy(
    scanRoots.flatMap(root => listFiles(root, candidate => {
      return fs.statSync(candidate).isFile();
    }, { relativeTo: context.repoRoot })),
    item => item
  );

  const sources = files.map(relativePath => {
    const absolutePath = path.join(context.repoRoot, relativePath);
    return classifySource(context, absolutePath, sourceRules);
  }).filter(Boolean);

  writeJson(path.join(context.paths.evidence, 'catalog', 'sources.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    appRoot: toRepoRelative(context, context.appRoot),
    sources,
  });

  console.log(`[entro] 已完成 source 分类，共 ${sources.length} 个文件`);
}

export {
  buildOwnersConfig,
  buildScanEvidence,
  getWorkspacePackagePaths,
  listFiles,
  safeExec,
  getChangedFiles,
  classifySource,
  loadSourceRules,
  resolveEvidenceScanRoots,
  scanCommand,
  classifySourcesCommand,
};
