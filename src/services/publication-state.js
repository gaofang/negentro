import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { normalizeArray, uniqueBy } from '../shared/collections.js';
import { ensureDir, readJson, writeJson, writeText, readTextIfExists } from '../shared/fs.js';

function buildPublicationModel(normalized) {
  const agentsSections = normalizeArray(normalized && normalized.agentsDocument && normalized.agentsDocument.sections).map(section => ({
    heading: section.heading || '',
    body: section.body || '',
    canonical: canonicalizeText(`${section.heading || ''}\n${section.body || ''}`),
  }));

  const skills = normalizeArray(normalized && normalized.skills).map(skill => ({
    id: skill.id,
    title: skill.title || '',
    summary: skill.summary || '',
    applicability: skill.applicability || '',
    defaultRule: skill.defaultRule || '',
    dos: normalizeArray(skill.dos),
    donts: normalizeArray(skill.donts),
    snippet: skill.snippet || '',
    preflight: normalizeArray(skill.preflight),
    steps: normalizeArray(skill.steps),
    pitfalls: normalizeArray(skill.pitfalls),
    validation: normalizeArray(skill.validation),
    boundaries: skill.boundaries || '',
    evidenceRefs: uniqueBy(normalizeArray(skill.evidenceRefs), item => item),
    sourceCardIds: uniqueBy(normalizeArray(skill.sourceCardIds), item => item),
    sourceSeedIds: uniqueBy(normalizeArray(skill.sourceSeedIds), item => item),
    canonical: canonicalizeSkill(skill),
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    agents: {
      title: normalized && normalized.agentsDocument ? normalized.agentsDocument.title : '',
      sections: agentsSections,
      evidenceRefs: uniqueBy(
        normalizeArray(normalized && normalized.agentsDocument && normalized.agentsDocument.evidenceRefs),
        item => item,
      ),
      canonical: canonicalizeAgents({
        title: normalized && normalized.agentsDocument ? normalized.agentsDocument.title : '',
        sections: agentsSections,
      }),
    },
    skills,
  };
}

function loadExistingPublicationState(context) {
  const stored = readJson(path.join(context.paths.publicationState, 'publication-model.json'));
  if (stored) {
    return stored;
  }
  return bootstrapPublicationStateFromOutput(context);
}

function writePublicationState(context, model, summary) {
  ensureDir(context.paths.publicationState);
  writeJson(path.join(context.paths.publicationState, 'publication-model.json'), model);
  writeJson(path.join(context.paths.publicationState, 'last-update-summary.json'), summary);
}

function applyPublicationModel(context, model, renderers) {
  ensureDir(context.paths.publications);
  ensureDir(path.join(context.paths.publications, 'skills'));

  const existing = loadExistingPublicationState(context);
  const diff = diffPublicationModels(existing, model);

  if (diff.agents.changed) {
    writeText(
      path.join(context.paths.publications, 'AGENTS.md'),
      renderers.renderAgentsDocument({
        title: model.agents.title,
        sections: model.agents.sections.map(section => ({
          heading: section.heading,
          body: section.body,
        })),
        evidenceRefs: model.agents.evidenceRefs,
      }),
    );
  }

  const skillsRoot = path.join(context.paths.publications, 'skills');
  ensureDir(skillsRoot);

  diff.skills.removed.forEach(skillId => {
    const target = path.join(skillsRoot, skillId);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  diff.skills.added.concat(diff.skills.updated).forEach(skillEntry => {
    const skillDir = path.join(skillsRoot, skillEntry.id);
    ensureDir(skillDir);
    writeText(path.join(skillDir, 'SKILL.md'), renderers.renderSkillDocument(skillEntry.payload));
  });

  writePublicationState(context, model, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    agents: {
      changed: diff.agents.changed,
    },
    skills: {
      added: diff.skills.added.map(item => item.id),
      updated: diff.skills.updated.map(item => item.id),
      removed: diff.skills.removed,
      unchanged: diff.skills.unchanged,
    },
  });

  return diff;
}

function diffPublicationModels(previous, next) {
  const previousAgentsCanonical = previous && previous.agents ? previous.agents.canonical : '';
  const nextAgentsCanonical = next && next.agents ? next.agents.canonical : '';

  const previousSkills = new Map(
    normalizeArray(previous && previous.skills).map(skill => [skill.id, skill]),
  );
  const nextSkills = new Map(
    normalizeArray(next && next.skills).map(skill => [skill.id, skill]),
  );

  const added = [];
  const updated = [];
  const unchanged = [];

  Array.from(nextSkills.keys()).sort().forEach(skillId => {
    const current = nextSkills.get(skillId);
    const before = previousSkills.get(skillId);
    if (!before) {
      added.push({ id: skillId, payload: materializeSkill(current) });
      return;
    }
    if (before.canonical === current.canonical) {
      unchanged.push(skillId);
      return;
    }
    updated.push({ id: skillId, payload: materializeSkill(current) });
  });

  const removed = Array.from(previousSkills.keys())
    .filter(skillId => !nextSkills.has(skillId))
    .sort();

  return {
    agents: {
      changed: previousAgentsCanonical !== nextAgentsCanonical,
    },
    skills: {
      added,
      updated,
      removed,
      unchanged: unchanged.sort(),
    },
  };
}

function bootstrapPublicationStateFromOutput(context) {
  const agentsPath = path.join(context.paths.publications, 'AGENTS.md');
  const skillsRoot = path.join(context.paths.publications, 'skills');
  if (!fs.existsSync(agentsPath) && !fs.existsSync(skillsRoot)) {
    return null;
  }

  const agentsText = readTextIfExists(agentsPath);
  const skills = fs.existsSync(skillsRoot)
    ? fs.readdirSync(skillsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
          const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
          return {
            id: entry.name,
            title: '',
            summary: '',
            applicability: '',
            defaultRule: '',
            dos: [],
            donts: [],
            snippet: '',
            preflight: [],
            steps: [],
            pitfalls: [],
            validation: [],
            boundaries: '',
            evidenceRefs: [],
            sourceCardIds: [],
            sourceSeedIds: [],
            canonical: hashStable({
              id: entry.name,
              raw: canonicalizeCode(readTextIfExists(skillPath)),
            }),
          };
        })
    : [];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    agents: {
      title: '',
      sections: [],
      evidenceRefs: [],
      canonical: hashStable({
        raw: canonicalizeCode(agentsText),
      }),
    },
    skills,
  };
}

function materializeSkill(skill) {
  return {
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    applicability: skill.applicability,
    defaultRule: skill.defaultRule,
    dos: skill.dos,
    donts: skill.donts,
    snippet: skill.snippet,
    preflight: skill.preflight,
    steps: skill.steps,
    pitfalls: skill.pitfalls,
    validation: skill.validation,
    boundaries: skill.boundaries,
    evidenceRefs: skill.evidenceRefs,
    sourceCardIds: skill.sourceCardIds,
    sourceSeedIds: skill.sourceSeedIds,
  };
}

function canonicalizeAgents(document) {
  const payload = {
    title: document.title || '',
    sections: normalizeArray(document.sections).map(section => ({
      heading: section.heading || '',
      body: canonicalizeText(section.body || ''),
    })),
  };
  return hashStable(payload);
}

function canonicalizeSkill(skill) {
  const payload = {
    title: canonicalizeText(skill.title || ''),
    summary: canonicalizeText(skill.summary || ''),
    applicability: canonicalizeText(skill.applicability || ''),
    defaultRule: canonicalizeText(skill.defaultRule || ''),
    dos: canonicalizeList(skill.dos),
    donts: canonicalizeList(skill.donts),
    snippet: canonicalizeCode(skill.snippet || ''),
    preflight: canonicalizeList(skill.preflight),
    steps: canonicalizeList(skill.steps),
    pitfalls: canonicalizeList(skill.pitfalls),
    validation: canonicalizeList(skill.validation),
    boundaries: canonicalizeText(skill.boundaries || ''),
    evidenceRefs: uniqueBy(normalizeArray(skill.evidenceRefs), item => item).sort(),
    sourceSeedIds: uniqueBy(normalizeArray(skill.sourceSeedIds), item => item).sort(),
  };
  return hashStable(payload);
}

function canonicalizeList(items) {
  return normalizeArray(items)
    .map(item => canonicalizeText(item))
    .filter(Boolean)
    .sort();
}

function canonicalizeCode(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function canonicalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[，。；：！？、“”‘’（）]/g, ' ')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hashStable(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

export {
  buildPublicationModel,
  loadExistingPublicationState,
  writePublicationState,
  applyPublicationModel,
  diffPublicationModels,
};
