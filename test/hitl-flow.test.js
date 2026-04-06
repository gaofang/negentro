import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createContext } from '../src/context.js';
import { createQuestion, removeQuestionFamily } from '../src/domain/artifacts.js';
import { reconcileCommand } from '../src/commands/hitl.js';
import { normalizeAnswer } from '../src/services/hitl-runtime.js';
import { getNextOpenQuestion, summarizeState } from '../src/services/json-state.js';
import { ensureDir, readJson, writeJson } from '../src/shared/fs.js';

function makeTempContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entro-hitl-'));
  const appRoot = path.join(root, 'apps', 'demo');
  fs.mkdirSync(appRoot, { recursive: true });
  process.env.ENTRO_RUNTIME_HOME = path.join(root, '.entro-runtime');
  const context = createContext(appRoot);

  [
    path.join(context.paths.questions, 'open'),
    path.join(context.paths.questions, 'answered'),
    path.join(context.paths.questions, 'closed'),
    path.join(context.paths.questions, 'deferred'),
    path.join(context.paths.answers, 'raw'),
    path.join(context.paths.answers, 'normalized'),
    path.join(context.paths.cards, 'needs-review'),
    path.join(context.paths.runtime, 'hitl'),
  ].forEach(ensureDir);

  fs.mkdirSync(context.entroRoot, { recursive: true });
  return context;
}

function writeQuestion(context, status, question) {
  question.meta.status = status;
  writeJson(path.join(context.paths.questions, status, `${question.meta.id}.json`), question);
}

function createSingleChoiceQuestion(id, followUpFrom = null) {
  const question = createQuestion({
    id,
    title: '是否存在统一的 401 刷新与无感重试实现？',
    level: 'app',
    scopePaths: ['src'],
    owners: ['demo-owner'],
    relatedCardIds: [],
    prompt: '请选择默认路径',
    background: '需要确认统一默认实现',
    expectedAnswer: {
      mode: 'single_choice',
      options: [
        {
          id: 'opt_yes',
          label: '确认已有统一实现',
          description: '请求层已统一处理',
        },
        {
          id: 'opt_no',
          label: '确认当前没有统一实现',
          description: '需要单独设计',
        },
      ],
      allowComment: true,
    },
    rationale: '该规则无法仅靠证据确认',
  });
  question.body.followUpFrom = followUpFrom;
  return question;
}

test('getNextOpenQuestion skips older follow-up when root question is also open', () => {
  const context = makeTempContext();
  const root = createSingleChoiceQuestion('seed_root');
  const followUp = createSingleChoiceQuestion('seed_root_followup_old', 'seed_root');
  followUp.meta.createdAt = new Date(Date.now() - 60_000).toISOString();
  root.meta.createdAt = new Date().toISOString();

  writeQuestion(context, 'open', followUp);
  writeQuestion(context, 'open', root);

  const nextQuestion = getNextOpenQuestion(context, readJson);
  assert.equal(nextQuestion?.meta?.id, 'seed_root');
});

test('removeQuestionFamily clears all same-root open questions', () => {
  const context = makeTempContext();
  const root = createSingleChoiceQuestion('seed_root');
  const followUpA = createSingleChoiceQuestion('seed_root_followup_a', 'seed_root');
  const followUpB = createSingleChoiceQuestion('seed_root_followup_b', 'seed_root_followup_a');
  const other = createSingleChoiceQuestion('seed_other');

  writeQuestion(context, 'open', root);
  writeQuestion(context, 'open', followUpA);
  writeQuestion(context, 'open', followUpB);
  writeQuestion(context, 'open', other);

  const removed = removeQuestionFamily(context.paths.questions, 'seed_root');
  assert.deepEqual(removed.sort(), ['seed_root', 'seed_root_followup_a', 'seed_root_followup_b']);
  assert.equal(fs.existsSync(path.join(context.paths.questions, 'open', 'seed_root.json')), false);
  assert.equal(fs.existsSync(path.join(context.paths.questions, 'open', 'seed_root_followup_a.json')), false);
  assert.equal(fs.existsSync(path.join(context.paths.questions, 'open', 'seed_root_followup_b.json')), false);
  assert.equal(fs.existsSync(path.join(context.paths.questions, 'open', 'seed_other.json')), true);
});

test('reconcile deferred answer does not leave same-root open follow-ups', () => {
  const context = makeTempContext();
  const root = createSingleChoiceQuestion('seed_root');
  const oldFollowUp = createSingleChoiceQuestion('seed_root_followup_old', 'seed_root');

  writeQuestion(context, 'answered', root);
  writeQuestion(context, 'open', oldFollowUp);
  writeJson(path.join(context.paths.answers, 'raw', 'ans_seed_root.json'), {
    schemaVersion: 2,
    meta: {
      id: 'ans_seed_root',
      questionId: 'seed_root',
      source: 'console',
      providedBy: 'tester',
      createdAt: new Date().toISOString(),
    },
    body: {
      selected: '不确定',
      comment: '',
      rawText: '不确定',
    },
  });

  const helpers = {
    ensureInitialized() {},
    migrateLegacyFiles() {},
    findQuestionPath(questionsRoot, questionId) {
      for (const status of ['open', 'answered', 'closed', 'deferred']) {
        const filePath = path.join(questionsRoot, status, `${questionId}.json`);
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
      return null;
    },
    readJson,
    getLastAnswerRef() {
      return 'ans_seed_root';
    },
    normalizeAnswer,
    writeJson,
    promoteRelatedCardsToNeedsReview() {
      return [];
    },
    syncOpenQuestionsReport() {},
    createFollowUpQuestion() {
      throw new Error('should not create follow-up for deferred answer');
    },
    removeRelatedOpenFollowUpQuestions() {
      return [];
    },
    removeQuestionFamily,
  };

  reconcileCommand(context, { question: 'seed_root' }, helpers);

  const state = summarizeState(context, readJson);
  assert.equal(state.questions.open, 0);
  assert.equal(state.questions.deferred, 1);
  assert.equal(state.questions.next, null);
  assert.equal(fs.existsSync(path.join(context.paths.questions, 'open', 'seed_root_followup_old.json')), false);
  assert.equal(fs.existsSync(path.join(context.paths.questions, 'deferred', 'seed_root.json')), true);
});
