'use strict';
// 本地数据目录与 JSON 存取（原子写入）
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.local', 'share', 'linuxreader');
const BOOKS_DIR = path.join(DATA_DIR, 'books');

function ensureDirs() {
  fs.mkdirSync(BOOKS_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'profile'), { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function bookDir(id) { return path.join(BOOKS_DIR, id); }

function docPath(name) { return path.join(DATA_DIR, name + '.json'); }

module.exports = { DATA_DIR, BOOKS_DIR, ensureDirs, readJson, writeJson, bookDir, docPath };
