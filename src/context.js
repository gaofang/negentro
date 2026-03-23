import fs from 'fs';
import path from 'path';
import {
  DEFAULT_ROOT,
  ENTRO_DIR,
  SYSTEM_DIR,
  OUTPUT_DIR,
} from './shared/constants.js';

export function createContext(appRootInput) {
  const appRoot = path.resolve(appRootInput);
  const repoRoot = findRepoRoot(appRoot);
  const entroRoot = path.join(appRoot, ENTRO_DIR);
  const systemRoot = path.join(entroRoot, SYSTEM_DIR);
  const outputRoot = path.join(entroRoot, OUTPUT_DIR);

  return {
    repoRoot,
    workspaceRoot: repoRoot,
    appRoot,
    entroRoot,
    systemRoot,
    outputRoot,
    paths: {
      config: path.join(systemRoot, 'config'),
      evidence: path.join(systemRoot, 'evidence'),
      tasks: path.join(systemRoot, 'tasks'),
      candidates: path.join(systemRoot, 'candidates'),
      cards: path.join(systemRoot, 'cards'),
      questions: path.join(systemRoot, 'questions'),
      answers: path.join(systemRoot, 'answers'),
      publications: outputRoot,
      output: outputRoot,
      snapshots: path.join(systemRoot, 'snapshots'),
      runs: path.join(systemRoot, 'runs'),
      drift: path.join(systemRoot, 'drift'),
      eval: path.join(systemRoot, 'eval'),
      runtime: path.join(systemRoot, 'runtime'),
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

export { DEFAULT_ROOT };
