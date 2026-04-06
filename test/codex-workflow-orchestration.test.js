import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const orchestratorPath = path.join(repoRoot, 'prompts', 'workflow_codex_orchestrator.md');
const readmePath = path.join(repoRoot, 'README.md');

test('workflow orchestrator prompt defines auto-advance and stop points', () => {
  const prompt = fs.readFileSync(orchestratorPath, 'utf8');

  assert.match(prompt, /auto-advance/i);
  assert.match(prompt, /must stop/i);
  assert.match(prompt, /workflow run --json/);
  assert.match(prompt, /workflow next --json/);
  assert.match(prompt, /capture/i);
});

test('README describes Codex-first workflow usage', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.match(readme, /Codex/i);
  assert.match(readme, /natural language/i);
  assert.match(readme, /automatic/i);
});
