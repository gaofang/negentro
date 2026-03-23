import fs from 'fs';
import path from 'path';
import {
  AGENT_EVIDENCE_LIMIT,
  AGENT_EXCERPT_MAX_CHARS,
} from '../shared/constants.js';
import { normalizeArray } from '../shared/collections.js';

function buildRepositoryDistillationInput(context, scopes, owners, sources, changedFiles, helpers) {
  const {
    toRepoRelative,
    filterChangedFilesForScope,
    buildEvidenceBundleForScope,
    filterSourcesForScope,
    findOwner,
  } = helpers;

  return {
    app: {
      appRoot: toRepoRelative(context, context.appRoot),
      repoRoot: context.repoRoot,
    },
    scopes: normalizeArray(scopes).map(scope => ({
      id: scope.id,
      label: scope.label,
      primaryRoots: normalizeArray(scope.primaryRoots),
      changedFiles: filterChangedFilesForScope(changedFiles, scope.paths),
      evidenceBundle: buildEvidenceBundleForScope(context, scope, sources, {
        ...helpers,
        filterSourcesForScope,
      }),
      owners: findOwner(scope.paths, owners),
    })),
    rules: {
      language: 'zh-CN',
      primaryEvidenceOnly: true,
      forbidDerivedArtifacts: true,
      questionStyle: 'single_choice_first',
      noFallbackSummary: true,
    },
  };
}

function buildRepositoryDistillationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            scope: { type: 'string' },
            title: { type: 'string' },
            why_it_matters: { type: 'string' },
            evidence_refs_primary: {
              type: 'array',
              items: { type: 'string' },
            },
            confidence: { type: 'number' },
          },
          required: ['id', 'scope', 'title', 'why_it_matters', 'evidence_refs_primary', 'confidence'],
        },
      },
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            topic_id: { type: 'string' },
            scope: { type: 'string' },
            title: { type: 'string' },
            pattern_kind: { type: 'string', enum: ['workflow', 'rule'] },
            statement: { type: 'string' },
            evidenceRefsPrimary: {
              type: 'array',
              items: { type: 'string' },
            },
            confidence: { type: 'number' },
            uncertainty: {
              type: 'object',
              additionalProperties: false,
              properties: {
                requiresHuman: { type: 'boolean' },
                reasons: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['requiresHuman', 'reasons'],
            },
          },
          required: ['id', 'topic_id', 'scope', 'title', 'pattern_kind', 'statement', 'evidenceRefsPrimary', 'confidence', 'uncertainty'],
        },
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            scope: { type: 'string' },
            title: { type: 'string' },
            prompt: { type: 'string' },
            background: { type: 'string' },
            rationale: { type: 'string' },
            related_card_ids: {
              type: 'array',
              items: { type: 'string' },
            },
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
          required: ['id', 'scope', 'title', 'prompt', 'background', 'rationale', 'related_card_ids', 'options'],
        },
      },
      cards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            scope: { type: 'string' },
            kind: { type: 'string', enum: ['workflow', 'rule'] },
            title: { type: 'string' },
            publishTarget: { type: 'string', enum: ['skill', 'agents'] },
            confidence: { type: 'number' },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' },
            },
            problem: { type: 'string' },
            recommendation: { type: 'string' },
            boundary: { type: 'string' },
          },
          required: ['id', 'scope', 'kind', 'title', 'publishTarget', 'confidence', 'evidenceRefs', 'problem', 'recommendation', 'boundary'],
        },
      },
    },
    required: ['topics', 'patterns', 'questions', 'cards'],
  };
}

function buildTopicDiscoveryInput(context, scopes, sources, changedFiles, helpers) {
  const {
    toRepoRelative,
    filterChangedFilesForScope,
    buildEvidenceBundleForScope,
    filterSourcesForScope,
  } = helpers;

  return {
    app: {
      appRoot: toRepoRelative(context, context.appRoot),
      repoRoot: context.repoRoot,
    },
    scopes: normalizeArray(scopes).map(scope => ({
      id: scope.id,
      label: scope.label,
      primaryRoots: normalizeArray(scope.primaryRoots),
      changedFiles: filterChangedFilesForScope(changedFiles, scope.paths),
      evidenceBundle: buildEvidenceBundleForScope(context, scope, sources, {
        ...helpers,
        filterSourcesForScope,
      }),
    })),
    rules: {
      language: 'zh-CN',
      primaryEvidenceOnly: true,
      forbidDerivedArtifacts: true,
    },
  };
}

