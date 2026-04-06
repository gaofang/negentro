import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodexInstallPlan,
  buildCodexPluginManifest,
  buildCodexSkillMarkdown,
  buildCodexSkillOpenAiYaml,
  normalizeCodexInstallMode,
  resolveCodexHome,
  resolveCodexIntegrationDefinition,
} from '../src/services/codex-integration.js';

test('resolveCodexHome prefers explicit env override', () => {
  const actual = resolveCodexHome({
    CODEX_HOME: '/tmp/custom-codex-home',
    HOME: '/Users/example',
  });

  assert.equal(actual, '/tmp/custom-codex-home');
});

test('resolveCodexHome falls back to ~/.codex', () => {
  const actual = resolveCodexHome({
    HOME: '/Users/example',
  });

  assert.equal(actual, '/Users/example/.codex');
});

test('normalizeCodexInstallMode accepts supported aliases', () => {
  assert.equal(normalizeCodexInstallMode('skill'), 'skill');
  assert.equal(normalizeCodexInstallMode('plugin'), 'plugin');
  assert.equal(normalizeCodexInstallMode('both'), 'both');
  assert.equal(normalizeCodexInstallMode(undefined), 'both');
});

test('normalizeCodexInstallMode rejects unsupported aliases', () => {
  assert.throws(() => normalizeCodexInstallMode('invalid'), /unsupported codex install mode/);
});

test('buildCodexInstallPlan returns stable target paths', () => {
  const plan = buildCodexInstallPlan({
    codexHome: '/Users/example/.codex',
    skillName: 'entro-distill',
    pluginName: 'entro',
  });

  assert.equal(plan.skillDir, '/Users/example/.codex/skills/entro-distill');
  assert.equal(plan.pluginDir, '/Users/example/.codex/plugins/entro');
  assert.equal(plan.pluginSkillDir, '/Users/example/.codex/plugins/entro/skills/entro-distill');
  assert.equal(plan.pluginManifestPath, '/Users/example/.codex/plugins/entro/.codex-plugin/plugin.json');
});

test('buildCodexPluginManifest exposes codex friendly metadata', () => {
  const manifest = buildCodexPluginManifest({
    version: '0.2.0',
    pluginName: 'entro',
    skillName: 'entro-distill',
  });

  assert.equal(manifest.name, 'entro');
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.interface.displayName, 'Entro');
  assert.match(manifest.interface.defaultPrompt, /\bEntro\b/i);
  assert.deepEqual(manifest.interface.capabilities, ['Interactive', 'Read', 'Write']);
});

test('resolveCodexIntegrationDefinition returns generic workflow metadata', () => {
  const definition = resolveCodexIntegrationDefinition('strict-frontend-workflow');

  assert.equal(definition.skillName, 'strict-frontend-workflow');
  assert.equal(definition.displayName, 'Strict Frontend Workflow');
  assert.match(definition.defaultPrompt, /strict-frontend-workflow/);
  assert.doesNotMatch(definition.pluginLongDescription, /goods-publish/i);
});

test('buildCodexSkillMarkdown and yaml support generic workflow naming', () => {
  const definition = resolveCodexIntegrationDefinition('strict-frontend-workflow');
  const markdown = buildCodexSkillMarkdown({
    skillName: definition.skillName,
    title: definition.title,
    description: definition.description,
    body: definition.markdownBody,
  });
  const yaml = buildCodexSkillOpenAiYaml({
    displayName: definition.displayName,
    shortDescription: definition.shortDescription,
    defaultPrompt: definition.defaultPrompt,
  });

  assert.match(markdown, /name: "strict-frontend-workflow"/);
  assert.match(markdown, /Strict Frontend Workflow/);
  assert.match(yaml, /display_name: "Strict Frontend Workflow"/);
  assert.match(yaml, /strict-frontend-workflow/);
});
