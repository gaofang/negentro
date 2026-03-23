import { Codex } from '@openai/codex-sdk';

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
  const { cwd, prompt, schema } = payload;

  try {
    const client = new Codex();
    const thread = client.startThread({
      workingDirectory: cwd,
    });
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
