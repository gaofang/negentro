import fs from 'fs';
import path from 'path';
import readline from 'readline';
import process from 'process';
import React from 'react';
import { Box, Text, render } from 'ink';
import { createContext, DEFAULT_ROOT, findRepoRoot } from '../context.js';
import { normalizeArray } from '../shared/collections.js';
import { chatCommand as fallbackChatCommand } from './chat.js';

async function chatTuiCommand(initialContext, options, helpers) {
  const enableTui = Boolean(options.tui || process.env.ENTRO_TUI === '1');
  if (!enableTui) {
    return fallbackChatCommand(initialContext, options, helpers);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return fallbackChatCommand(initialContext, options, helpers);
  }

  const state = createInitialState(initialContext, options);
  await initializeState(state, helpers);

  const app = render(createAppElement(state), {
    exitOnCtrlC: true,
    patchConsole: false,
  });

  try {
    while (!state.exiting) {
      app.rerender(createAppElement(state));
      const input = await readLineSafely(buildPromptText(state));
      if (input == null) {
        state.exiting = true;
        break;
      }

      const trimmed = String(input || '').trim();
      if (!trimmed) {
        continue;
      }

      await handleInput(state, trimmed, helpers);
    }
  } finally {
    app.unmount();
  }
}

function createInitialState(initialContext, options) {
  return {
    context: options.app ? initialContext : null,
    messages: [],
    openQuestions: [],
    busy: false,
    exiting: false,
  };
}

async function initializeState(state, helpers) {
  if (!state.context) {
    pushMessage(state, 'system', 'entro 已启动。先输入应用路径，或输入 /apps 查看候选应用。');
    const candidates = listAppCandidates(findRepoRoot(DEFAULT_ROOT));
    if (candidates.length) {
      pushMessage(state, 'hint', `应用候选：${candidates.slice(0, 8).join(' | ')}`);
    }
    return;
  }

  await ensureContextInitialized(state.context, helpers);
  refreshQuestions(state, helpers);
  pushMessage(state, 'system', `已进入 ${path.relative(state.context.repoRoot, state.context.appRoot)}`);
  if (state.openQuestions.length) {
    pushCurrentQuestion(state);
    return;
  }

  pushMessage(state, 'hint', '可输入 /run 开始抽取。');
}

async function handleInput(state, input, helpers) {
  if (!state.context && !input.startsWith('/')) {
    await switchAppContext(state, input, helpers);
    return;
  }

  if (input.startsWith('/')) {
    await handleSlashCommand(state, input, helpers);
    return;
  }

  if (hasActiveQuestion(state)) {
    await handleQuestionReply(state, input, helpers);
    return;
  }

  pushMessage(state, 'user', input);
  pushMessage(state, 'hint', '当前没有待确认问题。');
}

