import fs from 'fs';
import path from 'path';
import { normalizeArray, uniqueBy } from '../shared/collections.js';
import { readJson } from '../shared/fs.js';

function buildConsolidationInput(context, cards, openQuestions) {
  const packageJson = readJson(path.join(context.appRoot, 'package.json')) || {};
  const scanSummary =
    readJson(path.join(context.paths.snapshots, 'last-scan', 'workspace-summary.json')) ||
    readJson(path.join(context.paths.evidence, 'repo-scan', 'workspace-summary.json')) ||
    {};
  const sourceCatalog =
    readJson(path.join(context.paths.evidence, 'catalog', 'sources.json')) ||
    { sources: [] };

  const appSourcePaths = normalizeArray(sourceCatalog.sources)
    .filter(item => item && item.evidence_class === 'primary')
    .map(item => item && item.path)
    .filter(Boolean)
    .filter(isAllowedEvidencePath)
    .filter(item => item.startsWith(path.relative(context.repoRoot, context.appRoot)))
    .slice(0, 400);
  const resolvedSeeds = readResolvedSeeds(context);
  const requiredResolvedSeeds = resolvedSeeds.filter(seed => seed.priority === 'required' || seed.source !== 'optional');

  return {
    app: {
      appRoot: path.relative(context.repoRoot, context.appRoot),
      repoRoot: context.repoRoot,
      packageName: packageJson.name || path.basename(context.appRoot),
      packageDescription: packageJson.description || '',
    },
    scanSummary: {
      packageCount: Array.isArray(scanSummary.packages) ? scanSummary.packages.length : 0,
      sourceCount: appSourcePaths.length,
      topLevelDirs: listDirectories(path.join(context.appRoot, 'src')),
      pageModules: listDirectories(path.join(context.appRoot, 'src', 'pages')).slice(0, 80),
      appSourcePaths,
    },
    cards: normalizeArray(cards).map(card => ({
      id: card.meta.id,
      title: card.meta.title,
      kind: card.meta.kind,
      publishTarget: card.meta.publishTarget,
      confidence: Number(card.meta.confidence || 0),
      scopePaths: normalizeArray(card.meta.scopePaths),
      ownerHints: normalizeArray(card.meta.ownerHints),
      evidenceRefs: filterEvidenceRefs(card.meta.evidenceRefs),
      sections: {
        problem: safeSection(card.body.sections, 'problem'),
        recommendation: safeSection(card.body.sections, 'recommendation'),
        boundary: safeSection(card.body.sections, 'boundary'),
      },
      notes: normalizeArray(card.body.notes),
    })),
    resolvedSeeds: resolvedSeeds.map(seed => ({
      ...seed,
      evidenceRefs: filterEvidenceRefs(seed.evidenceRefs),
    })),
    requiredResolvedSeeds: requiredResolvedSeeds.map(seed => ({
      ...seed,
      evidenceRefs: filterEvidenceRefs(seed.evidenceRefs),
    })),
    openQuestions: normalizeArray(openQuestions).map(question => ({
      id: question.meta.id,
      title: question.body.title,
      prompt: question.body.prompt,
      background: question.body.background,
      rationale: question.body.rationale,
      scopePaths: normalizeArray(question.meta.scopePaths),
      relatedCardIds: normalizeArray(question.meta.relatedCardIds),
      options: normalizeArray(question.body.expectedAnswer && question.body.expectedAnswer.options),
    })),
    rules: {
      language: 'zh-CN',
      primaryGoal: '产出项目级 AGENTS.md 与跨页面可复用 skills',
      preferResolvedSeedsAsPrimaryInput: true,
      requiredSeedsMustWin: true,
      avoidPageSpecificSkills: true,
      avoidHardcodedTaxonomy: true,
      ignoreDerivedArtifactsAsEvidence: true,
      keepOutputMinimal: true,
    },
  };
}

function buildConsolidationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      agentsDocument: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                heading: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['heading', 'body'],
            },
          },
          evidenceRefs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['title', 'sections', 'evidenceRefs'],
      },
      skills: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            applicability: { type: 'string' },
            defaultRule: { type: 'string' },
            dos: {
              type: 'array',
              items: { type: 'string' },
            },
            donts: {
              type: 'array',
              items: { type: 'string' },
            },
            snippet: { type: 'string' },
            preflight: {
              type: 'array',
              items: { type: 'string' },
            },
            steps: {
              type: 'array',
              items: { type: 'string' },
            },
            pitfalls: {
              type: 'array',
              items: { type: 'string' },
            },
            validation: {
              type: 'array',
              items: { type: 'string' },
            },
            boundaries: { type: 'string' },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' },
            },
            sourceCardIds: {
              type: 'array',
              items: { type: 'string' },
            },
            sourceSeedIds: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['id', 'title', 'summary', 'applicability', 'defaultRule', 'dos', 'donts', 'snippet', 'preflight', 'steps', 'pitfalls', 'validation', 'boundaries', 'evidenceRefs', 'sourceCardIds', 'sourceSeedIds'],
        },
      },
      consolidatedQuestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            prompt: { type: 'string' },
            background: { type: 'string' },
            rationale: { type: 'string' },
            relatedCardIds: {
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
          required: ['id', 'title', 'prompt', 'background', 'rationale', 'relatedCardIds', 'options'],
        },
      },
    },
    required: ['agentsDocument', 'skills', 'consolidatedQuestions'],
  };
}

