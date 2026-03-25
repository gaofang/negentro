import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { normalizeArray, uniqueBy } from '../shared/collections.js';
import { readJson, writeJson, writeJsonIfAbsent } from '../shared/fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureSeedsConfig(context) {
  const seedsPath = path.join(context.paths.config, 'seeds.json');
  writeJsonIfAbsent(seedsPath, {
    required: [],
    optional: [],
  });
}

function loadSeedRegistry(context) {
  const commonPath = path.join(__dirname, '..', 'seeds', 'common.json');
  const optionalPath = path.join(__dirname, '..', 'seeds', 'optional.json');
  const businessPath = path.join(context.paths.config, 'seeds.json');

  const common = readJson(commonPath) || { required: [] };
  const optional = readJson(optionalPath) || { optional: [] };
  const business = readJson(businessPath) || { required: [], optional: [] };

  const merged = [
    ...normalizeSeedEntries(common.required, 'required', 'common'),
    ...normalizeSeedEntries(optional.optional, 'optional', 'optional'),
    ...normalizeSeedEntries(business.required, 'required', 'business'),
    ...normalizeSeedEntries(business.optional, 'optional', 'business'),
  ];

  return uniqueBy(merged, item => item.id);
}

function normalizeSeedEntries(items, priority, source) {
  return normalizeArray(items)
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(rawText => {
      const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
      const headline = lines[0] || rawText;
      return {
        id: buildSeedId(priority, headline, rawText),
        priority,
        source,
        rawText,
        headline,
        body: lines.slice(1).join('\n').trim(),
      };
    });
}

function buildSeedId(priority, headline, rawText) {
  const digest = crypto
    .createHash('sha1')
    .update(`${priority}:${headline}:${rawText}`)
    .digest('hex')
    .slice(0, 10);
  return `seed_${digest}`;
}

function writeMergedSeedsSnapshot(context, seeds) {
  const outputPath = path.join(context.paths.runtime, 'seeds', 'merged-seeds.json');
  writeJson(outputPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seeds,
  });
  return outputPath;
}

function detectSeedSignals(context) {
  const packageJson = readJson(path.join(context.appRoot, 'package.json')) || {};
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  const depNames = Object.keys(deps);
  const hasDependency = name => depNames.includes(name);

  return {
    hasReactQuery: depNames.some(name => /react-query|tanstack\/react-query/i.test(name)),
    hasSwr: hasDependency('swr'),
    hasZustand: hasDependency('zustand'),
    hasMobx: hasDependency('mobx') || hasDependency('mobx-react') || hasDependency('mobx-react-lite'),
    hasRedux: depNames.some(name => /redux/i.test(name)),
    hasZod: hasDependency('zod'),
    hasYup: hasDependency('yup'),
    hasVirtualList: depNames.some(name => /react-window|react-virtualized|virtual/i.test(name)),
  };
}

function activateSeeds(context, seeds) {
  const signals = detectSeedSignals(context);

  const activeSeeds = normalizeArray(seeds).filter(seed => {
    if (seed.priority === 'required') {
      return true;
    }

    const text = `${seed.headline}\n${seed.body}`.toLowerCase();
    if (text.includes('服务端状态') || text.includes('客户端状态')) {
      return signals.hasReactQuery || signals.hasSwr || signals.hasZustand || signals.hasMobx || signals.hasRedux;
    }
    if (text.includes('token 刷新') || text.includes('无感重试') || text.includes('401')) {
      return true;
    }
    if (text.includes('表单校验')) {
      return signals.hasZod || signals.hasYup;
    }
    if (text.includes('大数据列表') || text.includes('虚拟滚动')) {
      return signals.hasVirtualList;
    }
    if (text.includes('store')) {
      return signals.hasZustand || signals.hasMobx || signals.hasRedux;
    }

    return false;
  });

  return {
    signals,
    activeSeeds,
  };
}

function writeActiveSeedsSnapshot(context, payload) {
  const outputPath = path.join(context.paths.runtime, 'seeds', 'active-seeds.json');
  writeJson(outputPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    signals: payload.signals,
    seeds: payload.activeSeeds,
  });
  return outputPath;
}

export {
  ensureSeedsConfig,
  loadSeedRegistry,
  writeMergedSeedsSnapshot,
  activateSeeds,
  writeActiveSeedsSnapshot,
};
