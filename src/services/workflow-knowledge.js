import path from 'path';

import { ensureDir, readJson, writeJson } from '../shared/fs.js';

const KNOWLEDGE_REVIEW_STATES = ['pending', 'kept', 'discarded', 'promoted'];
const KNOWLEDGE_CARD_TYPES = ['experience', 'correction'];

function createWorkflowKnowledgeService(context, overrides = {}) {
  const io = {
    ensureDir: overrides.ensureDir || ensureDir,
    readJson: overrides.readJson || readJson,
    writeJson: overrides.writeJson || writeJson,
  };

  const root = context.paths.publicationState;
  const cardsDir = path.join(root, 'knowledge-cards');
  const bridgePath = path.join(root, 'publication-knowledge-bridge.json');

  function ensureStorage() {
    io.ensureDir(root);
    io.ensureDir(cardsDir);
  }

  function listCards(filters = {}) {
    ensureStorage();
    const index = loadIndex(io.readJson, root);
    return sortCards(
      index.cards.filter(card => matchesFilter(card, filters)),
    );
  }

  function captureCard(input = {}) {
    ensureStorage();
    const now = new Date().toISOString();
    const cardType = normalizeCardType(input.type);
    const category = normalizeCategory(input.category);
    const reviewerState = normalizeReviewState(input.reviewState || 'pending');
    const summary = normalizeText(input.summary || input.title || input.decision || input.description);
    if (!summary) {
      throw new Error('knowledge capture requires `summary`');
    }

    const card = {
      schemaVersion: 1,
      id: normalizeCardId(input.id || createKnowledgeCardId(cardType, now, summary)),
      type: cardType,
      category,
      title: normalizeText(input.title || summary),
      summary,
      details: normalizeText(input.details || input.description),
      source: normalizeSource(input.source),
      references: normalizeStringArray(input.references || input.evidenceRefs),
      tags: normalizeStringArray(input.tags),
      reviewState: reviewerState,
      review: normalizeReview(input.review, reviewerState),
      promotionTarget: normalizePromotionTarget(input.promotionTarget),
      bridge: normalizeBridge(input.bridge),
      createdAt: input.createdAt || now,
      updatedAt: now,
    };

    persistCard(io.writeJson, cardsDir, card);
    writeIndex(io.writeJson, root, upsertCard(loadIndex(io.readJson, root), card));
    return card;
  }

  function reviewCard(cardId, decision, options = {}) {
    ensureStorage();
    const normalizedDecision = normalizeDecision(decision);
    const card = requireCard(io.readJson, cardsDir, root, cardId);
    const now = new Date().toISOString();
    const nextState = decisionToReviewState(normalizedDecision);

    card.reviewState = nextState;
    card.review = {
      decision: normalizedDecision,
      note: normalizeText(options.note),
      reviewer: normalizeText(options.reviewer || options.by || process.env.USER || 'workflow-reviewer'),
      reviewedAt: now,
    };
    card.updatedAt = now;

    if (normalizedDecision === 'promote') {
      const promoted = promoteCard(card, options, io, bridgePath, root, cardsDir);
      return promoted;
    }

    persistCard(io.writeJson, cardsDir, card);
    writeIndex(io.writeJson, root, upsertCard(loadIndex(io.readJson, root), card));
    return {
      card,
      bridgeEntry: null,
    };
  }

  function promoteCardById(cardId, options = {}) {
    ensureStorage();
    const card = requireCard(io.readJson, cardsDir, root, cardId);
    const reviewer = options.reviewer || options.by || process.env.USER || 'workflow-reviewer';
    return promoteCard(
      {
        ...card,
        reviewState: 'promoted',
        review: {
          decision: 'promote',
          note: normalizeText(options.note),
          reviewer: normalizeText(reviewer),
          reviewedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
      options,
      io,
      bridgePath,
      root,
      cardsDir,
    );
  }

  function getBridge() {
    ensureStorage();
    return loadBridge(io.readJson, bridgePath);
  }

  return {
    cardsDir,
    bridgePath,
    captureCard,
    listCards,
    reviewCard,
    promoteCard: promoteCardById,
    getBridge,
  };
}

function createKnowledgeCardId(type, timestamp, summary) {
  const datePart = String(timestamp || '').replace(/[^0-9]/g, '').slice(0, 14) || Date.now().toString();
  const summaryPart = slugify(summary).slice(0, 48) || 'item';
  return `knowledge-${type}-${datePart}-${summaryPart}`;
}

function normalizeCardType(value) {
  const normalized = String(value || 'experience').trim().toLowerCase();
  if (!KNOWLEDGE_CARD_TYPES.includes(normalized)) {
    throw new Error(`unsupported knowledge card type: ${value}`);
  }
  return normalized;
}

function normalizeCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'general';
}

function normalizeReviewState(value) {
  const normalized = String(value || 'pending').trim().toLowerCase();
  if (!KNOWLEDGE_REVIEW_STATES.includes(normalized)) {
    throw new Error(`unsupported knowledge review state: ${value}`);
  }
  return normalized;
}

function normalizeDecision(value) {
  const normalized = String(value || 'keep').trim().toLowerCase();
  if (!['keep', 'discard', 'promote'].includes(normalized)) {
    throw new Error(`unsupported review decision: ${value}`);
  }
  return normalized;
}

function decisionToReviewState(decision) {
  switch (decision) {
    case 'keep':
      return 'kept';
    case 'discard':
      return 'discarded';
    case 'promote':
      return 'promoted';
    default:
      return 'pending';
  }
}

function normalizeSource(source) {
  if (!source) {
    return {
      kind: 'manual',
      value: '',
    };
  }
  if (typeof source === 'string') {
    return {
      kind: 'manual',
      value: normalizeText(source),
    };
  }
  return {
    kind: normalizeText(source.kind) || 'manual',
    value: normalizeText(source.value || source.path || source.id),
  };
}

function normalizeReview(review, reviewState) {
  if (!review && reviewState === 'pending') {
    return null;
  }
  if (!review) {
    return {
      decision: reviewState,
      note: '',
      reviewer: '',
      reviewedAt: '',
    };
  }
  return {
    decision: normalizeText(review.decision),
    note: normalizeText(review.note),
    reviewer: normalizeText(review.reviewer),
    reviewedAt: review.reviewedAt || '',
  };
}

function normalizePromotionTarget(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'reference';
  }
  if (!['reference', 'skills', 'agents'].includes(normalized)) {
    throw new Error(`unsupported promotion target: ${value}`);
  }
  return normalized;
}

