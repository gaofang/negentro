import fs from 'fs';
import path from 'path';

export function writeJsonIfAbsent(filePath, value) {
  if (fs.existsSync(filePath)) {
    return;
  }
  writeJson(filePath, value);
}

export function writeTextIfAbsent(filePath, value) {
  if (fs.existsSync(filePath)) {
    return;
  }
  writeText(filePath, value);
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value.endsWith('\n') ? value : `${value}\n`);
}

export function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

export function safeUnlink(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
