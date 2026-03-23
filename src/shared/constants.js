import path from 'path';

export const DEFAULT_ROOT = process.cwd();
export const ENTRO_DIR = '.entro';
export const SYSTEM_DIR = 'system';
export const OUTPUT_DIR = 'output';
export const CARD_STATUSES = ['draft', 'needs-human', 'needs-review', 'approved', 'rejected', 'deprecated'];
export const QUESTION_STATUSES = ['open', 'answered', 'closed'];
export const DEFAULT_IGNORE_RULES = [
  { kind: 'includes', value: `${path.sep}node_modules${path.sep}` },
  { kind: 'includes', value: `${path.sep}dist${path.sep}` },
  { kind: 'includes', value: `${path.sep}coverage${path.sep}` },
  { kind: 'includes', value: `${path.sep}log${path.sep}` },
  { kind: 'suffix', value: '.map' },
  { kind: 'suffix', value: '.swp' },
  { kind: 'suffix', value: '.DS_Store' },
];
export const DEFAULT_DERIVED_RULES = [
  { kind: 'suffix', value: 'AGENTS.md' },
  { kind: 'includes', value: `${path.sep}.agents${path.sep}` },
  { kind: 'includes', value: `${path.sep}.trae${path.sep}skills${path.sep}` },
];
export const DEFAULT_PROCESS_RULES = [
  { kind: 'includes', value: `${path.sep}${ENTRO_DIR}${path.sep}` },
];
export const DEFAULT_PRIMARY_DOC_RULES = [
  { kind: 'includes', value: `${path.sep}docs${path.sep}` },
  { kind: 'includes', value: `${path.sep}design${path.sep}` },
  { kind: 'includes', value: `${path.sep}protocol${path.sep}` },
];
export const AGENT_EVIDENCE_LIMIT = 18;
export const AGENT_EXCERPT_MAX_CHARS = 1600;
