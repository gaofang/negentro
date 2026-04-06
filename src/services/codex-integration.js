import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

function resolveCodexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(env.HOME || os.homedir(), '.codex'));
}

function normalizeCodexInstallMode(mode) {
  const value = String(mode || 'both').trim().toLowerCase();
  if (value === 'skill' || value === 'plugin' || value === 'both') {
    return value;
  }
  throw new Error(`unsupported codex install mode: ${mode}`);
}

function buildCodexInstallPlan({
  codexHome,
  skillName = 'entro-distill',
  pluginName = 'entro',
}) {
  const resolvedCodexHome = path.resolve(codexHome);
  const skillDir = path.join(resolvedCodexHome, 'skills', skillName);
  const pluginDir = path.join(resolvedCodexHome, 'plugins', pluginName);

  return {
    codexHome: resolvedCodexHome,
    skillName,
    pluginName,
    skillDir,
    pluginDir,
    pluginSkillDir: path.join(pluginDir, 'skills', skillName),
    pluginAgentsDir: path.join(pluginDir, 'agents'),
    pluginAssetsDir: path.join(pluginDir, 'assets'),
    pluginManifestPath: path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    pluginReadmePath: path.join(pluginDir, 'README.md'),
  };
}

function buildCodexPluginManifest({
  version,
  pluginName = 'entro',
  skillName = 'entro-distill',
  displayName = 'Entro',
  shortDescription = 'Run Entro extraction and HITL confirmation from Codex',
  longDescription = 'Install Entro into Codex so developers can launch extraction, answer one question at a time, and build AGENTS.md / skills without leaving the Codex conversation.',
  defaultPrompt = `Use $${skillName} to run Entro extraction for the current app and handle confirmation questions in chat.`,
}) {
  return {
    name: pluginName,
    version,
    description: 'Drive Entro knowledge extraction workflows inside Codex using the native Codex chat UI.',
    author: {
      name: 'ByteDance Ecom',
      email: 'ecom@bytedance.com',
    },
    license: 'UNLICENSED',
    keywords: ['codex', 'knowledge', 'cli', 'skills', 'agents'],
    skills: './skills/',
    interface: {
      displayName,
      shortDescription,
      longDescription,
      developerName: 'ByteDance Ecom',
      category: 'Coding',
      capabilities: ['Interactive', 'Read', 'Write'],
      defaultPrompt,
      brandColor: '#1677FF',
      screenshots: [],
    },
  };
}

function buildCodexSkillMarkdown({
  skillName = 'entro-distill',
  title = 'Entro Distill',
  description = "Use when the user wants to run Entro extraction, answer Entro confirmation questions, or build AGENTS.md and skills from a repo app inside Codex. Prefer this skill over asking the user to leave Codex or use Entro's standalone TUI.",
  body,
} = {}) {
  const markdownBody = body || `# ${title}

Use the local \`entro\` CLI as the execution engine, while keeping the human interaction in the current Codex conversation.

## When to use

- The user wants to extract AGENTS.md / skills for an app.
- The user wants to continue an Entro run that still has open questions.
- The user wants Codex to drive Entro end-to-end instead of using Entro's standalone chat UI.

## Workflow

1. Check install health first with \`entro doctor --json\` when available, or \`entro paths --app <app> --json\`.
2. Run \`entro run --app <app> --json\`.
3. If the response says there are open questions, immediately fetch exactly one current question with \`entro question next --app <app> --json\`.
4. Show that one question directly to the user, wait for the reply, then immediately execute:
   - \`entro answer --app <app> --question <id> --text "<reply>" --json\`
   - \`entro reconcile --app <app> --question <id> --json\`
5. After reconcile, inspect the returned \`state.questions.next\` or call \`entro question next --app <app> --json\` again, then continue with the next question.
6. Once there are no open questions, call \`entro build --app <app> --json\`.
7. Summarize generated outputs and point the user to the resulting \`.entro/output\` artifacts.

## Interaction rules

- Keep all HITL interaction inside Codex chat.
- Never ask the user to open Entro's standalone TUI unless they explicitly want that.
- Ask one Entro question at a time.
- Do not ask the user to confirm before each \`entro\` command; execute the loop directly.
- The desired rhythm is only: question -> user answer -> next question.
- If the user says "跳过" / "不确定", pass that through to Entro exactly once, then continue to the next question instead of asking for a forced single-choice answer again.
- Treat Entro reconcile JSON as source of truth. If reconcile says the question is deferred or closed, move on.

## Output handling

- Prefer Entro's \`--json\` output when available.
- Treat Entro's JSON as source of truth for phase, open question count, and artifact paths.
- If Entro reports an error, show the error clearly and stop rather than guessing.`;

  return `---
name: "${skillName}"
description: "${description}"
---

${markdownBody}
`;
}

