import path from 'path';
import { readJson } from '../shared/fs.js';

function loadDefaultProvider(context) {
  const providersConfig = readJson(path.join(context.paths.config, 'providers.json')) || {
    default: 'codex_sdk',
    providers: {},
  };
  const providerEnvConfig = readJson(path.join(context.paths.config, 'provider.env.json')) || {
    providers: {},
  };
  const providerId = providersConfig.default || 'codex_sdk';
  const provider = (providersConfig.providers && providersConfig.providers[providerId]) || {};
  const providerEnv = (providerEnvConfig.providers && providerEnvConfig.providers[providerId]) || {};

  return {
    id: providerId,
    type: provider.type || 'codex-sdk',
    timeout_ms: provider.timeout_ms || 12000,
    max_output_tokens: provider.max_output_tokens || 16000,
    env: providerEnv,
  };
}

export {
  loadDefaultProvider,
};
