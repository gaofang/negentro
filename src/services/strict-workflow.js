import fs from 'fs';
import path from 'path';

const STRICT_WORKFLOW_ID = 'strict-workflow';
const STRICT_WORKFLOW_VERSION = 1;
const DEFAULT_WORKFLOW_FILE = 'strict-workflow-state.json';

const STRICT_WORKFLOW_STAGES = [
  {
    id: 'stage_1_intake',
    index: 1,
    slug: 'intake',
    name: 'Intake',
    description: 'Capture the requested outcome, boundaries, and operating constraints.',
    statusLabel: 'Define the work to be done.',
    allowedNextStageIds: ['stage_2_plan'],
    reserved: false,
  },
  {
    id: 'stage_2_plan',
    index: 2,
    slug: 'plan',
    name: 'Plan',
    description: 'Establish the implementation plan and decision checkpoints before execution.',
    statusLabel: 'Confirm the execution plan.',
    allowedNextStageIds: ['stage_3_prepare'],
    reserved: false,
  },
  {
    id: 'stage_3_prepare',
    index: 3,
    slug: 'prepare',
    name: 'Prepare',
    description: 'Prepare context, dependencies, and verification approach before making changes.',
    statusLabel: 'Prepare the environment and checks.',
    allowedNextStageIds: ['stage_4_execute'],
    reserved: false,
  },
  {
    id: 'stage_4_execute',
    index: 4,
    slug: 'execute',
    name: 'Execute',
    description: 'Implement the planned changes while preserving the agreed scope.',
    statusLabel: 'Carry out the planned implementation.',
    allowedNextStageIds: ['stage_5_verify'],
    reserved: false,
  },
  {
    id: 'stage_5_verify',
    index: 5,
    slug: 'verify',
    name: 'Verify',
    description: 'Check outcomes, run focused validation, and note any remaining concerns.',
    statusLabel: 'Validate the resulting state.',
    allowedNextStageIds: ['stage_6_capture'],
    reserved: false,
  },
  {
    id: 'stage_6_capture',
    index: 6,
    slug: 'capture',
    name: 'Capture',
    description: 'Reserve a structured surface for follow-up notes and knowledge capture.',
    statusLabel: 'Capture follow-up knowledge if needed.',
    allowedNextStageIds: [],
    reserved: true,
  },
];

const STAGE_LOOKUP = new Map(STRICT_WORKFLOW_STAGES.map(stage => [stage.id, stage]));

