import path from 'path';
import { writeJson } from '../shared/fs.js';

function persistAgentRun(context, { stage, provider, input, output, options }) {
  const runId = `${stage}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    schemaVersion: 1,
    id: runId,
    stage,
    provider,
    createdAt: new Date().toISOString(),
    mode: 'scaffold',
    options: {
      scope: options.scope || null,
      changedOnly: Boolean(options['changed-only']),
      base: options.base || null,
    },
    input,
    output,
  };

  writeJson(path.join(context.paths.runs, 'agent', `${runId}.json`), record);
  return record;
}

export {
  persistAgentRun,
};
