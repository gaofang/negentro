import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'codex-sdk-worker.js');

async function runCodexSdkProvider({ cwd, provider, prompt, schema }) {
  const payload = {
    cwd,
    provider,
    prompt,
    schema,
  };

  return new Promise(resolve => {
    const child = spawn(process.execPath, [WORKER_PATH], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finalize = result => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', error => {
      finalize({
        ok: false,
        exitCode: 1,
        rawText: stdout,
        outputMessage: '',
        stderr: stderr || String(error && error.stack ? error.stack : error),
        error: `codex sdk worker failed: ${error && error.message ? error.message : String(error)}`,
      });
    });

    child.on('close', code => {
      const result = parseWorkerOutput(stdout);
      if (result) {
        finalize({
          ...result,
          exitCode: typeof result.exitCode === 'number' ? result.exitCode : code || 0,
          stderr: result.stderr || stderr,
        });
        return;
      }

      finalize({
        ok: false,
        exitCode: typeof code === 'number' ? code : 1,
        rawText: stdout,
        outputMessage: '',
        stderr,
        error: buildWorkerFailureMessage(code, stdout, stderr),
      });
    });

    child.stdin.on('error', () => {
      // SDK 底层 codex 进程在异常退出时可能导致上游 stdin 提前断开。
      // 这里吞掉写入阶段的 pipe 错误，让最终错误由 worker 的 stderr/exit code 来表达。
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function parseWorkerOutput(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return null;
  }

  const lines = content.split('\n').filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (error) {
      continue;
    }
  }

  return null;
}

function buildWorkerFailureMessage(code, stdout, stderr) {
  const stderrText = String(stderr || '').trim();
  const stdoutText = String(stdout || '').trim();

  if (stderrText) {
    return `codex sdk worker failed: ${stderrText}`;
  }
  if (stdoutText) {
    return `codex sdk worker failed: ${stdoutText}`;
  }
  return `codex sdk worker exited with code ${typeof code === 'number' ? code : 'unknown'}`;
}

export { runCodexSdkProvider };
