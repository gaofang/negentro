import fs from 'fs';
import path from 'path';
import { normalizeArray, uniqueBy } from '../shared/collections.js';
import { readJson, writeJson } from '../shared/fs.js';

function buildSeedPlan(context, seeds) {
  const packageJson = readJson(path.join(context.appRoot, 'package.json')) || {};
  const sourceCatalog =
    readJson(path.join(context.paths.evidence, 'catalog', 'sources.json')) ||
    { sources: [] };

  return {
    app: {
      appRoot: path.relative(context.repoRoot, context.appRoot),
      packageName: packageJson.name || path.basename(context.appRoot),
      packageDescription: packageJson.description || '',
    },
    seeds: normalizeArray(seeds).map(seed => ({
      id: seed.id,
      priority: seed.priority,
      source: seed.source,
      headline: seed.headline,
      question: seed.rawText,
    })),
    sourceSummary: {
      sourceCount: normalizeArray(sourceCatalog.sources).length,
      topLevelDirs: listDirectories(path.join(context.appRoot, 'src')),
      pageModules: listDirectories(path.join(context.appRoot, 'src', 'pages')).slice(0, 80),
    },
  };
}

function buildSeedExtractionInput(context, seed, cards) {
  const packageJson = readJson(path.join(context.appRoot, 'package.json')) || {};
  const sourceCatalog =
    readJson(path.join(context.paths.evidence, 'catalog', 'sources.json')) ||
    { sources: [] };
  const appRelative = path.relative(context.repoRoot, context.appRoot);
  const appSources = normalizeArray(sourceCatalog.sources)
    .filter(item => item && item.path && item.path.startsWith(appRelative))
    .filter(item => item.evidence_class === 'primary')
    .filter(item => isAllowedEvidencePath(item.path))
    .slice(0, 500);
  const candidateSources = rankCandidateSources(seed, appSources).slice(0, 18);

  return {
    app: {
      appRoot: appRelative,
      packageName: packageJson.name || path.basename(context.appRoot),
      packageDescription: packageJson.description || '',
    },
    seed: {
      id: seed.id,
      priority: seed.priority,
      source: seed.source,
      headline: seed.headline,
      question: seed.rawText,
    },
    sourceSummary: {
      topLevelDirs: listDirectories(path.join(context.appRoot, 'src')),
      pageModules: listDirectories(path.join(context.appRoot, 'src', 'pages')).slice(0, 80),
    },
    candidateEvidence: candidateSources.map(source => ({
      path: source.path,
      excerpt: readFileExcerpt(path.join(context.repoRoot, source.path)),
    })),
    relatedCards: selectRelatedCards(seed, cards).slice(0, 12).map(card => ({
      id: card.meta.id,
      title: card.meta.title,
      publishTarget: card.meta.publishTarget,
      confidence: Number(card.meta.confidence || 0),
      scopePaths: normalizeArray(card.meta.scopePaths),
      evidenceRefs: normalizeArray(card.meta.evidenceRefs),
      sections: {
        problem: safeSection(card.body.sections, 'problem'),
        recommendation: safeSection(card.body.sections, 'recommendation'),
        boundary: safeSection(card.body.sections, 'boundary'),
      },
    })),
    rules: {
      language: 'zh-CN',
      primaryEvidenceOnly: true,
      doNotInventPrivateApi: true,
      askHumanWhenAmbiguous: true,
      excludeDerivedArtifacts: ['AGENTS.md', '.agents', '.trae/skills', '.entro'],
    },
  };
}

function buildSeedExtractionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      seedId: { type: 'string' },
      headline: { type: 'string' },
      status: { type: 'string', enum: ['resolved', 'needs_human', 'unsupported'] },
      summary: { type: 'string' },
      defaultRule: { type: 'string' },
      do: {
        type: 'array',
        items: { type: 'string' },
      },
      dont: {
        type: 'array',
        items: { type: 'string' },
      },
      snippet: { type: 'string' },
      boundaries: { type: 'string' },
      evidenceRefs: {
        type: 'array',
        items: { type: 'string' },
      },
      candidateModes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
            why: { type: 'string' },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['label', 'why', 'evidenceRefs'],
        },
      },
      question: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          prompt: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['id', 'label', 'description'],
            },
          },
        },
        required: ['title', 'prompt', 'options'],
      },
    },
    required: ['seedId', 'headline', 'status', 'summary', 'defaultRule', 'do', 'dont', 'snippet', 'boundaries', 'evidenceRefs', 'candidateModes', 'question'],
  };
}

function normalizeSeedExtractionResult(seed, parsed) {
  return {
    seedId: parsed.seedId || seed.id,
    headline: parsed.headline || seed.headline,
    status: parsed.status || 'needs_human',
    summary: parsed.summary || '',
    defaultRule: parsed.defaultRule || '',
    do: normalizeArray(parsed.do),
    dont: normalizeArray(parsed.dont),
    snippet: parsed.snippet || '',
    boundaries: parsed.boundaries || '',
    evidenceRefs: filterEvidenceRefs(parsed.evidenceRefs),
    candidateModes: normalizeArray(parsed.candidateModes).map(mode => ({
      ...mode,
      evidenceRefs: filterEvidenceRefs(mode && mode.evidenceRefs),
    })).filter(mode => mode && mode.label && normalizeArray(mode.evidenceRefs).length),
    question: parsed.question || {
      title: `${seed.headline}（待确认）`,
      prompt: `当前项目关于“${seed.headline}”的默认做法还不够明确，请确认推荐路径。`,
      options: [],
    },
  };
}

