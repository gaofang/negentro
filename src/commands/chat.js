import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createContext, DEFAULT_ROOT, findRepoRoot } from '../context.js';
import { normalizeArray } from '../shared/collections.js';

async function chatCommand(initialContext, options, helpers) {
  const io = createChatIo();
  const state = {
    context: initialContext,
    appInput: options.app || '',
    questionMode: false,
  };

  try {
    if (!options.app) {
      state.context = null;
    }

    printChatBanner(state, helpers);

    if (!state.context) {
      await ensureAppSelected(state, io, helpers);
    } else {
      await maybeInitContext(state, helpers);
      await maybeEnterQuestionMode(state, helpers);
    }

    while (true) {
      const promptLabel = buildPromptLabel(state);
      const input = String(await io.ask(`${promptLabel}> `)).trim();
      if (!input) {
        if (state.questionMode) {
          await showCurrentQuestion(state, helpers);
        }
        continue;
      }

      if (state.questionMode && !isSlashCommand(input)) {
        const shouldExitFromAnswer = await handleQuestionReply(state, input, helpers);
        if (shouldExitFromAnswer) {
          break;
        }
        continue;
      }

      const parsed = parseChatInput(input);
      const shouldExit = await handleChatCommand(state, parsed, io, helpers);
      if (shouldExit) {
        break;
      }
    }
  } finally {
    io.close();
  }
}

async function handleChatCommand(state, parsed, io, helpers) {
  const { name, args, options } = parsed;

  switch (name) {
    case 'exit':
    case 'quit':
      console.log('[entro] 会话已结束');
      return true;
    case 'help':
      printChatHelp();
      return false;
    case 'status':
      requireContext(state);
      printSessionHeader(state.context);
      if (state.questionMode) {
        await showCurrentQuestion(state, helpers);
      }
      return false;
    case 'paths':
      requireContext(state);
      helpers.printPaths(state.context);
      return false;
    case 'use':
      await switchAppContext(state, args[0], io, helpers);
      return false;
    case 'apps':
      printAppCandidates(state, helpers);
      return false;
    case 'seed':
    case 'seeds':
      requireContext(state);
      await handleSeedCommand(state, args, io, helpers);
      return false;
    case 'question':
    case 'questions':
      requireContext(state);
      await handleQuestionCommand(state, args, io, helpers);
      return false;
    case 'run':
      requireContext(state);
      await maybePromptCustomSeeds(state, io, helpers);
      await helpers.runCommand(state.context, options, helpers.runHelpers);
      await maybeEnterQuestionMode(state, helpers);
      return false;
    case 'extract':
      requireContext(state);
      await maybePromptCustomSeeds(state, io, helpers);
      await helpers.extractCommand(state.context, options, helpers.extractHelpers);
      await maybeEnterQuestionMode(state, helpers);
      return false;
    case 'build':
      requireContext(state);
      if (state.questionMode) {
        console.log('[entro] 当前还有待确认问题。你可以直接回复答案，或输入 skip / 跳过 暂时略过。');
        await showCurrentQuestion(state, helpers);
        return false;
      }
      await helpers.consolidateCommand(state.context, options, helpers.buildHelpers);
      return false;
    case 'clean':
      requireContext(state);
      helpers.cleanCommand(state.context, options);
      return false;
    default:
      console.log(`[entro] 未识别命令：${name}，输入 help 查看可用命令`);
      return false;
  }
}

async function ensureAppSelected(state, io, helpers) {
  const candidates = listAppCandidates(findRepoRoot(DEFAULT_ROOT));
  if (candidates.length) {
    console.log('[entro] 先选择一个应用，后续 run / build 都会基于这个应用执行');
    console.log('[entro] 可选应用示例：');
    candidates.slice(0, 12).forEach(item => {
      console.log(`  - ${item}`);
    });
  }

  while (!state.context) {
    const answer = String(await io.ask('请输入应用路径（例如 apps/goods/ffa-goods）：')).trim();
    if (!answer) {
      continue;
    }
    await switchAppContext(state, answer, io, helpers);
  }
}