async function handleSlashCommand(state, commandLine, helpers) {
  const { name, args, options } = parseChatInput(commandLine);
  pushMessage(state, 'user', commandLine);

  switch (name) {
    case 'exit':
    case 'quit':
      pushMessage(state, 'system', '会话已结束');
      state.exiting = true;
      return;
    case 'help':
      pushMessage(state, 'system', buildHelpText());
      return;
    case 'apps':
      pushMessage(
        state,
        'system',
        listAppCandidates(state.context ? state.context.repoRoot : findRepoRoot(DEFAULT_ROOT)).join('\n') || '未识别到应用候选'
      );
      return;
    case 'use':
      await switchAppContext(state, args[0], helpers);
      return;
    case 'status':
      if (!state.context) {
        pushMessage(state, 'hint', '当前还没有选择应用。');
        return;
      }
      refreshQuestions(state, helpers);
      pushMessage(state, 'system', buildStatusText(state.context, state.openQuestions.length));
      return;
    case 'paths':
      if (!state.context) {
        pushMessage(state, 'hint', '当前还没有选择应用。');
        return;
      }
      pushMessage(state, 'system', buildPathsText(state.context));
      return;
    case 'question':
    case 'questions':
      if (!state.context) {
        pushMessage(state, 'hint', '当前还没有选择应用。');
        return;
      }
      refreshQuestions(state, helpers);
      if (!state.openQuestions.length) {
        pushMessage(state, 'system', '当前没有待确认问题。');
        return;
      }
      pushCurrentQuestion(state);
      return;
    case 'run':
    case 'extract':
    case 'build':
    case 'clean':
      if (!state.context) {
        pushMessage(state, 'hint', '请先输入应用路径，或使用 /use <app>。');
        return;
      }
      break;
    default:
      pushMessage(state, 'hint', `未知命令：/${name}，输入 /help 查看命令。`);
      return;
  }

  state.busy = true;
  try {
    if (name === 'run') {
      maybeWarnBusinessSeeds(state, helpers);
      await runCaptured(state, async () => {
        await helpers.runCommand(state.context, options, helpers.runHelpers);
      });
      refreshQuestions(state, helpers);
      if (state.openQuestions.length) {
        pushCurrentQuestion(state);
      } else {
        pushMessage(state, 'system', '当前没有待确认问题，可以直接执行 /build。');
      }
      return;
    }

    if (name === 'extract') {
      maybeWarnBusinessSeeds(state, helpers);
      await runCaptured(state, async () => {
        await helpers.extractCommand(state.context, options, helpers.extractHelpers);
      });
      refreshQuestions(state, helpers);
      if (state.openQuestions.length) {
        pushCurrentQuestion(state);
      } else {
        pushMessage(state, 'system', '抽取完成，当前没有待确认问题。');
      }
      return;
    }

    if (name === 'build') {
      refreshQuestions(state, helpers);
      if (state.openQuestions.length) {
        pushCurrentQuestion(state);
        return;
      }

      await runCaptured(state, async () => {
        await helpers.consolidateCommand(state.context, options, helpers.buildHelpers);
      });
      return;
    }

    if (name === 'clean') {
      await runCaptured(state, async () => {
        helpers.cleanCommand(state.context, options);
      });
      refreshQuestions(state, helpers);
    }
  } catch (error) {
    pushMessage(state, 'system', `执行失败：${error.message}`);
  } finally {
    state.busy = false;
  }
}

async function handleQuestionReply(state, rawInput, helpers) {
  const currentQuestion = state.openQuestions[0];
  if (!currentQuestion) {
    pushMessage(state, 'hint', '当前没有待确认问题。');
    return;
  }

  pushMessage(state, 'user', rawInput);
  const answerText = normalizeReplyForQuestion(currentQuestion, rawInput);

  await runCaptured(state, async () => {
    await helpers.answerCommand(
      state.context,
      {
        question: currentQuestion.meta.id,
        text: answerText,
      },
      helpers.answerHelpers
    );

    helpers.reconcileCommand(
      state.context,
      {
        question: currentQuestion.meta.id,
      },
      helpers.reconcileHelpers
    );
  });

  refreshQuestions(state, helpers);
  if (!state.openQuestions.length) {
    pushMessage(state, 'system', '所有待确认问题已处理完成，可以直接执行 /build。');
    return;
  }

  pushMessage(state, 'system', `继续下一个问题，剩余 ${state.openQuestions.length} 个。`);
  pushCurrentQuestion(state);
}

async function switchAppContext(state, appInput, helpers) {
  const trimmed = String(appInput || '').trim();
  if (!trimmed) {
    pushMessage(state, 'hint', '请输入应用路径，例如：apps/goods/ffa-goods');
    return;
  }

  const nextContext = createContext(trimmed);
  await ensureContextInitialized(nextContext, helpers);
  state.context = nextContext;
  refreshQuestions(state, helpers);
  pushMessage(state, 'system', `已切换到 ${path.relative(nextContext.repoRoot, nextContext.appRoot)}`);
  if (state.openQuestions.length) {
    pushCurrentQuestion(state);
  } else {
    pushMessage(state, 'hint', '可输入 /run 开始抽取。');
  }
}

