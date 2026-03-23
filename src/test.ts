import { Codex } from '@openai/codex-sdk';

const codex = new Codex();
const thread = codex.startThread();
console.log('gogogo');
const result = await thread.run('Make a plan to diagnose and fix the CI failures');

console.log(result);
