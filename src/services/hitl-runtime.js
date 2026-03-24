import readline from 'readline';
import { normalizeArray } from '../shared/collections.js';

async function promptForAnswer(question) {
  console.log(`正在回答问题 ${question.meta.id}`);
  console.log(`提问：${question.body.prompt}`);
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    normalizeArray(question.body.expectedAnswer.options).forEach((option, index) => {
      console.log(`${index + 1}. [${option.id}] ${option.label}`);
      if (option.description) {
        console.log(`   ${option.description}`);
      }
    });
  } else {
    console.log(`期望字段：${(question.body.expectedAnswer && question.body.expectedAnswer.fields.join(', ')) || '自由回答'}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    const selected = await new Promise(resolve => {
      rl.question('请输入选项编号或 option id：', value => {
        resolve(value);
      });
    });
    const comment = await new Promise(resolve => {
      rl.question('可选补充备注（可留空）：', value => {
        rl.close();
        resolve(value);
      });
    });
    return {
      selected: String(selected || '').trim(),
      comment: String(comment || '').trim(),
      rawText: String(selected || '').trim() + (comment ? `\ncomment: ${comment}` : ''),
    };
  }

  const answer = await new Promise(resolve => {
    rl.question('请输入回答：', value => {
      rl.close();
      resolve(value);
    });
  });

  return {
    rawText: answer,
  };
}

function getLastAnswerRef(question) {
  const refs = normalizeArray(question.body.answerRefs);
  return refs.length ? refs[refs.length - 1] : null;
}

function normalizeAnswer(question, answer) {
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    return normalizeSingleChoiceAnswer(question, answer);
  }

  const expectedFields = (question.body.expectedAnswer && normalizeArray(question.body.expectedAnswer.fields)) || [];
  const rawText = (answer.body.rawText || '').trim();
  const lower = rawText.toLowerCase();
  const extracted = {};

  expectedFields.forEach(field => {
    const regex = new RegExp(`${field}\\s*[:=]\\s*(.+)`, 'i');
    const match = rawText.match(regex);
    if (match) {
      extracted[field] = match[1].trim();
    }
  });

  const missingFields = expectedFields.filter(field => !extracted[field]);
  const sufficient =
    rawText.length > 0 &&
    (missingFields.length === 0 ||
      (expectedFields.length === 0 && rawText.length > 20) ||
      (expectedFields.length > 0 && lower.includes('scope') && lower.includes('path')));

  return {
    schemaVersion: 2,
    meta: {
      id: answer.meta.id,
      questionId: question.meta.id,
      normalizedAt: new Date().toISOString(),
    },
    body: {
      rawText,
      extracted,
    },
    judgement: {
      sufficient,
      missingFields: sufficient ? [] : missingFields,
    },
  };
}

function normalizeSingleChoiceAnswer(question, answer) {
  const options = normalizeArray(question.body.expectedAnswer && question.body.expectedAnswer.options);
  const selectedRaw = String(answer.body.selected || answer.body.rawText || '').trim();
  const normalizedSelected = normalizeSingleChoiceValue(selectedRaw, options);
  const matchedOption = options.find(option => option.id === normalizedSelected) || null;

  return {
    schemaVersion: 2,
    meta: {
      id: answer.meta.id,
      questionId: question.meta.id,
      normalizedAt: new Date().toISOString(),
    },
    body: {
      rawText: answer.body.rawText || selectedRaw,
      selectedOptionId: normalizedSelected || null,
      selectedOptionLabel: matchedOption ? matchedOption.label : null,
      comment: String(answer.body.comment || '').trim(),
      extracted: {
        selected_option_id: normalizedSelected || '',
        selected_option_label: matchedOption ? matchedOption.label : '',
        comment: String(answer.body.comment || '').trim(),
      },
    },
    judgement: {
      sufficient: Boolean(matchedOption),
      missingFields: matchedOption ? [] : ['selected_option_id'],
    },
  };
}

function normalizeSingleChoiceValue(rawValue, options) {
  if (!rawValue) {
    return '';
  }

  const trimmed = String(rawValue).trim();
  const byId = options.find(option => option.id === trimmed);
  if (byId) {
    return byId.id;
  }

  const byIndex = Number(trimmed);
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= options.length) {
    return options[byIndex - 1].id;
  }

  return '';
}

function buildAnswerPayloadFromText(question, text) {
  const raw = String(text || '').trim();
  if (question.body.expectedAnswer && question.body.expectedAnswer.mode === 'single_choice') {
    return {
      selected: raw,
      comment: '',
      rawText: raw,
    };
  }

  return {
    rawText: raw,
  };
}

export {
  promptForAnswer,
  getLastAnswerRef,
  normalizeAnswer,
  buildAnswerPayloadFromText,
};