async function ensureContextInitialized(context, helpers) {
  helpers.ensureInitializedOrInit(context, () => {
    helpers.migrateLegacyFiles(context);
    return null;
  });
}

function refreshQuestions(state, helpers) {
  if (!state.context) {
    state.openQuestions = [];
    return [];
  }

  state.openQuestions = loadOpenQuestions(state.context, helpers);
  return state.openQuestions;
}

function hasActiveQuestion(state) {
  return Boolean(state.context && state.openQuestions.length);
}

async function runCaptured(state, fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const outputs = [];

  console.log = (...args) => {
    outputs.push({ role: 'system', text: args.map(formatConsoleArg).join(' ') });
  };
  console.error = (...args) => {
    outputs.push({ role: 'hint', text: args.map(formatConsoleArg).join(' ') });
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  outputs.forEach(item => pushMessage(state, item.role, item.text));
}

function pushMessage(state, role, text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return;
  }

  const kind =
    role === 'question' ? 'question'
    : role === 'user' ? 'input'
    : role === 'hint' ? 'muted'
    : 'log';

  state.messages = state.messages
    .concat({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      kind,
      text: normalized,
    })
    .slice(-120);
}

function pushCurrentQuestion(state) {
  const question = state.openQuestions[0];
  if (!question) {
    return;
  }

  pushMessage(state, 'question', renderQuestionMessage(question, state.openQuestions.length));
}

function renderQuestionMessage(question, total) {
  const lines = [
    `当前待确认问题（1/${total}）`,
    '',
    question.body.title,
    '',
    question.body.prompt,
  ];

  if (question.body.background) {
    lines.push('', `背景：${question.body.background}`);
  }

  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    lines.push('', '请直接回复编号、option id，或补一句说明：');
    normalizeArray(question.body.expectedAnswer.options).forEach((option, index) => {
      const optionLine = `${index + 1}. ${option.label}`;
      lines.push(option.description ? `${optionLine}\n   ${option.description}` : optionLine);
    });
    lines.push('', '也可以输入：跳过 / 不确定');
  } else {
    lines.push('', '直接补充上下文；不确定可输入 跳过 / 不确定。');
  }

  return lines.join('\n');
}

function createAppElement(state) {
  return ui(
    Box,
    {
      flexDirection: 'column',
      paddingX: 1,
      paddingY: 0,
    },
    ui(Header, { summary: buildSessionSummary(state), busy: state.busy }),
    ui(Box, {
      flexDirection: 'column',
      marginTop: 1,
      minHeight: 20,
    },
      ui(MessageList, { messages: state.messages }),
    ),
    ui(Box, { marginTop: 1 },
      ui(ComposerBar, { prompt: buildPromptText(state) }),
    ),
  );
}

function Header({ summary, busy }) {
  return ui(
    Box,
    {
      flexDirection: 'column',
    },
    ui(Text, { color: 'gray' }, `entro · ${summary}${busy ? ' · 运行中' : ''}`),
  );
}

function MessageList({ messages }) {
  if (!messages.length) {
    return ui(Text, { color: 'gray' }, '暂无消息');
  }

  const recent = messages.slice(-18);
  return ui(
    Box,
    { flexDirection: 'column' },
    ...recent.map(message => ui(MessageBlock, {
      key: message.id,
      message,
    })),
  );
}

function MessageBlock({ message }) {
  const kind = message.kind || 'log';
  const lines = String(message.text || '').split('\n');

  if (kind === 'question') {
    return ui(
      Box,
      {
        flexDirection: 'column',
        marginBottom: 1,
      },
      ...lines.map((line, index) => ui(
        Text,
        {
          key: `${message.id}_${index}`,
          color: index === 0 ? 'magenta' : undefined,
          bold: index === 0 || index === 2,
        },
        line || ' ',
      )),
    );
  }

  if (kind === 'input') {
    return ui(
      Box,
      {
        flexDirection: 'column',
        marginBottom: 1,
      },
      ...lines.map((line, index) => ui(
        Text,
        {
          key: `${message.id}_${index}`,
          color: 'green',
        },
        `${index === 0 ? '> ' : '  '}${line || ' '}`,
      )),
    );
  }

  return ui(
    Box,
    {
      flexDirection: 'column',
      marginBottom: 1,
    },
    ...lines.map((line, index) => ui(
      Text,
      {
        key: `${message.id}_${index}`,
        color: kind === 'muted' ? 'gray' : undefined,
      },
      line || ' ',
    )),
  );
}

