import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJson, writeJson, ensureDir } from '../shared/fs.js';
import { normalizeArray } from '../shared/collections.js';
import { runCodexSdkProvider } from '../provider/codex-sdk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readBuiltinPrompt(fileName) {
  const promptPath = path.join(__dirname, '..', '..', 'prompts', fileName);
  return fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';
}

async function executeAgentTask(context, { stage, provider, promptFile, promptInput, outputSchema }) {
  const runtimeHome = ensureAgentRuntimeHome();
  const schemaPath = path.join(runtimeHome, `${stage}.schema.json`);
  writeJson(schemaPath, outputSchema);

  const prompt = buildAgentPrompt(readBuiltinPrompt(promptFile), promptInput);
  const result = await executeProvider(context, provider, {
    stage,
    prompt,
    schemaPath,
    runtimeHome,
  });

  const parsed = tryParseJson(result.outputMessage || result.rawText);
  return {
    ok: result.ok && Boolean(parsed),
    providerError: result.ok ? (parsed ? null : 'agent returned non-json content') : result.error,
    parsed,
    rawText: result.outputMessage || result.rawText,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

function buildAgentSummary(attempt) {
  return {
    ok: attempt.ok,
    providerError: attempt.providerError,
    exitCode: attempt.exitCode || null,
    rawTextPreview: String(attempt.rawText || '').slice(0, 400),
    stderrPreview: String(attempt.stderr || '').slice(0, 400),
  };
}

function printAgentRunSummaries(runs) {
  normalizeArray(runs).forEach(run => {
    const agent = run.output && run.output.agent;
    if (!agent) {
      return;
    }
    if (agent.ok) {
      console.log(`[entro] ${run.stage}: agent 主路径成功`);
      return;
    }
    console.log(`[entro] ${run.stage}: agent 主路径失败（${agent.providerError || 'unknown error'}）`);
  });
}

async function executeProvider(context, provider, task) {
  switch (provider.type) {
    case 'codex-sdk':
      return runCodexSdkProvider({
        cwd: context.repoRoot,
        provider,
        prompt: task.prompt,
        schema: readJson(task.schemaPath),
      });
    default:
      return {
        ok: false,
        exitCode: 1,
        rawText: '',
        outputMessage: '',
        stderr: '',
        error: `unsupported provider type: ${provider.type}`,
      };
  }
}

function ensureAgentRuntimeHome() {
  const runtimeHome = path.join(os.tmpdir(), 'entro-codex-home');
  ensureDir(runtimeHome);
  return runtimeHome;
}

function buildAgentPrompt(instruction, payload) {
  return [
    instruction.trim(),
    '',
    '请严格按输出 schema 返回 JSON，不要输出代码块，不要解释。',
    '',
    '输入数据：',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function tryParseJson(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    const match = value.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

export {
  readBuiltinPrompt,
  executeAgentTask,
  buildAgentSummary,
  printAgentRunSummaries,
};