function normalizeBridge(bridge) {
  const source = bridge || {};
  return {
    title: normalizeText(source.title),
    summary: normalizeText(source.summary),
    body: normalizeText(source.body),
    skillId: normalizeText(source.skillId || source.slug),
    sectionHeading: normalizeText(source.sectionHeading),
    references: normalizeStringArray(source.references),
  };
}

function promoteCard(card, options, io, bridgePath, root, cardsDir) {
  const normalizedCard = {
    ...card,
    promotionTarget: normalizePromotionTarget(options.target || options.promotionTarget || card.promotionTarget),
    bridge: {
      ...card.bridge,
      ...normalizeBridge(options.bridge),
    },
  };

  persistCard(io.writeJson, cardsDir, normalizedCard);
  writeIndex(io.writeJson, root, upsertCard(loadIndex(io.readJson, root), normalizedCard));

  const bridge = loadBridge(io.readJson, bridgePath);
  const entry = buildBridgeEntry(normalizedCard);
  bridge.entries = upsertBridgeEntry(bridge.entries, entry);
  bridge.updatedAt = new Date().toISOString();
  io.writeJson(bridgePath, bridge);

  return {
    card: normalizedCard,
    bridgeEntry: entry,
  };
}

function buildBridgeEntry(card) {
  const target = card.promotionTarget;
  const title = card.bridge.title || card.title || card.summary;
  const summary = card.bridge.summary || card.summary;
  const body = card.bridge.body || card.details || card.summary;
  const references = uniqueStrings(card.bridge.references.concat(card.references));

  return {
    schemaVersion: 1,
    cardId: card.id,
    type: card.type,
    target,
    title,
    summary,
    body,
    references,
    output: buildBridgeOutput(target, card, { title, summary, body, references }),
    promotedAt: new Date().toISOString(),
  };
}