function buildPatternMiningInput(context, scope, topics, changedFiles, helpers) {
  const { toRepoRelative, filterChangedFilesForScope, buildEvidenceBundleFromRefs } = helpers;

  return {
    app: {
      appRoot: toRepoRelative(context, context.appRoot),
    },
    scope: {
      id: scope.id,
      label: scope.label,
      changedFiles: filterChangedFilesForScope(changedFiles, scope.paths),
    },
    topics: normalizeArray(topics).map(topic => ({
      id: topic.id,
      title: topic.title,
      why_it_matters: topic.why_it_matters,
      evidence_refs_primary: topic.evidence_refs_primary,
      evidence_bundle: buildEvidenceBundleFromRefs(context, topic.evidence_refs_primary, helpers),
    })),
    rules: {
      language: 'zh-CN',
      primaryEvidenceOnly: true,
      askHumanWhenDefaultUnclear: true,
    },
  };
}

function buildEvidenceBundleForScope(context, scope, sources, helpers) {
  const { filterSourcesForScope } = helpers;
  if (typeof filterSourcesForScope !== 'function') {
    throw new TypeError(`filterSourcesForScope is not a function; helper keys=${Object.keys(helpers || {}).join(',')}`);
  }
  return filterSourcesForScope(sources, scope)
    .slice(0, AGENT_EVIDENCE_LIMIT)
    .map(source => buildEvidenceEntry(context, source.path));
}

function buildEvidenceBundleFromRefs(context, refs) {
  return normalizeArray(refs)
    .slice(0, AGENT_EVIDENCE_LIMIT)
    .map(ref => buildEvidenceEntry(context, ref));
}

function buildEvidenceEntry(context, relativePath) {
  const absolutePath = path.join(context.repoRoot, relativePath);
  return {
    path: relativePath,
    excerpt: readFileExcerpt(absolutePath),
  };
}

function readFileExcerpt(absolutePath) {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return '';
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  return content.slice(0, AGENT_EXCERPT_MAX_CHARS);
}

function buildTopicDiscoverySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            scope: { type: 'string' },
            title: { type: 'string' },
            why_it_matters: { type: 'string' },
            evidence_refs_primary: {
              type: 'array',
              items: { type: 'string' },
            },
            confidence: { type: 'number' },
          },
          required: ['id', 'scope', 'title', 'why_it_matters', 'evidence_refs_primary', 'confidence'],
        },
      },
    },
    required: ['topics'],
  };
}

function buildPatternMiningSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            topic_id: { type: 'string' },
            scope: { type: 'string' },
            title: { type: 'string' },
            pattern_kind: { type: 'string', enum: ['workflow', 'rule'] },
            statement: { type: 'string' },
            evidenceRefsPrimary: {
              type: 'array',
              items: { type: 'string' },
            },
            confidence: { type: 'number' },
            uncertainty: {
              type: 'object',
              additionalProperties: false,
              properties: {
                requiresHuman: { type: 'boolean' },
                reasons: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['requiresHuman', 'reasons'],
            },
          },
          required: ['id', 'topic_id', 'scope', 'title', 'pattern_kind', 'statement', 'evidenceRefsPrimary', 'confidence', 'uncertainty'],
        },
      },
    },
    required: ['patterns'],
  };
}

function normalizeTopicsFromAgent(parsed, scopes, fallbackTopics) {
  const scopeIds = new Set(normalizeArray(scopes).map(scope => scope.id));
  const topics = normalizeArray(parsed && parsed.topics)
    .filter(topic => topic && scopeIds.has(topic.scope))
    .map(topic => ({
      schemaVersion: 1,
      id: topic.id,
      scope: topic.scope,
      title: topic.title,
      why_it_matters: topic.why_it_matters,
      evidence_refs_primary: normalizeArray(topic.evidence_refs_primary),
      changed_files: [],
      confidence: Number(topic.confidence || 0.6),
    }))
    .filter(topic => topic.id && topic.title && topic.evidence_refs_primary.length);

  return topics.length ? topics : fallbackTopics;
}

