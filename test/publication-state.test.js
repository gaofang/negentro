import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { createContext } from '../src/context.js';
import { ensureDir, writeJson } from '../src/shared/fs.js';
import {
  buildPublicationBridgeSnapshot,
  loadWorkflowKnowledgeBridge,
} from '../src/services/publication-state.js';

test('publication bridge snapshot groups promoted workflow knowledge by target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entro-publication-bridge-'));
  const appRoot = path.join(root, 'apps', 'demo');
  fs.mkdirSync(appRoot, { recursive: true });
  process.env.ENTRO_RUNTIME_HOME = path.join(root, '.entro-runtime');
  const context = createContext(appRoot);
  ensureDir(context.paths.publicationState);

  writeJson(path.join(context.paths.publicationState, 'publication-knowledge-bridge.json'), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    entries: [
      {
        cardId: 'knowledge-a',
        target: 'reference',
        output: {
          reference: {
            title: 'Reference note',
            summary: 'Short summary',
            body: 'Reference body',
            evidenceRefs: ['doc:a'],
            sourceCardIds: ['knowledge-a'],
          },
        },
      },
      {
        cardId: 'knowledge-b',
        target: 'skills',
        output: {
          skill: {
            id: 'demo-skill',
            title: 'Demo skill',
            summary: 'Skill summary',
            defaultRule: 'Prefer a small review batch.',
            evidenceRefs: ['doc:b'],
            sourceCardIds: ['knowledge-b'],
          },
        },
      },
      {
        cardId: 'knowledge-c',
        target: 'agents',
        output: {
          section: {
            heading: 'Workflow review',
            body: 'Escalate only after the team agrees.',
            evidenceRefs: ['doc:c'],
            sourceCardIds: ['knowledge-c'],
          },
        },
      },
    ],
  });

  const bridge = loadWorkflowKnowledgeBridge(context);
  assert.equal(bridge.entries.length, 3);

  const snapshot = buildPublicationBridgeSnapshot(context);
  assert.equal(snapshot.reference.length, 1);
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.agents.sections.length, 1);
  assert.equal(snapshot.skills[0].id, 'demo-skill');
  assert.equal(snapshot.agents.sections[0].heading, 'Workflow review');
});
