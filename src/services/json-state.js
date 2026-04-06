import fs from 'fs';
import path from 'path';
import { dedupeOpenQuestionsByRoot } from '../domain/artifacts.js';

function summarizePaths(context) {
  return {
    app: context.appRoot,
    repo: context.repoRoot,
    config: context.configRoot,
    output: context.outputRoot,
    runtime: context.runtimeRoot,
  };
}

function countQuestions(context, status = 'open') {
  const directory = path.join(context.paths.questions, status);
  if (!fs.existsSync(directory)) {
    return 0;
  }

  return fs.readdirSync(directory).filter(file => file.endsWith('.json')).length;
}

function listQuestionDocuments(context, status, readJson) {
  const directory = path.join(context.paths.questions, status);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const document = readJson(path.join(directory, file));
      return document || null;
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = new Date(left.meta?.createdAt || 0).getTime();
      const rightTime = new Date(right.meta?.createdAt || 0).getTime();
      return leftTime - rightTime;
    });
}

function summarizeQuestion(question) {
  if (!question) {
    return null;
  }

  return {
    id: question.meta?.id,
    status: question.meta?.status,
    title: question.body?.title,
    prompt: question.body?.prompt,
    background: question.body?.background || '',
    relatedCardIds: question.meta?.relatedCardIds || [],
    scopePaths: question.meta?.scopePaths || [],
    options: (question.body?.expectedAnswer?.options || []).map(option => ({
      id: option.id,
      label: option.label,
      description: option.description || '',
    })),
  };
}

function getNextOpenQuestion(context, readJson) {
  const questions = listQuestionDocuments(context, 'open', readJson);
  const deduped = dedupeOpenQuestionsByRoot(questions, context.paths.questions);
  return deduped[0] || null;
}

function summarizeOutputs(context) {
  const agentsPath = path.join(context.outputRoot, 'AGENTS.md');
  const skillsPath = path.join(context.outputRoot, 'skills');
  const consolidatedQuestionsPath = path.join(context.outputRoot, 'questions');

  return {
    agentsPath,
    hasAgents: fs.existsSync(agentsPath),
    skillsPath,
    skillCount: fs.existsSync(skillsPath)
      ? fs.readdirSync(skillsPath, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
      : 0,
    consolidatedQuestionsPath,
    consolidatedQuestionCount: fs.existsSync(consolidatedQuestionsPath)
      ? fs.readdirSync(consolidatedQuestionsPath).filter(file => file.endsWith('.json')).length
      : 0,
  };
}

function summarizeState(context, readJson) {
  return {
    paths: summarizePaths(context),
    questions: {
      open: countQuestions(context, 'open'),
      answered: countQuestions(context, 'answered'),
      closed: countQuestions(context, 'closed'),
      deferred: countQuestions(context, 'deferred'),
      next: summarizeQuestion(getNextOpenQuestion(context, readJson)),
    },
    outputs: summarizeOutputs(context),
  };
}

export {
  countQuestions,
  getNextOpenQuestion,
  listQuestionDocuments,
  summarizeOutputs,
  summarizePaths,
  summarizeQuestion,
  summarizeState,
};