function buildBridgeOutput(target, card, payload) {
  if (target === 'skills') {
    const skillId = card.bridge.skillId || slugify(payload.title || card.id) || card.id;
    return {
      kind: 'skill_stub',
      skill: {
        id: skillId,
        title: payload.title,
        summary: payload.summary,
        applicability: '',
        defaultRule: payload.body,
        dos: [],
        donts: [],
        snippet: '',
        preflight: [],
        steps: [],
        pitfalls: [],
        validation: [],
        boundaries: '',
        evidenceRefs: payload.references,
        sourceCardIds: [card.id],
        sourceSeedIds: [],
      },
    };
  }

  if (target === 'agents') {
    return {
      kind: 'agents_section_stub',
      section: {
        heading: card.bridge.sectionHeading || payload.title,
        body: payload.body,
        evidenceRefs: payload.references,
        sourceCardIds: [card.id],
      },
    };
  }

  return {
    kind: 'reference_entry_stub',
    reference: {
      title: payload.title,
      summary: payload.summary,
      body: payload.body,
      evidenceRefs: payload.references,
      sourceCardIds: [card.id],
    },
  };
}

function loadIndex(readJsonImpl, root) {
  return (
    readJsonImpl(path.join(root, 'knowledge-index.json')) || {
      schemaVersion: 1,
      updatedAt: '',
      cards: [],
    }
  );
}

function writeIndex(writeJsonImpl, root, index) {
  writeJsonImpl(path.join(root, 'knowledge-index.json'), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    cards: sortCards(index.cards),
  });
}

function loadBridge(readJsonImpl, bridgePath) {
  return (
    readJsonImpl(bridgePath) || {
      schemaVersion: 1,
      updatedAt: '',
      entries: [],
    }
  );
}

function persistCard(writeJsonImpl, cardsDir, card) {
  writeJsonImpl(path.join(cardsDir, `${card.id}.json`), card);
}

function requireCard(readJsonImpl, cardsDir, root, cardId) {
  const card = readJsonImpl(path.join(cardsDir, `${cardId}.json`));
  if (!card) {
    const indexCard = loadIndex(readJsonImpl, root).cards.find(item => item.id === cardId);
    if (indexCard) {
      return indexCard;
    }
    throw new Error(`knowledge card not found: ${cardId}`);
  }
  return card;
}

function upsertCard(index, card) {
  const cards = index.cards.filter(item => item.id !== card.id).concat(card);
  return {
    ...index,
    cards,
  };
}

function upsertBridgeEntry(entries, entry) {
  return entries.filter(item => item.cardId !== entry.cardId).concat(entry).sort((a, b) => a.cardId.localeCompare(b.cardId));
}

function matchesFilter(card, filters) {
  if (filters.type && normalizeCardType(filters.type) !== card.type) {
    return false;
  }
  if (filters.reviewState && normalizeReviewState(filters.reviewState) !== card.reviewState) {
    return false;
  }
  return true;
}

function sortCards(cards) {
  return cards.slice().sort((left, right) => {
    const byUpdated = String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    if (byUpdated !== 0) {
      return byUpdated;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizeStringArray(value) {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return uniqueStrings(input.map(item => normalizeText(item)).filter(Boolean));
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCardId(value) {
  const normalized = slugify(value);
  if (!normalized) {
    throw new Error('knowledge card id must not be empty');
  }
  return normalized;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export {
  KNOWLEDGE_CARD_TYPES,
  KNOWLEDGE_REVIEW_STATES,
  createWorkflowKnowledgeService,
  createKnowledgeCardId,
};