function ComposerBar({ prompt }) {
  return ui(
    Box,
    {
      flexDirection: 'row',
      backgroundColor: 'black',
      paddingX: 1,
      paddingY: 0,
    },
    ui(Text, { color: 'green', bold: true }, '>'),
    ui(Text, { color: 'gray' }, ` ${prompt}`),
  );
}

function buildPromptText(state) {
  if (!state.context) {
    return '输入应用路径';
  }

  if (hasActiveQuestion(state)) {
    return '输入答案，或输入 /run /build /help';
  }

  return '输入 /run /build /help';
}

function buildSessionSummary(state) {
  if (!state.context) {
    return '未选择应用';
  }

  const appLabel = path.relative(state.context.repoRoot, state.context.appRoot);
  const stage = state.busy ? 'running' : hasActiveQuestion(state) ? 'question' : 'ready';
  const agentsPath = path.join(state.context.outputRoot, 'AGENTS.md');
  const skillsRoot = path.join(state.context.outputRoot, 'skills');
  const skillsCount = fs.existsSync(skillsRoot)
    ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
    : 0;

  const stageLabel =
    stage === 'question' ? '待确认' : stage === 'running' ? '处理中' : '就绪';
  return `${appLabel} · ${stageLabel} · 待确认 ${state.openQuestions.length} · AGENTS ${fs.existsSync(agentsPath) ? '已生成' : '未生成'} · skills ${skillsCount}`;
}

function buildHelpText() {
  return [
    '命令：',
    '/use <app-path>',
    '/apps',
    '/status',
    '/run',
    '/extract',
    '/question',
    '/build',
    '/paths',
    '/clean [--all]',
    '/help',
    '/exit',
    '',
    '答题方式：',
    '- 直接回复编号，例如 1 / 2',
    '- 直接回复 option id',
    '- 直接补充一句中文说明',
    '- 输入 跳过 / 不确定 暂时略过当前问题',
  ].join('\n');
}

function buildStatusText(context, openQuestionCount) {
  const skillsRoot = path.join(context.outputRoot, 'skills');
  const skillsCount = fs.existsSync(skillsRoot)
    ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
    : 0;

  return [
    `app: ${path.relative(context.repoRoot, context.appRoot)}`,
    `open questions: ${openQuestionCount}`,
    `generated AGENTS: ${fs.existsSync(path.join(context.outputRoot, 'AGENTS.md')) ? 'yes' : 'no'}`,
    `generated skills: ${skillsCount}`,
  ].join('\n');
}

function buildPathsText(context) {
  return [
    `app: ${context.appRoot}`,
    `config: ${context.configRoot}`,
    `output: ${context.outputRoot}`,
    `runtime: ${context.runtimeRoot}`,
  ].join('\n');
}

function maybeWarnBusinessSeeds(state, helpers) {
  const config = helpers.readJson(path.join(state.context.paths.config, 'seeds.json')) || {
    required: [],
    optional: [],
  };
  const total = normalizeArray(config.required).length + normalizeArray(config.optional).length;
  if (!total) {
    pushMessage(state, 'hint', '当前还没有业务定制种子；如有需要，请先编辑 .entro/config/seeds.json。');
  }
}

function loadOpenQuestions(context, helpers) {
  const directory = path.join(context.paths.questions, 'open');
  const files = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort()
    : [];

  const questions = files
    .map(file => helpers.readJson(path.join(directory, file)))
    .filter(Boolean);
  return helpers.dedupeOpenQuestionsByRoot
    ? helpers.dedupeOpenQuestionsByRoot(questions, context.paths.questions)
    : questions;
}

