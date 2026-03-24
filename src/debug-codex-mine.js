import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Codex } from '@openai/codex-sdk';
import { createContext } from './context.js';
import { buildRepositoryDistillationInput, buildRepositoryDistillationSchema } from './services/distill.js';
import { normalizeArray } from './shared/collections.js';
import { ensureDir, readJson, writeJson, writeText } from './shared/fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const app = options.app || process.cwd();
  const scopeId = options.scope || 'app';
  const run = options.run === true || options.run === 'true';
  const noSchema = options['no-schema'] === true || options['no-schema'] === 'true';
  const evidenceLimit = Number(options['evidence-limit'] || 18);
  const excerptChars = Number(options['excerpt-chars'] || 1600);
  const context = createContext(app);

  const scopesConfig = readJson(path.join(context.paths.config, 'scopes.json')) || { scopes: [] };
  const owners = readJson(path.join(context.paths.config, 'owners.json')) || { owners: [] };
  const catalog = readJson(path.join(context.paths.evidence, 'catalog', 'sources.json'));

  if (!catalog || !Array.isArray(catalog.sources)) {
    throw new Error('source catalog missing. Run `node packages/entro/src/cli.js classify-sources --app <app>` first.');
  }

  const scope = scopesConfig.scopes.find(item => item.id === scopeId);
  if (!scope) {
    throw new Error(`scope not found: ${scopeId}`);
  }

  const promptInput = buildRepositoryDistillationInput(context, [scope], owners, catalog.sources, [], {
    toRepoRelative,
    filterChangedFilesForScope,
    buildEvidenceBundleForScope: (ctx, currentScope, sources, helpers) =>
      buildEvidenceBundleForScope(ctx, currentScope, sources, helpers, {
        evidenceLimit,
        excerptChars,
      }),
    filterSourcesForScope,
    findOwner,
  });

  const instruction = readBuiltinPrompt('repository_distillation.md');
  const prompt = buildAgentPrompt(instruction, promptInput);
  const schema = noSchema ? null : buildRepositoryDistillationSchema();
  const debugDir = path.join(context.paths.runs, 'debug');

  ensureDir(debugDir);
  writeText(path.join(debugDir, `distill-${scopeId}.prompt.txt`), prompt);
  writeJson(path.join(debugDir, `distill-${scopeId}.input.json`), promptInput);
  if (schema) {
    writeJson(path.join(debugDir, `distill-${scopeId}.schema.json`), schema);
  }

  const summary = {
    appRoot: context.appRoot,
    repoRoot: context.repoRoot,
    scope: scopeId,
    promptChars: prompt.length,
    approxPromptTokens: Math.round(prompt.length / 4),
    evidenceCount: normalizeArray(promptInput.scopes[0] && promptInput.scopes[0].evidenceBundle).length,
    evidenceExcerptChars: normalizeArray(promptInput.scopes[0] && promptInput.scopes[0].evidenceBundle).reduce(
      (sum, item) => sum + String(item.excerpt || '').length,
      0,
    ),
    noSchema,
    evidenceLimit,
    excerptChars,
    promptFile: path.join(debugDir, `distill-${scopeId}.prompt.txt`),
    inputFile: path.join(debugDir, `distill-${scopeId}.input.json`),
    schemaFile: schema ? path.join(debugDir, `distill-${scopeId}.schema.json`) : null,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!run) {
    console.log('[entro-debug] dry-run only. Add `--run` to call Codex.');
    return;
  }

  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: context.repoRoot,
  });
  const result = await thread.run(prompt, {
    ...(schema ? { outputSchema: schema } : {}),
  });

  writeJson(path.join(debugDir, `distill-${scopeId}.result.json`), result);
  console.log('[entro-debug] finalResponse:');
  console.log(result.finalResponse);
}

function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    const hasValue = next && !next.startsWith('--');

    if (hasValue) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return options;
}

function readBuiltinPrompt(fileName) {
  const promptPath = path.join(__dirname, '..', 'prompts', fileName);
  return fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';
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

function toRepoRelative(context, targetPath) {
  return path.relative(context.repoRoot, path.resolve(targetPath)) || '.';
}

function filterChangedFilesForScope(changedFiles, scopePaths) {
  return normalizeArray(changedFiles).filter(file => normalizeArray(scopePaths).some(scopePath => file.startsWith(scopePath)));
}

function filterSourcesForScope(sources, scope) {
  const scopePaths = normalizeArray(scope.primaryRoots).length ? normalizeArray(scope.primaryRoots) : normalizeArray(scope.paths);
  return normalizeArray(sources).filter(
    source =>
      source &&
      source.evidence_class === 'primary' &&
      source.source_role !== 'agent-guidance' &&
      scopePaths.some(scopePath => String(source.path || '').startsWith(scopePath)),
  );
}

function buildEvidenceBundleForScope(context, scope, sources, helpers, config = {}) {
  const evidenceLimit = Number(config.evidenceLimit || 18);
  const excerptChars = Number(config.excerptChars || 1600);
  return helpers.filterSourcesForScope(sources, scope)
    .slice(0, evidenceLimit)
    .map(source => buildEvidenceEntry(context, source.path, excerptChars));
}

function buildEvidenceEntry(context, relativePath, excerptChars) {
  const absolutePath = path.join(context.repoRoot, relativePath);
  return {
    path: relativePath,
    excerpt: readFileExcerpt(absolutePath, excerptChars),
  };
}

function readFileExcerpt(absolutePath, excerptChars = 1600) {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return '';
  }

  return fs.readFileSync(absolutePath, 'utf8').slice(0, excerptChars);
}

function findOwner(pathsToCheck, ownersConfig) {
  const ownerRecord = normalizeArray(ownersConfig.owners).find(entry =>
    normalizeArray(pathsToCheck).some(candidate => String(entry.pattern || '').includes(candidate.replace(/^\//, ''))),
  );

  return ownerRecord ? ownerRecord.reviewers : [];
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
