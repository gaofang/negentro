import path from 'path';
import { normalizeArray, uniqueBy } from '../shared/collections.js';

function resolveScopes(scopes, scopeOption) {
  if (!scopeOption) {
    return normalizeArray(scopes);
  }

  const requested = String(scopeOption || '').trim();
  return normalizeArray(scopes).filter(scope => {
    const scopeId = String(scope && scope.id ? scope.id : '').trim();
    return scopeId === requested || listScopeAliases(scopeId).includes(requested);
  });
}

function deriveFullAppScopes(context, sources, options = {}) {
  const maxScopes = Number(options.maxScopes || 8);
  const appRelativePath = path.relative(context.repoRoot, context.appRoot) || '.';
  const buckets = new Map();

  normalizeArray(sources)
    .filter(source =>
      source &&
      source.evidence_class === 'primary' &&
      source.source_role === 'implementation' &&
      String(source.path || '').startsWith(appRelativePath) &&
      String(source.path || '').includes('/src/'),
    )
    .forEach(source => {
      const bucketRoot = inferFullAppBucketRoot(appRelativePath, source.path);
      if (!bucketRoot) {
        return;
      }

      const current = buckets.get(bucketRoot) || { root: bucketRoot, count: 0 };
      current.count += 1;
      buckets.set(bucketRoot, current);
    });

  const selected = Array.from(buckets.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, maxScopes);

  if (!selected.length) {
    return [];
  }

  return selected.map((bucket, index) => ({
    id: `app-${index + 1}-${toScopeSlug(bucket.root.replace(`${appRelativePath}/`, ''))}`,
    label: `应用分桶：${bucket.root.replace(`${appRelativePath}/`, '')}`,
    paths: [bucket.root],
    primaryRoots: [bucket.root],
    excludeRoots: ['**/AGENTS.md', '**/.agents/**', '**/.trae/skills/**', '**/.entro/**'],
  }));
}

function inferFullAppBucketRoot(appRelativePath, sourcePath) {
  const relativeToApp = path.relative(appRelativePath, sourcePath);
  const segments = String(relativeToApp).split('/').filter(Boolean);
  if (segments[0] !== 'src') {
    return null;
  }

  if (segments[1] === 'pages' && segments[2]) {
    return `${appRelativePath}/src/pages/${segments[2]}`;
  }
  if (segments[1] === 'biz-components' && segments[2]) {
    return `${appRelativePath}/src/biz-components/${segments[2]}`;
  }
  if (segments[1] === 'components' && segments[2]) {
    return `${appRelativePath}/src/components/${segments[2]}`;
  }
  if (segments[1] && segments[2]) {
    return `${appRelativePath}/src/${segments[1]}/${segments[2]}`;
  }
  if (segments[1]) {
    return `${appRelativePath}/src/${segments[1]}`;
  }
  return `${appRelativePath}/src`;
}

function toScopeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'scope';
}

function listScopeAliases(scopeId) {
  const normalized = String(scopeId || '').trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized.split('.').filter(Boolean);
  const aliases = [];
  for (let index = 1; index < segments.length; index += 1) {
    aliases.push(segments.slice(index).join('.'));
  }

  return uniqueBy(aliases, item => item);
}