function renderAgentsDocument(document) {
  const sections = normalizeArray(document && document.sections);
  const lines = [
    `# ${document && document.title ? document.title : 'Project Rules'}`,
    '',
  ];

  sections.forEach(section => {
    lines.push(`## ${section.heading}`);
    lines.push(section.body || '');
    lines.push('');
  });

  if (normalizeArray(document && document.evidenceRefs).length) {
    lines.push('## 取证来源');
    normalizeArray(document.evidenceRefs).forEach(item => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

function renderSkillDocument(skill) {
  const lines = [
    '---',
    `name: ${skill.id}`,
    `description: ${skill.title}`,
    'author: entro',
    '---',
    '',
    `# ${skill.title}`,
    '',
    '## 适用问题',
    skill.applicability || '',
    '',
    '## 推荐做法',
    skill.summary || '',
    '',
  ];

  if (skill.defaultRule) {
    lines.push('## 默认推荐');
    lines.push(skill.defaultRule);
    lines.push('');
  }

  if (normalizeArray(skill.dos).length) {
    lines.push('## Do');
    normalizeArray(skill.dos).forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (normalizeArray(skill.donts).length) {
    lines.push('## Don\'t');
    normalizeArray(skill.donts).forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (skill.snippet) {
    lines.push('## 最小代码片段');
    lines.push('```ts');
    lines.push(skill.snippet);
    lines.push('```');
    lines.push('');
  }

  if (normalizeArray(skill.preflight).length) {
    lines.push('## 前置判断');
    normalizeArray(skill.preflight).forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (normalizeArray(skill.steps).length) {
    lines.push('## 操作步骤');
    normalizeArray(skill.steps).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    lines.push('');
  }

  if (normalizeArray(skill.pitfalls).length) {
    lines.push('## 常见坑');
    normalizeArray(skill.pitfalls).forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (normalizeArray(skill.validation).length) {
    lines.push('## 最小验证清单');
    normalizeArray(skill.validation).forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  lines.push('## 适用边界');
  lines.push(skill.boundaries || '');
  lines.push('');
  lines.push('## 取证来源');
  normalizeArray(skill.evidenceRefs).forEach(item => lines.push(`- ${item}`));
  lines.push('');

  return lines.join('\n');
}

function normalizeConsolidationResult(parsed) {
  const agentsDocument = parsed && parsed.agentsDocument
    ? {
        title: parsed.agentsDocument.title,
        sections: normalizeArray(parsed.agentsDocument.sections),
        evidenceRefs: filterEvidenceRefs(parsed.agentsDocument.evidenceRefs),
      }
    : null;

  const skills = normalizeArray(parsed && parsed.skills).map(skill => ({
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    applicability: skill.applicability,
    defaultRule: skill.defaultRule || '',
    dos: normalizeArray(skill.dos),
    donts: normalizeArray(skill.donts),
    snippet: skill.snippet || '',
    preflight: normalizeArray(skill.preflight),
    steps: normalizeArray(skill.steps),
    pitfalls: normalizeArray(skill.pitfalls),
    validation: normalizeArray(skill.validation),
    boundaries: skill.boundaries,
    evidenceRefs: filterEvidenceRefs(skill.evidenceRefs),
    sourceCardIds: uniqueBy(normalizeArray(skill.sourceCardIds), item => item),
    sourceSeedIds: uniqueBy(normalizeArray(skill.sourceSeedIds), item => item),
  })).filter(skill => skill.id && skill.title && skill.evidenceRefs.length);

  const consolidatedQuestions = normalizeArray(parsed && parsed.consolidatedQuestions).map(question => ({
    id: question.id,
    title: question.title,
    prompt: question.prompt,
    background: question.background,
    rationale: question.rationale,
    relatedCardIds: uniqueBy(normalizeArray(question.relatedCardIds), item => item),
    options: normalizeArray(question.options),
  })).filter(question => question.id && question.title);

  if (!agentsDocument) {
    throw new Error('consolidation agent result missing agentsDocument');
  }

  return {
    agentsDocument,
    skills,
    consolidatedQuestions,
  };
}

function renderConsolidatedQuestions(questions) {
  const lines = [
    '# 待确认问题（归并后）',
    '',
  ];

  normalizeArray(questions).forEach(question => {
    lines.push(`## ${question.title}`);
    lines.push('');
    lines.push(`- ID：${question.id}`);
    lines.push(`- 提问：${question.prompt}`);
    if (question.background) {
      lines.push(`- 背景：${question.background}`);
    }
    if (question.rationale) {
      lines.push(`- 目的：${question.rationale}`);
    }
    if (normalizeArray(question.relatedCardIds).length) {
      lines.push(`- 关联卡片：${normalizeArray(question.relatedCardIds).join('，')}`);
    }
    lines.push('- 选项：');
    normalizeArray(question.options).forEach((option, index) => {
      lines.push(`  ${index + 1}. [${option.id}] ${option.label}：${option.description || ''}`);
    });
    lines.push('');
  });

  if (lines.length === 2) {
    lines.push('当前没有待确认问题。', '');
  }

  return lines.join('\n');
}

function createConsolidatedQuestionDocument(question) {
  return {
    schemaVersion: 2,
    meta: {
      id: question.id,
      status: 'open',
      level: 'scope-decision',
      scopePaths: [],
      owners: [],
      relatedCardIds: normalizeArray(question.relatedCardIds),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consolidatedFrom: normalizeArray(question.relatedCardIds),
    },
    body: {
      title: question.title,
      prompt: question.prompt,
      background: question.background,
      rationale: question.rationale,
      expectedAnswer: {
        mode: 'single_choice',
        allowComment: true,
        options: normalizeArray(question.options),
      },
      answerRefs: [],
      followUpFrom: null,
      reconciliation: null,
    },
  };
}

function buildConsolidationOutputPaths(context) {
  return {
    agents: path.join(context.paths.publications, 'AGENTS.md'),
    skillDir: path.join(context.paths.publications, 'skills'),
    questionsDir: path.join(context.paths.runtime, 'consolidation', 'questions'),
    questionsReport: path.join(context.paths.runtime, 'consolidation', 'questions.md'),
    report: path.join(context.paths.runtime, 'consolidation', 'latest-consolidation-report.json'),
  };
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

function readResolvedSeeds(context) {
  const directory = path.join(context.paths.runtime, 'seeds', 'resolved');
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson(path.join(directory, file)))
    .map(document => document && document.result)
    .filter(Boolean)
    .map(result => ({
      seedId: result.seedId,
      headline: result.headline,
      status: result.status,
      summary: result.summary,
      defaultRule: result.defaultRule,
      do: normalizeArray(result.do),
      dont: normalizeArray(result.dont),
      snippet: result.snippet,
      boundaries: result.boundaries,
      evidenceRefs: filterEvidenceRefs(result.evidenceRefs),
      priority: inferSeedPriority(context, result.seedId),
      source: inferSeedSource(context, result.seedId),
    }));
}

function inferSeedPriority(context, seedId) {
  const seed = readMergedSeedById(context, seedId);
  return seed && seed.priority ? seed.priority : 'required';
}

function inferSeedSource(context, seedId) {
  const seed = readMergedSeedById(context, seedId);
  return seed && seed.source ? seed.source : 'unknown';
}

function readMergedSeedById(context, seedId) {
  const snapshot = readJson(path.join(context.paths.runtime, 'seeds', 'merged-seeds.json')) || {};
  return normalizeArray(snapshot.seeds).find(item => item && item.id === seedId) || null;
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

function safeSection(sections, key) {
  return sections && sections[key] ? sections[key] : '';
}

export {
  buildConsolidationInput,
  buildConsolidationSchema,
  normalizeConsolidationResult,
  renderAgentsDocument,
  renderSkillDocument,
  renderConsolidatedQuestions,
  createConsolidatedQuestionDocument,
  buildConsolidationOutputPaths,
};