function buildCodexSkillOpenAiYaml({
  displayName = 'Entro Distill',
  shortDescription = 'Drive Entro extraction and question answering from Codex',
  defaultPrompt = 'Use $entro-distill to run Entro for the current app and keep all confirmation questions in this Codex chat.',
} = {}) {
  return `interface:
  display_name: "${displayName}"
  short_description: "${shortDescription}"
  default_prompt: "${defaultPrompt}"
`;
}

function buildStrictWorkflowCodexSkillDefinition() {
  return {
    skillName: 'strict-frontend-workflow',
    title: 'Strict Frontend Workflow',
    description:
      'Use when the user wants Codex to automatically orchestrate a generic strict workflow for frontend work without relying on app-specific naming.',
    markdownBody: readStrictWorkflowOrchestratorPrompt(),
    displayName: 'Strict Frontend Workflow',
    shortDescription: 'Install a generic strict workflow orchestrator for frontend work',
    defaultPrompt:
      'Use $strict-frontend-workflow to automatically orchestrate the generic frontend workflow through natural-language interaction in Codex.',
    pluginDisplayName: 'Entro Workflow',
    pluginShortDescription: 'Install generic workflow orchestration for Codex',
    pluginLongDescription:
      'Install reusable workflow orchestration into Codex so developers can use natural language while Codex drives the strict frontend workflow behind the scenes.',
  };
}

function resolveCodexIntegrationDefinition(integration = 'entro-distill') {
  if (integration === 'strict-frontend-workflow') {
    return buildStrictWorkflowCodexSkillDefinition();
  }

  return {
    skillName: 'entro-distill',
    title: 'Entro Distill',
    description:
      "Use when the user wants to run Entro extraction, answer Entro confirmation questions, or build AGENTS.md and skills from a repo app inside Codex. Prefer this skill over asking the user to leave Codex or use Entro's standalone TUI.",
    displayName: 'Entro Distill',
    shortDescription: 'Drive Entro extraction and question answering from Codex',
    defaultPrompt:
      'Use $entro-distill to run Entro for the current app and keep all confirmation questions in this Codex chat.',
    pluginDisplayName: 'Entro',
    pluginShortDescription: 'Run Entro extraction and HITL confirmation from Codex',
    pluginLongDescription:
      'Install Entro into Codex so developers can launch extraction, answer one question at a time, and build AGENTS.md / skills without leaving the Codex conversation.',
  };
}

function buildCodexPluginReadme({ skillName = 'entro-distill' } = {}) {
  return `# Entro Codex Plugin

This plugin lets Codex CLI / Codex App drive the local \`entro\` CLI from the native Codex conversation flow.

Installed capability:

- \`${skillName}\` skill

Expected local dependency:

- \`entro\` available on PATH, or executed via \`npx @ecom/entro\`
`;
}

function readStrictWorkflowOrchestratorPrompt() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const promptPath = path.resolve(currentDir, '..', '..', 'prompts', 'workflow_codex_orchestrator.md');
  return fs.readFileSync(promptPath, 'utf8');
}

export {
  buildCodexInstallPlan,
  buildCodexPluginManifest,
  buildCodexPluginReadme,
  buildCodexSkillMarkdown,
  buildCodexSkillOpenAiYaml,
  buildStrictWorkflowCodexSkillDefinition,
  normalizeCodexInstallMode,
  resolveCodexHome,
  resolveCodexIntegrationDefinition,
};
