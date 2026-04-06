#!/usr/bin/env node

import { run } from './index.js';

Promise.resolve(run(process.argv.slice(2))).catch(error => {
  console.error(`[entro] ${error.message}`);
  process.exitCode = 1;
});
