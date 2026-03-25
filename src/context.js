import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  DEFAULT_ROOT,
  ENTRO_DIR,
  OUTPUT_DIR,
} from './shared/constants.js';

export function createContext(appRootInput) {
  const appRoot = path.resolve(appRootInput);
  const repoRoot = findRepoRoot(appRoot);
  const entroRoot = path.join(appRoot, ENTRO_DIR);
  const configRoot = path.join(entroRoot, 'config');
  const outputRoot = path.join(entroRoot, OUTPUT_DIR);
  const legacySystemRoot = path.join(entroRoot, 'system');
  const runtimeRoot = resolveRuntimeRoot(repoRoot, appRoot);

  return {
    repoRoot,
    workspaceRoot: repoRoot,
    appRoot,
    entroRoot,
    configRoot,
    systemRoot: runtimeRoot,
    runtimeRoot,
    legacySystemRoot,
    outputRoot,
    paths: {
      config: configRoot,
      evidence: path.join(runtimeRoot, 'evidence'),
      tasks: path.join(runtimeRoot, 'tasks'),
      candidates: path.join(runtimeRoot, 'candidates'),
      cards: path.join(runtimeRoot, 'cards'),
      questions: path.join(runtimeRoot, 'questions'),
      answers: path.join(runtimeRoot, 'answers'),
      publications: outputRoot,
      output: outputRoot,
      snapshots: path.join(runtimeRoot, 'snapshots'),
      runs: path.join(runtimeRoot, 'runs'),
      drift: path.join(runtimeRoot, 'drift'),
      eval: path.join(runtimeRoot, 'eval'),
      runtime: path.join(runtimeRoot, 'runtime'),
      publicationState: path.join(runtimeRoot, 'publication'),
    },
  };
}

export function findRepoRoot(startPath) {
  let current = path.resolve(startPath);

  while (true) {
    if (fs.existsSync(path.join(current, 'eden.monorepo.json')) || fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startPath);
    }
    current = parent;
  }
}

export function toRepoRelative(context, targetPath) {
  return path.relative(context.repoRoot, path.resolve(targetPath)) || '.';
}

function resolveRuntimeRoot(repoRoot, appRoot) {
  const baseDir = process.env.ENTRO_RUNTIME_HOME
    ? path.resolve(process.env.ENTRO_RUNTIME_HOME)
    : path.join(os.homedir(), '.entro', 'tmp');
  const repoDigest = crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 12);
  const appRelative = path.relative(repoRoot, appRoot) || 'app';
  const appSlug = appRelative
    .replace(/[\\/]+/g, '__')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);

  return path.join(baseDir, repoDigest, appSlug);
}

export { DEFAULT_ROOT };