async function switchAppContext(state, appInput, io, helpers) {
  if (!appInput) {
    console.log('[entro] 请提供应用路径，例如 use apps/goods/ffa-goods');
    return;
  }

  const nextContext = createContext(appInput);
  state.context = nextContext;
  state.appInput = appInput;
  state.questionMode = false;
  await maybeInitContext(state, helpers);
  printSessionHeader(nextContext, { switched: true });
  await maybeEnterQuestionMode(state, helpers);
}

async function maybeInitContext(state, helpers) {
  helpers.ensureInitializedOrInit(state.context, () => {
    helpers.migrateLegacyFiles(state.context);
    return null;
  });
}

async function handleSeedCommand(state, args, io, helpers) {
  const action = args[0] || 'list';
  if (action === 'list') {
    printSeedSummary(state.context, helpers);
    return;
  }

  if (action === 'add') {
    const modeRaw = String(await io.ask('写入 required 还是 optional？(required/optional，默认 optional)：')).trim();
    const mode = modeRaw === 'required' ? 'required' : 'optional';
    const lines = [];
    console.log('[entro] 请输入业务定制种子内容，直接回车结束：');
    while (true) {
      const line = String(await io.ask(lines.length === 0 ? '> ' : '... ')).trimEnd();
      if (!line.trim()) {
        break;
      }
      lines.push(line);
    }

    if (!lines.length) {
      console.log('[entro] 未录入任何内容，已取消');
      return;
    }

    appendBusinessSeed(state.context, mode, lines.join('\n'), helpers);
    console.log(`[entro] 已追加 1 条 ${mode} 业务种子`);
    printSeedSummary(state.context, helpers);
    return;
  }

  console.log('[entro] 支持的 seed 命令：seed list / seed add');
}

async function handleQuestionCommand(state, args, io, helpers) {
  const action = args[0] || 'next';
  if (action === 'list') {
    printOpenQuestions(state.context, helpers);
    return;
  }
  if (action === 'next') {
    await maybeEnterQuestionMode(state, helpers, { forceShow: true });
    return;
  }
  console.log('[entro] 支持的 question 命令：question list / question next');
}

async function maybePromptCustomSeeds(state, io, helpers) {
  const config = helpers.readJson(path.join(state.context.paths.config, 'seeds.json')) || {
    required: [],
    optional: [],
  };
  const totalBusinessSeeds =
    normalizeArray(config.required).length +
    normalizeArray(config.optional).length;

  if (totalBusinessSeeds > 0) {
    return;
  }

  const answer = String(
    await io.ask('[entro] 当前还没有业务定制种子，是否先补充一条？(y/N)：')
  ).trim();
  if (!isYes(answer)) {
    return;
  }

  await handleSeedCommand(state, ['add'], io, helpers);
}

function appendBusinessSeed(context, mode, rawText, helpers) {
  helpers.ensureSeedsConfig(context);
  const targetPath = path.join(context.paths.config, 'seeds.json');
  const config = helpers.readJson(targetPath) || { required: [], optional: [] };
  const nextMode = mode === 'required' ? 'required' : 'optional';
  const current = normalizeArray(config[nextMode]);
  if (!current.includes(rawText)) {
    config[nextMode] = current.concat(rawText);
  }
  if (!Array.isArray(config.required)) {
    config.required = normalizeArray(config.required);
  }
  if (!Array.isArray(config.optional)) {
    config.optional = normalizeArray(config.optional);
  }
  helpers.writeJson(targetPath, config);
}

function printSeedSummary(context, helpers) {
  helpers.ensureSeedsConfig(context);
  const mergedSeeds = helpers.loadSeedRegistry(context);
  const activePayload = helpers.activateSeeds(context, mergedSeeds);
  const config = helpers.readJson(path.join(context.paths.config, 'seeds.json')) || {
    required: [],
    optional: [],
  };

  console.log('[entro] seeds');
  console.log(`  business required: ${normalizeArray(config.required).length}`);
  console.log(`  business optional: ${normalizeArray(config.optional).length}`);
  console.log(`  merged total: ${mergedSeeds.length}`);
  console.log(`  active total: ${activePayload.activeSeeds.length}`);
  console.log(`  config: ${path.join(context.paths.config, 'seeds.json')}`);
}

