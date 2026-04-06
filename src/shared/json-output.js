function createJsonSuccessPayload({ command, data = null, logs = [] }) {
  return {
    ok: true,
    command,
    data,
    logs,
  };
}

function createJsonErrorPayload({ command, error, logs = [] }) {
  return {
    ok: false,
    command,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack || '' : '',
    },
    logs,
  };
}

function printJsonPayload(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export {
  createJsonErrorPayload,
  createJsonSuccessPayload,
  printJsonPayload,
};