function createStrictWorkflowRuntime(context, helpers = {}) {
  const readJson = helpers.readJson || defaultReadJson;
  const writeJson = helpers.writeJson || defaultWriteJson;
  const ensureDir = helpers.ensureDir || defaultEnsureDir;
  const promptArtifactPath = helpers.promptArtifactPath || path.join(context.repoRoot, 'prompts', 'workflow_main.md');

  function getStateFilePath(options = {}) {
    const fileName = String(options.stateFile || DEFAULT_WORKFLOW_FILE).trim() || DEFAULT_WORKFLOW_FILE;
    return path.join(context.paths.runtime, 'workflow', fileName);
  }

  function loadState(options = {}) {
    const statePath = getStateFilePath(options);
    const existing = readJson(statePath);
    if (existing && existing.workflowId === STRICT_WORKFLOW_ID) {
      return {
        state: normalizeState(existing, statePath, promptArtifactPath),
        statePath,
        isNew: false,
      };
    }

    return {
      state: createInitialState(statePath, promptArtifactPath),
      statePath,
      isNew: true,
    };
  }

  function saveState(state, options = {}) {
    const statePath = getStateFilePath(options);
    ensureDir(path.dirname(statePath));
    writeJson(statePath, state);
    return statePath;
  }

  function run(options = {}) {
    const { state, statePath } = loadState(options);
    const startedAt = state.startedAt || new Date().toISOString();
    const hydrated = {
      ...state,
      statePath,
      startedAt,
      updatedAt: new Date().toISOString(),
      promptArtifact: promptArtifactPath,
      currentStopPoint: resolveStopPoint(state.currentStopPoint, state.history, options),
    };

    const currentStage = getStageById(hydrated.currentStageId);
    if (hydrated.history.length === 0) {
      hydrated.history = [createHistoryEntry(currentStage.id, 'entered')];
    }

    saveState(hydrated, options);

    return buildResult('run', hydrated, {
      created: !state.startedAt,
      message: `Workflow is ready at Stage ${currentStage.index}: ${currentStage.name}.`,
      nextAction: buildNextAction(currentStage),
    });
  }

  function next(options = {}) {
    const { state } = loadState(options);
    const currentStage = getStageById(state.currentStageId);
    const nextStageId = currentStage.allowedNextStageIds[0] || null;

    if (!nextStageId) {
      const finalState = {
        ...state,
        updatedAt: new Date().toISOString(),
        completedAt: state.completedAt || new Date().toISOString(),
      };
      saveState(finalState, options);
      return buildResult('next', finalState, {
        created: false,
        advanced: false,
        message: 'Workflow is already at the final reserved stage.',
        nextAction: null,
      });
    }

    const nextStage = getStageById(nextStageId);
    const advancedState = {
      ...state,
      currentStageId: nextStage.id,
      currentStopPoint: null,
      updatedAt: new Date().toISOString(),
      completedAt: nextStage.index === STRICT_WORKFLOW_STAGES.length ? new Date().toISOString() : null,
      history: [...state.history, createHistoryEntry(nextStage.id, 'advanced')],
    };

    saveState(advancedState, options);

    return buildResult('next', advancedState, {
      created: false,
      advanced: true,
      message: `Advanced to Stage ${nextStage.index}: ${nextStage.name}.`,
      nextAction: buildNextAction(nextStage),
    });
  }

  function status(options = {}) {
    const statePath = getStateFilePath(options);
    const existing = readJson(statePath);

    if (!existing || existing.workflowId !== STRICT_WORKFLOW_ID) {
      return {
        command: 'workflow',
        subcommand: 'status',
        status: 'not_started',
        workflow: null,
        created: false,
        advanced: false,
        message: 'Workflow has not started yet. Run `entro workflow run` first.',
        nextAction: {
          type: 'start',
          description: 'Use `entro workflow run` to create the strict workflow state.',
        },
      };
    }

    const state = normalizeState(existing, statePath, promptArtifactPath);

    if (options.stopPointId && state.currentStopPoint?.id === options.stopPointId) {
      const updatedState = {
        ...state,
        currentStopPoint: null,
        updatedAt: new Date().toISOString(),
        history: [
          ...state.history,
          createHistoryEntry(state.currentStageId, 'stop-acknowledged', {
            stopPointId: options.stopPointId,
          }),
        ],
      };
      saveState(updatedState, options);
      return buildResult('ack-stop', updatedState, {
        created: false,
        message: `Acknowledged stop point ${options.stopPointId}.`,
        nextAction: buildNextAction(getStageById(updatedState.currentStageId)),
      });
    }

    return buildResult('status', state, {
      created: false,
      message: `Workflow is currently at Stage ${getStageById(state.currentStageId).index}.`,
      nextAction: buildNextAction(getStageById(state.currentStageId)),
    });
  }

  return {
    run,
    next,
    status,
    loadState,
    saveState,
  };
}

function createInitialState(statePath, promptArtifactPath) {
  const now = new Date().toISOString();
  const firstStage = STRICT_WORKFLOW_STAGES[0];
  return {
    workflowId: STRICT_WORKFLOW_ID,
    schemaVersion: STRICT_WORKFLOW_VERSION,
    statePath,
    promptArtifact: promptArtifactPath,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    currentStageId: firstStage.id,
    currentStopPoint: null,
    history: [],
  };
}