function normalizeReplyForQuestion(question, input) {
  if (!(question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice')) {
    return input;
  }

  const trimmed = String(input || '').trim();
  if (isSkipReply(trimmed)) {
    return trimmed;
  }

  const options = normalizeArray(question.body.expectedAnswer.options);
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || '';
  const byId = options.find(option => option.id === firstToken);
  const byIndex = Number(firstToken);

  if (byId) {
    const comment = tokens.slice(1).join(' ').trim();
    return comment ? `${byId.id}\ncomment: ${comment}` : byId.id;
  }

  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= options.length) {
    const selected = options[byIndex - 1].id;
    const comment = tokens.slice(1).join(' ').trim();
    return comment ? `${selected}\ncomment: ${comment}` : selected;
  }

  const fuzzyMatched = findFuzzyMatchedOption(options, trimmed);
  if (fuzzyMatched) {
    return `${fuzzyMatched.id}\ncomment: ${trimmed}`;
  }

  return trimmed;
}

function findFuzzyMatchedOption(options, input) {
  const normalizedInput = normalizeLooseText(input);
  if (!normalizedInput) {
    return null;
  }

  return options.find(option => {
    const label = normalizeLooseText(option.label);
    const description = normalizeLooseText(option.description);
    return (
      (label && normalizedInput.includes(label)) ||
      (description && normalizedInput.includes(description)) ||
      (label && label.includes(normalizedInput)) ||
      (description && description.includes(normalizedInput))
    );
  }) || null;
}

function normalizeLooseText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function isSkipReply(input) {
  const normalized = String(input || '').trim().toLowerCase();
  return ['skip', '跳过', '先跳过', 'pass', '不确定', '不知道', '暂不确定', 'uncertain', 'not sure'].includes(normalized);
}

function parseChatInput(input) {
  const normalizedInput = String(input || '').trim().startsWith('/')
    ? String(input || '').trim().slice(1)
    : String(input || '').trim();
  const tokens = tokenize(normalizedInput);
  const [name = 'help', ...rest] = tokens;
  const options = {};
  const args = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
    } else {
      args.push(token);
    }
  }

  return { name, args, options };
}

function tokenize(input) {
  const tokens = [];
  const matches = String(input || '').match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
  matches.forEach(match => {
    if ((match.startsWith('"') && match.endsWith('"')) || (match.startsWith('\'') && match.endsWith('\''))) {
      tokens.push(match.slice(1, -1));
    } else {
      tokens.push(match);
    }
  });
  return tokens;
}

function formatConsoleArg(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readLineSafely(prompt) {
  process.stdout.write(`\n\x1b[40m\x1b[32m>\x1b[0m \x1b[90m${prompt}\x1b[0m\n\x1b[40m\x1b[32m>\x1b[0m `);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    return await new Promise(resolve => {
      rl.question('', answer => {
        resolve(answer);
      });
    });
  } finally {
    rl.close();
  }
}

function listAppCandidates(repoRoot) {
  const appsRoot = path.join(repoRoot, 'apps');
  if (!fs.existsSync(appsRoot)) {
    return [];
  }

  const results = [];
  walkAppCandidates(appsRoot, repoRoot, results, 0);
  return results.sort();
}

function walkAppCandidates(current, repoRoot, results, depth) {
  if (depth > 3 || !fs.existsSync(current)) {
    return;
  }

  const packageJsonPath = path.join(current, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    results.push(path.relative(repoRoot, current));
    return;
  }

  fs.readdirSync(current, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .forEach(entry => {
      walkAppCandidates(path.join(current, entry.name), repoRoot, results, depth + 1);
    });
}

function ui(component, props, ...children) {
  return React.createElement(component, props, ...children.filter(item => item !== null && item !== undefined));
}

export {
  chatTuiCommand,
};