function writeSeedDistillArtifacts(context, result, promptInput) {
  const evidencePath = path.join(context.paths.runtime, 'seeds', 'evidence', `${result.seedId}.json`);
  const distillPath = path.join(context.paths.runtime, 'seeds', 'distilled', `${result.seedId}.json`);
  writeJson(evidencePath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seedId: result.seedId,
    promptInput,
  });
  writeJson(distillPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    result,
  });
  return { evidencePath, distillPath };
}

function writeResolvedSeed(context, result) {
  const resolvedPath = path.join(context.paths.runtime, 'seeds', 'resolved', `${result.seedId}.json`);
  writeJson(resolvedPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    result,
  });
  return resolvedPath;
}

function createSeedQuestionDocument(seed, result, relatedCards) {
  return {
    schemaVersion: 2,
    meta: {
      id: `seedq_${result.seedId}`,
      status: 'open',
      level: 'scope-decision',
      scopePaths: uniqueBy(
        normalizeArray(relatedCards).flatMap(card => normalizeArray(card.meta.scopePaths)),
        item => item,
      ),
      owners: uniqueBy(
        normalizeArray(relatedCards).flatMap(card => normalizeArray(card.meta.ownerHints)),
        item => item,
      ),
      relatedCardIds: uniqueBy(
        normalizeArray(relatedCards).map(card => card.meta.id),
        item => item,
      ),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    body: {
      title: result.question && result.question.title ? result.question.title : `${seed.headline}（待确认）`,
      prompt: result.question && result.question.prompt
        ? result.question.prompt
        : `当前项目关于“${seed.headline}”的默认做法仍不明确，请确认推荐路径。`,
      background: result.summary || seed.rawText,
      expectedAnswer: {
        mode: 'single_choice',
        allowComment: true,
        options: normalizeArray(result.question && result.question.options),
      },
      rationale: `该问题来自种子“${seed.headline}”，如果默认路径判断错误，后续生码容易偏离项目约定。`,
      answerRefs: [],
      followUpFrom: null,
      reconciliation: null,
    },
  };
}

function rankCandidateSources(seed, sources) {
  const tokens = tokenizeSeed(seed);
  return normalizeArray(sources)
    .map(source => ({
      ...source,
      _score: scoreSource(tokens, source.path),
    }))
    .filter(source => source._score > 0)
    .sort((left, right) => right._score - left._score);
}

function scoreSource(tokens, sourcePath) {
  const lower = String(sourcePath || '').toLowerCase();
  let score = 0;
  normalizeArray(tokens).forEach(token => {
    if (lower.includes(token)) {
      score += 2;
    }
  });
  if (lower.includes('/src/')) score += 3;
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) score += 2;
  if (lower.includes('/pages/')) score += 2;
  if (lower.includes('/components/')) score += 2;
  if (lower.includes('/hooks/')) score += 1;
  if (lower.includes('/services/')) score += 1;
  if (lower.includes('/api')) score += 1;
  return score;
}

function isAllowedEvidencePath(sourcePath) {
  const normalized = String(sourcePath || '').replace(/\\/g, '/');
  if (!normalized) {
    return false;
  }
  if (normalized.includes('/.entro/')) {
    return false;
  }
  if (normalized.includes('/.agents/')) {
    return false;
  }
  if (normalized.includes('/.trae/skills/')) {
    return false;
  }
  if (normalized.endsWith('/AGENTS.md') || normalized === 'AGENTS.md') {
    return false;
  }
  return true;
}

function filterEvidenceRefs(items) {
  return uniqueBy(
    normalizeArray(items).filter(isAllowedEvidencePath),
    item => item,
  );
}

function tokenizeSeed(seed) {
  const text = `${seed.headline}\n${seed.body || ''}`.toLowerCase();
  return uniqueBy(
    text
      .replace(/[`~!@#$%^&*()_=+[{\]}\\|;:'",<.>/?]+/g, ' ')
      .split(/\s+/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => item.length >= 2),
    item => item,
  );
}

function selectRelatedCards(seed, cards) {
  const tokens = tokenizeSeed(seed);
  return normalizeArray(cards)
    .map(card => ({
      card,
      score: scoreCard(tokens, card),
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map(item => item.card);
}

function scoreCard(tokens, card) {
  const text = [
    card.meta.title,
    safeSection(card.body.sections, 'problem'),
    safeSection(card.body.sections, 'recommendation'),
    normalizeArray(card.meta.evidenceRefs).join(' '),
  ].join(' ').toLowerCase();

  let score = 0;
  normalizeArray(tokens).forEach(token => {
    if (text.includes(token)) {
      score += 2;
    }
  });
  return score;
}

function readFileExcerpt(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').slice(0, 1800);
}

function listDirectories(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function safeSection(sections, key) {
  return sections && sections[key] ? sections[key] : '';
}

export {
  buildSeedPlan,
  buildSeedExtractionInput,
  buildSeedExtractionSchema,
  normalizeSeedExtractionResult,
  writeSeedDistillArtifacts,
  writeResolvedSeed,
  createSeedQuestionDocument,
};