function normalizeState(state, statePath, promptArtifactPath) {
  const normalizedHistory = Array.isArray(state.history) ? state.history.filter(Boolean) : [];
  return {
    workflowId: STRICT_WORKFLOW_ID,
    schemaVersion: STRICT_WORKFLOW_VERSION,
    statePath,
    promptArtifact: state.promptArtifact || promptArtifactPath,
    startedAt: state.startedAt || new Date().toISOString(),
    updatedAt: state.updatedAt || state.startedAt || new Date().toISOString(),
    completedAt: state.completedAt || null,
    currentStageId: STAGE_LOOKUP.has(state.currentStageId)
      ? state.currentStageId
      : STRICT_WORKFLOW_STAGES[0].id,
    currentStopPoint: normalizeStopPoint(state.currentStopPoint),
    history: normalizedHistory,
  };
}

function buildResult(action, state, meta = {}) {
  const currentStage = getStageById(state.currentStageId);
  const nextStage = currentStage.allowedNextStageIds.length > 0
    ? getStageById(currentStage.allowedNextStageIds[0])
    : null;

  return {
    command: 'workflow',
    subcommand: action,
    status: 'ok',
    workflow: {
      id: STRICT_WORKFLOW_ID,
      schemaVersion: STRICT_WORKFLOW_VERSION,
      promptArtifact: state.promptArtifact,
      statePath: state.statePath,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
      currentStage,
      nextStage,
      currentStopPoint: state.currentStopPoint,
      stages: STRICT_WORKFLOW_STAGES,
      history: state.history,
    },
    created: Boolean(meta.created),
    advanced: Boolean(meta.advanced),
    message: meta.message,
    nextAction: meta.nextAction || null,
  };
}

function buildNextAction(stage) {
  if (!stage) {
    return null;
  }

  if (stage.allowedNextStageIds.length === 0) {
    return {
      type: 'complete',
      stageId: stage.id,
      description: stage.reserved
        ? 'Stage 6 is reserved for future knowledge capture and review flows.'
        : 'Workflow has no further stages.',
    };
  }

  return {
    type: 'advance',
    stageId: stage.id,
    targetStageId: stage.allowedNextStageIds[0],
    description: `Use workflow next to move from ${stage.name} to ${getStageById(stage.allowedNextStageIds[0]).name}.`,
  };
}

function getStageById(stageId) {
  const stage = STAGE_LOOKUP.get(stageId);
  if (!stage) {
    throw new Error(`unknown strict workflow stage: ${stageId}`);
  }
  return stage;
}

function createHistoryEntry(stageId, transition, extra = {}) {
  return {
    stageId,
    transition,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

function resolveStopPoint(currentStopPoint, history = [], options = {}) {
  if (!options.stopPointId) {
    return normalizeStopPoint(currentStopPoint);
  }

  if (currentStopPoint?.id === options.stopPointId) {
    return normalizeStopPoint(currentStopPoint);
  }

  const alreadyAcknowledged = Array.isArray(history)
    && history.some(entry => entry?.transition === 'stop-acknowledged' && entry?.stopPointId === options.stopPointId);

  if (alreadyAcknowledged) {
    return null;
  }

  return normalizeStopPoint({
    id: options.stopPointId,
    message: options.stopPointMessage,
    status: 'pending',
    repeatable: false,
  });
}

function normalizeStopPoint(stopPoint) {
  if (!stopPoint || !stopPoint.id) {
    return null;
  }

  return {
    id: String(stopPoint.id),
    message: String(stopPoint.message || ''),
    status: String(stopPoint.status || 'pending'),
    repeatable: Boolean(stopPoint.repeatable),
  };
}

function defaultReadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function defaultWriteJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultEnsureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export {
  DEFAULT_WORKFLOW_FILE,
  STRICT_WORKFLOW_ID,
  STRICT_WORKFLOW_STAGES,
  createStrictWorkflowRuntime,
};