function printOpenQuestions(context, helpers) {
  const questions = loadOpenQuestions(context, helpers);
  if (!questions.length) {
    console.log('[entro] 当前没有待确认问题');
    return;
  }

  questions.forEach((question, index) => {
    console.log(`${index + 1}. ${question.meta.id} ${question.body.title}`);
  });
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

function countOpenQuestions(context, helpers) {
  return loadOpenQuestions(context, helpers).length;
}

function printQuestionDetail(question) {
  console.log(`> ${question.body.title}`);
  console.log(`${question.body.prompt}`);
  if (question.body.background) {
    console.log(`背景：${question.body.background}`);
  }
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    console.log('可直接回复选项编号、option id，或补一句解释。');
    normalizeArray(question.body.expectedAnswer.options).forEach((option, index) => {
      console.log(`  ${index + 1}. [${option.id}] ${option.label}${option.description ? ` - ${option.description}` : ''}`);
    });
  } else {
    const expectedFields = normalizeArray(question.body.expectedAnswer && question.body.expectedAnswer.fields);
    if (expectedFields.length) {
      console.log(`建议覆盖：${expectedFields.join('，')}`);
    }
    console.log('可直接回复补充上下文；不确定可输入 skip / 跳过。');
  }
  console.log('');
}

function printChatBanner(state, helpers) {
  console.log('entro');
  console.log('Type /help for commands. 推荐：/run -> 直接回复问题 -> /build');
  if (state.context) {
    printSessionHeader(state.context);
  }
}

function printChatHelp() {
  console.log([
    'Slash commands:',
    '  /use <app-path>     切换当前应用',
    '  /apps               列出仓库内应用候选',
    '  /status             查看当前应用状态',
    '  /seed list          查看种子概况',
    '  /seed add           追加一条业务定制种子',
    '  /run                执行完整自动提取',
    '  /extract            只做提取',
    '  /question list      查看待确认问题',
    '  /question next      显示当前待确认问题',
    '  /build              生成最终 AGENTS.md 和 skills',
    '  /paths              查看 config / output / runtime 路径',
    '  /clean [--all]      清理运行时目录；加 --all 时同时清理 output',
    '  /help               查看帮助',
    '  /exit               退出会话',
    '',
    'Question mode:',
    '  直接输入 1 / option id / 一段补充描述，即作为当前问题的回答',
    '  输入 skip 或 跳过，暂时跳过当前问题',
  ].join('\n'));
}

function printStatusSummary(context) {
  const openQuestions = countOpenQuestions(context, helpers);
  const outputAgents = path.join(context.outputRoot, 'AGENTS.md');
  const skillRoot = path.join(context.outputRoot, 'skills');
  const skillCount = fs.existsSync(skillRoot)
    ? fs.readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
    : 0;

  console.log('[entro] status');
  console.log(`  app: ${path.relative(context.repoRoot, context.appRoot)}`);
  console.log(`  open questions: ${openQuestions}`);
  console.log(`  generated AGENTS: ${fs.existsSync(outputAgents) ? 'yes' : 'no'}`);
  console.log(`  generated skills: ${skillCount}`);
}

function printSessionHeader(context, options = {}) {
  const openQuestions = countOpenQuestions(context, helpers);
  const skillRoot = path.join(context.outputRoot, 'skills');
  const skillCount = fs.existsSync(skillRoot)
    ? fs.readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
    : 0;
  const agentsReady = fs.existsSync(path.join(context.outputRoot, 'AGENTS.md')) ? 'yes' : 'no';
  const prefix = options.switched ? '[entro] switched' : '[entro] session';

  console.log(`${prefix}  app=${path.relative(context.repoRoot, context.appRoot)}  open_questions=${openQuestions}  agents=${agentsReady}  skills=${skillCount}`);
}