function normalizePatternsFromAgent(parsed, scope, fallbackPatterns) {
  const patterns = normalizeArray(parsed && parsed.patterns)
    .filter(pattern => pattern && pattern.scope === scope.id)
    .map(pattern => ({
      schemaVersion: 1,
      id: pattern.id,
      topic_id: pattern.topic_id,
      scope: pattern.scope,
      title: pattern.title,
      pattern_kind: pattern.pattern_kind,
      statement: pattern.statement,
      evidenceRefsPrimary: normalizeArray(pattern.evidenceRefsPrimary),
      confidence: Number(pattern.confidence || 0.6),
      uncertainty: {
        requiresHuman: Boolean(pattern.uncertainty && pattern.uncertainty.requiresHuman),
        reasons: normalizeArray(pattern.uncertainty && pattern.uncertainty.reasons),
      },
    }))
    .filter(pattern => pattern.id && pattern.topic_id && pattern.evidenceRefsPrimary.length);

  return patterns.length ? patterns : fallbackPatterns;
}

function normalizeDistillationResult(scopes, owners, parsed, helpers) {
  const { createCard, createQuestion, renderEvidenceList, findOwner } = helpers;
  const scopeMap = new Map(normalizeArray(scopes).map(scope => [scope.id, scope]));
  const topics = normalizeArray(parsed && parsed.topics)
    .map(topic => ({
      schemaVersion: 1,
      id: topic.id,
      scope: topic.scope,
      title: topic.title,
      why_it_matters: topic.why_it_matters,
      evidence_refs_primary: normalizeArray(topic.evidence_refs_primary),
      changed_files: [],
      confidence: Number(topic.confidence || 0.6),
    }))
    .filter(topic => topic.id && scopeMap.has(topic.scope));

  const patterns = normalizeArray(parsed && parsed.patterns)
    .map(pattern => ({
      schemaVersion: 1,
      id: pattern.id,
      topic_id: pattern.topic_id,
      scope: pattern.scope,
      title: pattern.title,
      pattern_kind: pattern.pattern_kind,
      statement: pattern.statement,
      evidenceRefsPrimary: normalizeArray(pattern.evidenceRefsPrimary),
      confidence: Number(pattern.confidence || 0.6),
      uncertainty: {
        requiresHuman: Boolean(pattern.uncertainty && pattern.uncertainty.requiresHuman),
        reasons: normalizeArray(pattern.uncertainty && pattern.uncertainty.reasons),
      },
    }))
    .filter(pattern => pattern.id && scopeMap.has(pattern.scope));

  const cards = normalizeArray(parsed && parsed.cards)
    .map(card => {
      const scope = scopeMap.get(card.scope);
      return createCard({
        id: card.id,
        kind: card.kind,
        title: card.title,
        status: 'draft',
        publishTarget: card.publishTarget,
        scopePaths: scope ? scope.paths : [],
        ownerHints: scope ? findOwner(scope.paths, owners) : [],
        confidence: Number(card.confidence || 0.6),
        triggers: [`处理 ${card.scope} 相关需求`, card.title],
        evidence: normalizeArray(card.evidenceRefs),
        sections: {
          problem: card.problem,
          recommendation: card.recommendation,
          boundary: card.boundary,
          evidence: renderEvidenceList(card.evidenceRefs),
        },
        lineage: {
          source: 'entro.distill.agent',
          topicId: '',
          changedFiles: [],
        },
      });
    })
    .filter(card => card.meta.id);

  const questions = normalizeArray(parsed && parsed.questions)
    .map(question => {
      const scope = scopeMap.get(question.scope);
      return createQuestion({
        id: question.id,
        title: question.title,
        level: 'scope-decision',
        scopePaths: scope ? scope.paths : [],
        owners: scope ? findOwner(scope.paths, owners) : [],
        relatedCardIds: normalizeArray(question.related_card_ids),
        prompt: question.prompt,
        background: question.background,
        expectedAnswer: {
          mode: 'single_choice',
          allowComment: true,
          options: normalizeArray(question.options),
        },
        rationale: question.rationale,
      });
    })
    .filter(question => question.meta.id);

  return {
    topics,
    patterns,
    questions,
    cards,
  };
}

export {
  buildRepositoryDistillationInput,
  buildRepositoryDistillationSchema,
  buildTopicDiscoveryInput,
  buildPatternMiningInput,
  buildEvidenceBundleForScope,
  buildEvidenceBundleFromRefs,
  buildTopicDiscoverySchema,
  buildPatternMiningSchema,
  normalizeTopicsFromAgent,
  normalizePatternsFromAgent,
  normalizeDistillationResult,
};
