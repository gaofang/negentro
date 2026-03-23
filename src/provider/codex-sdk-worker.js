import path from 'path';
import { Codex } from '@openai/codex-sdk';

function resolveApiKey({ provider }) {
  const preferredEnv = provider.api_key_env || 'OPENAI_API_KEY';
  return (
    provider.api_key ||
    process.env[preferredEnv] ||
    process.env.CODEX_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  );
}

function buildCodexHome({ cwd }) {
  return path.resolve(cwd, '.entro', 'system', 'runtime', 'codex-home');
}

function buildCodexEnv({ cwd, provider }) {
  const apiKey = resolveApiKey({ provider });
  const baseUrl = provider.base_url || process.env.OPENAI_BASE_URL || '';
  const codexHome = buildCodexHome({ cwd });
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: codexHome,
  };

  if (apiKey) {
    env.CODEX_API_KEY = apiKey;
  }
  if (baseUrl) {
    env.OPENAI_BASE_URL = baseUrl;
  }

  return env;
}

function buildThreadOptions({ cwd, provider }) {
  return {
    workingDirectory: cwd,
    model: provider.model && provider.model !== 'default' ? provider.model : undefined,
    approvalPolicy: provider.approval_policy || 'never',
    sandboxMode: provider.sandbox_mode || 'read-only',
    webSearchEnabled: Boolean(provider.web_search_enabled),
    networkAccessEnabled: Boolean(provider.network_access_enabled),
  };
}

function summarizeCodexSdkFailure(error) {
  const message = String(error && error.message ? error.message : error || '');
  const lowercase = message.toLowerCase();

  if (message.includes('401') || lowercase.includes('unauthorized')) {
    return `codex sdk unauthorized: ${message}`;
  }
  if (lowercase.includes('invalid model') || lowercase.includes('product not right')) {
    return `codex sdk invalid model: ${message}`;
  }
  if (lowercase.includes('timeout')) {
    return `codex sdk timeout: ${message}`;
  }
  if (lowercase.includes('network') || message.includes('/v1/responses') || message.includes('/responses')) {
    return `codex sdk network failure: ${message}`;
  }
  return `codex sdk failed: ${message}`;
}

function validateProviderConfig(provider) {
  if (provider.base_url && !provider.network_access_enabled) {
    return 'codex sdk config invalid: 使用自定义 base_url 时，`provider.env.json` 里的 `network_access_enabled` 必须设为 true';
  }

  if (provider.base_url && (!provider.model || provider.model === 'default')) {
    return 'codex sdk config invalid: 使用自定义 base_url 时，必须在 `provider.env.json` 里显式配置 `model`';
  }

  return null;
}

function extractCodexSdkText(result) {
  if (!result) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if (typeof result.finalResponse === 'string') {
    return result.finalResponse;
  }
  if (typeof result.finalOutput === 'string') {
    return result.finalOutput;
  }
  if (typeof result.outputText === 'string') {
    return result.outputText;
  }
  if (typeof result.lastMessage === 'string') {
    return result.lastMessage;
  }
  return JSON.stringify(result, null, 2);
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function writeFailure(error) {
  writeResult({
    ok: false,
    exitCode: 1,
    rawText: '',
    outputMessage: '',
    stderr: String(error && error.stack ? error.stack : error),
    error: summarizeCodexSdkFailure(error),
  });
}

process.on('uncaughtException', error => {
  writeFailure(error);
  process.exit(1);
});

process.on('unhandledRejection', error => {
  writeFailure(error);
  process.exit(1);
});

async function main() {
  const payload = await readPayload();
  const { cwd, provider, prompt, schema } = payload;
  const apiKey = resolveApiKey({ provider });
  const configError = validateProviderConfig(provider);

  if (!apiKey) {
    writeResult({
      ok: false,
      exitCode: 1,
      rawText: '',
      outputMessage: '',
      stderr: '',
      error: 'codex sdk unauthorized: missing api key',
    });
    return;
  }

  if (configError) {
    writeResult({
      ok: false,
      exitCode: 1,
      rawText: '',
      outputMessage: '',
      stderr: '',
      error: configError,
    });
    return;
  }

  try {
    const client = new Codex({
      apiKey,
      baseUrl: provider.base_url || undefined,
      env: buildCodexEnv({ cwd, provider }),
    });
    const thread = client.startThread(buildThreadOptions({ cwd, provider }));
    const result = await thread.run(prompt, {
      outputSchema: schema,
    });
    const outputMessage = extractCodexSdkText(result);
    writeResult({
      ok: true,
      exitCode: 0,
      rawText: JSON.stringify(result, null, 2),
      outputMessage,
      stderr: '',
      error: null,
    });
  } catch (error) {
    writeFailure(error);
  }
}

await main();