function findOwner(pathsToCheck, ownersConfig) {
  const candidates = normalizeArray(pathsToCheck).map(item => String(item || '').replace(/^\//, ''));
  const owners = normalizeArray(ownersConfig && ownersConfig.owners);
  const ownerRecord = owners.find(entry =>
    candidates.some(candidate => String(entry.pattern || '').includes(candidate)),
  );

  return ownerRecord ? normalizeArray(ownerRecord.reviewers) : [];
}

function filterChangedFilesForScope(changedFiles, scopePaths) {
  const normalizedScopePaths = normalizeArray(scopePaths);
  return normalizeArray(changedFiles).filter(file =>
    normalizedScopePaths.some(scopePath => String(file || '').startsWith(scopePath)),
  );
}

function filterSourcesForScope(sources, scope) {
  const scopePaths = normalizeArray(scope && scope.primaryRoots).length
    ? normalizeArray(scope.primaryRoots)
    : normalizeArray(scope && scope.paths);

  return normalizeArray(sources).filter(
    source =>
      source &&
      source.evidence_class === 'primary' &&
      source.source_role !== 'agent-guidance' &&
      scopePaths.some(scopePath => String(source.path || '').startsWith(scopePath)),
  );
}

function discoverTopicsForScope(scope, sources, changedFiles = []) {
  const scopeSources = filterSourcesForScope(sources, scope);
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
  return normalizeArray(topics).map(topic => {
    const patternKind = inferPatternKind(topic);
    const evidenceRefsPrimary = normalizeArray(topic.evidence_refs_primary);
    const uncertaintyReasons = [];

    if (evidenceRefsPrimary.length < 2) {
      uncertaintyReasons.push('当前证据仍偏少，尚不足以确认这是该范围内的稳定默认做法。');
    }

    return {
      schemaVersion: 1,
      id: `${topic.id}-pattern`,
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

function buildQuestionsFromPatterns(scope, patterns, owner, createQuestion) {
  return normalizeArray(patterns)
    .filter(pattern => pattern.uncertainty && pattern.uncertainty.requiresHuman)
    .map(pattern =>
      createQuestion({
        id: `question-${pattern.topic_id}`,
        title: `确认“${pattern.title}”的默认做法`,
        level: 'scope-decision',
        scopePaths: scope.paths,
        owners: normalizeArray(owner),
        relatedCardIds: [`card-${pattern.id}`],
        prompt: `针对“${pattern.title}”，当前仓库里哪种做法应视为默认推荐路径？`,
        background: `当前只能确认相关实现存在，但仍有以下不确定点：${normalizeArray(pattern.uncertainty && pattern.uncertainty.reasons).join('；')}`,
        expectedAnswer: {
          mode: 'single_choice',
          allowComment: true,
          options: [
            {
              id: 'confirm-default',
              label: '确认存在统一默认',
              description: '该模式有稳定默认路径，可以沉淀成明确经验。',
            },
            {
              id: 'depends-on-scenario',
              label: '需要按场景区分',
              description: '不存在单一默认路径，需要按子场景或条件分别处理。',
            },
            {
              id: 'not-enough-evidence',
              label: '当前证据不足',
              description: '还需要更多上下文，暂不适合沉淀为默认经验。',
            },
          ],
        },
        rationale: '这个问题决定该模式能否从候选经验升级为可直接指导编码的默认经验。',
      }),
    );
}

function buildScopeCardsFromPatterns(scope, patterns, { owner, changedFiles }, createCard, renderEvidenceList) {
  return normalizeArray(patterns).map(pattern =>
    createCard({
      id: `card-${pattern.id}`,
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

function buildProblemFromPattern(pattern) {
  const base = `${pattern.title} 是当前范围内反复出现的实现模式，若后续改动不沿现有做法收敛，容易出现重复实现、边界漂移或行为不一致。`;
  const uncertainty = normalizeArray(pattern.uncertainty && pattern.uncertainty.reasons);
  if (!uncertainty.length) {
    return base;
  }

  return `${base}\n\n当前仍存在待确认点：${uncertainty.join('；')}`;
}

function buildRecommendationFromPattern(pattern) {
  if (pattern.uncertainty && pattern.uncertainty.requiresHuman) {
    return [
      `- 目前只能确认“${pattern.title}”相关实现已经存在，但默认做法仍待人工确认。`,
      '- 在确认默认方案前，优先复用现有入口和相邻实现，不要额外发明新的接入方式。',
      `- 待确认点：${normalizeArray(pattern.uncertainty.reasons).join('；')}`,
    ].join('\n');
  }

  if (pattern.pattern_kind === 'workflow') {
    return [
      `1. 遇到“${pattern.title}”相关需求时，先阅读该模式对应的现有入口文件和相邻实现。`,
      '2. 优先沿现有组织方式补强逻辑，避免把同类能力拆散到新的无关层级。',
      '3. 完成改动后，回查同主题下的状态流转、依赖调用和边界条件是否仍然成立。',
    ].join('\n');
  }

  return [
    `- 涉及“${pattern.title}”时，优先复用已有常量、helper、封装层或判断入口。`,
    '- 不要把相同语义再次写成新的硬编码分支或重复封装。',
    '- 改动前后要确认关键边界条件和例外分支没有被破坏。',
  ].join('\n');
}

function inferTopicFromSource(scope, source) {
  const sourcePath = source.path || '';
  const segments = String(sourcePath).split('/').filter(Boolean);
  const baseName = segments[segments.length - 1] || '';
  const parentName = segments[segments.length - 2] || scope.id || 'app';
  const stem = baseName.replace(/\.[^.]+$/, '');

  const topicKey = slugifyTopicKey([scope.id, parentName, stem].filter(Boolean).join(' '));
  if (!topicKey) {
    return null;
  }

  const title = humanizeTopicTitle(parentName, stem);
  return {
    id: `topic-${topicKey}`,
    title,
    why_it_matters: `该范围内与“${title}”相关的实现反复出现，值得继续观察其复用方式、边界约束和默认接入路径。`,
    confidence: 0.55,
  };
}

function inferPatternKind(topic) {
  return /flow|workflow|process|pipeline|container|layout|page|module|entry/i.test(topic.id)
    ? 'workflow'
    : 'rule';
}

function slugifyTopicKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function humanizeTopicTitle(parentName, stem) {
  const parent = humanizeSegment(parentName);
  const leaf = humanizeSegment(stem);
  if (!parent) {
    return leaf || '代码实现主题';
  }
  if (!leaf || leaf === parent) {
    return `${parent} 相关实现`;
  }
  return `${parent} / ${leaf} 相关实现`;
}

function humanizeSegment(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(index|lazy|utils?|hooks?|components?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export {
  resolveScopes,
  deriveFullAppScopes,
  findOwner,
  filterChangedFilesForScope,
  filterSourcesForScope,
  discoverTopicsForScope,
  buildPatternCandidates,
  buildQuestionsFromPatterns,
  buildScopeCardsFromPatterns,
};