function printAppCandidates(state, helpers) {
  const repoRoot = state.context ? state.context.repoRoot : findRepoRoot(DEFAULT_ROOT);
  const candidates = listAppCandidates(repoRoot);
  if (!candidates.length) {
    console.log('[entro] 未识别到应用候选，请直接使用 use <app-path>');
    return;
  }
  console.log('[entro] apps');
  candidates.forEach(item => {
    console.log(`  - ${item}`);
  });
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

function requireContext(state) {
  if (!state.context) {
    throw new Error('当前还没有选定应用，请先使用 use <app-path>');
  }
}

function parseChatInput(input) {
  const normalizedInput = isSlashCommand(input) ? input.slice(1) : input;
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
      continue;
    }
    args.push(token);
  }

  return {
    raw: input,
    name,
    args,
    options,
  };
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

function isYes(value) {
  return ['y', 'yes', '1'].includes(String(value || '').trim().toLowerCase());
}

function isSlashCommand(input) {
  return String(input || '').trim().startsWith('/');
}

function buildPromptLabel(state) {
  if (!state.context) {
    return 'entro';
  }
  return state.questionMode ? '›' : `entro:${path.basename(state.context.appRoot)}`;
}

async function maybeEnterQuestionMode(state, helpers, config = {}) {
  const questions = loadOpenQuestions(state.context, helpers);
  if (!questions.length) {
    state.questionMode = false;
    return;
  }

  state.questionMode = true;
  if (config.forceShow !== false) {
    await showCurrentQuestion(state, helpers);
  }
}

async function showCurrentQuestion(state, helpers) {
  const questions = loadOpenQuestions(state.context, helpers);
  if (!questions.length) {
    state.questionMode = false;
    console.log('[entro] 当前没有待确认问题，可以直接 /build');
    return;
  }

  state.questionMode = true;
  const question = questions[0];
  console.log(`[entro] question 1/${questions.length}`);
  printQuestionDetail(question);
}

async function handleQuestionReply(state, input, helpers) {
  requireContext(state);
  const questions = loadOpenQuestions(state.context, helpers);
  if (!questions.length) {
    state.questionMode = false;
    console.log('[entro] 当前没有待确认问题，可以直接 /build');
    return false;
  }

  const question = questions[0];
  const normalized = String(input || '').trim();
  const answerText = normalizeReplyForQuestion(question, normalized);
  await helpers.answerCommand(state.context, {
    question: question.meta.id,
    text: answerText,
  }, helpers.answerHelpers);

  helpers.reconcileCommand(state.context, {
    question: question.meta.id,
  }, helpers.reconcileHelpers);

  const remaining = countOpenQuestions(state.context, helpers);
  if (!remaining) {
    state.questionMode = false;
    console.log('[entro] 所有待确认问题已处理完成，可以直接 /build');
    return false;
  }

  await showCurrentQuestion(state, helpers);
  return false;
}

function normalizeReplyForQuestion(question, input) {
  if (!(question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice')) {
    return input;
  }

  if (isSkipReply(input)) {
    return String(input || '').trim();
  }

  const options = normalizeArray(question.body.expectedAnswer.options);
  const tokens = String(input || '').trim().split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || '';
  const byId = options.find(option => option.id === firstToken);
  const byIndexNumber = Number(firstToken);

  if (byId) {
    const comment = tokens.slice(1).join(' ').trim();
    return comment ? `${byId.id}\ncomment: ${comment}` : byId.id;
  }

  if (!Number.isNaN(byIndexNumber) && byIndexNumber >= 1 && byIndexNumber <= options.length) {
    const selected = options[byIndexNumber - 1].id;
    const comment = tokens.slice(1).join(' ').trim();
    return comment ? `${selected}\ncomment: ${comment}` : selected;
  }

  return input;
}

function isSkipReply(input) {
  const normalized = String(input || '').trim().toLowerCase();
  return ['skip', '跳过', '先跳过', 'pass', '不确定', '不知道', '暂不确定', 'uncertain', 'not sure'].includes(normalized);
}

function createChatIo() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask(prompt) {
      return new Promise(resolve => {
        rl.question(prompt, answer => resolve(answer));
      });
    },
    close() {
      rl.close();
    },
  };
}

export {
  chatCommand,
};
