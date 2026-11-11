'use strict';
/**
 * 书籍与笔记同步：WebDAV（坚果云 / Nextcloud / 群晖 / 通用）或本地目录（网盘挂载盘）。
 * 账号由用户在「同步」页自行填写，凭据只保存在本机 ~/.local/share/linuxreader/sync.json。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const store = require('./store');

const REMOTE_DIR = 'linuxreader';
const SYNCABLE = [
  /^library\.json$/,
  /^settings\.json$/,
  /^books\/[^/]+\/meta\.json$/,
  /^books\/[^/]+\/annotations\.json$/,
  /^books\/[^/]+\/book\.(epub|pdf)$/,
  /^books\/[^/]+\/cover\.(jpg|jpeg|png|gif|webp|svg)$/
];

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const xmlUnescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');

function isSyncable(rel) {
  rel = rel.replace(/\\/g, '/');
  return SYNCABLE.some((re) => re.test(rel));
}

/* ------------------------------------------------------------------ */
/* WebDAV 客户端                                                       */
/* ------------------------------------------------------------------ */
class WebDAV {
  constructor(cfg) {
    const u = new URL(cfg.url);
    this.base = u.href.endsWith('/') ? u.href : u.href + '/';
    // 远端根目录：<用户填写的地址>/linuxreader/
    this.root = this.base + REMOTE_DIR + '/';
    this.user = cfg.user || '';
    this.pass = cfg.pass || '';
    this.rejectUnauthorized = cfg.rejectUnauthorized !== false;
  }

  authHeader() {
    if (!this.user && !this.pass) return {};
    return { Authorization: 'Basic ' + Buffer.from(this.user + ':' + this.pass).toString('base64') };
  }

  request(method, url, { body = null, headers = {}, redirects = 5 } = {}) {
    return new Promise((resolve, reject) => {
      let target;
      try { target = new URL(url); } catch (e) { return reject(new Error('地址格式不正确: ' + url)); }
      const mod = target.protocol === 'https:' ? https : http;
      const opts = {
        method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        headers: Object.assign({ 'User-Agent': 'linuxreader/1.0' }, this.authHeader(), headers),
        rejectUnauthorized: this.rejectUnauthorized,
        timeout: 60000
      };
      if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
      const req = mod.request(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const payload = Buffer.concat(chunks);
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
            const next = new URL(res.headers.location, url).href;
            const m = res.statusCode === 303 ? 'GET' : method;
            return this.request(m, next, { body, headers, redirects: redirects - 1 }).then(resolve, reject);
          }
          resolve({ status: res.statusCode, headers: res.headers, body: payload });
        });
      });
      req.on('timeout', () => { req.destroy(new Error('连接超时（60 秒）')); });
      req.on('error', (e) => reject(new Error('网络错误: ' + e.message)));
      if (body) req.write(body);
      req.end();
    });
  }

  async mkdirp(relDir) {
    const parts = relDir.split('/').filter(Boolean);
    let cur = this.root;
    for (const p of parts) {
      cur = cur + encodeURIComponent(p) + '/';
      const r = await this.request('MKCOL', cur, { headers: { 'Content-Length': '0' } });
      if (![201, 405, 301, 409].includes(r.status) && r.status >= 400) {
        throw new Error('创建远端目录失败 (' + r.status + '): ' + cur);
      }
    }
  }

  async propfind(url, depth) {
    const r = await this.request('PROPFIND', url, {
      headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>' +
        '<d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'
    });
    if (r.status === 401) throw new Error('账号或密码/应用密码不正确（401）');
    if (r.status === 404) return [];
    if (r.status >= 400) throw new Error('读取远端目录失败 (' + r.status + ')');
    return parseMultiStatus(r.body.toString('utf8'));
  }

  /** 列出 root 下所有文件（BFS，深度 1，兼容不支持 Infinity 的服务器） */
  async listAll(onProgress) {
    const files = new Map();
    const seenDirs = new Set();
    const queue = [{ abs: this.root, rel: '' }];
    let requests = 0;
    while (queue.length) {
      const dir = queue.shift();
      if (seenDirs.has(dir.rel)) continue;
      seenDirs.add(dir.rel);
      let items = [];
      try { items = await this.propfind(dir.abs, 1); } catch (e) {
        if (dir.rel === '') throw e;              // 根目录不通就是配置问题
        continue;
      }
      requests++;
      for (const it of items) {
        let hrefPath;
        try { hrefPath = new URL(it.href, dir.abs).pathname; } catch (e) { continue; }
        const hrefFull = decodeURIComponent(hrefPath);
        const basePath = decodeURIComponent(new URL(dir.abs).pathname);
        if (!hrefFull.startsWith(basePath)) continue;
        let rel = hrefFull.slice(basePath.length).replace(/^\/+|\/+$/g, '');
        if (!rel) continue;
        const fullRel = dir.rel ? dir.rel + '/' + rel : rel;
        if (it.collection) {
          queue.push({ abs: dir.abs + rel.split('/').map(encodeURIComponent).join('/') + '/', rel: fullRel });
        } else {
          files.set(fullRel, { size: it.size, mtime: it.mtime, icon: 'webdav' });
        }
      }
      if (onProgress && requests % 3 === 0) onProgress({ phase: 'list', dirs: seenDirs.size, files: files.size });
    }
    return files;
  }

  url(rel) { return this.root + rel.split('/').map(encodeURIComponent).join('/'); }

  async get(rel) {
    const r = await this.request('GET', this.url(rel));
    if (r.status >= 400) throw new Error('下载失败 (' + r.status + '): ' + rel);
    return r.body;
  }

  async put(rel, buf) {
    await this.mkdirp(rel.split('/').slice(0, -1).join('/'));
    const r = await this.request('PUT', this.url(rel), { body: buf });
    if (r.status >= 400) throw new Error('上传失败 (' + r.status + '): ' + rel);
    return true;
  }

  async del(rel) {
    const r = await this.request('DELETE', this.url(rel));
    return r.status < 400 || r.status === 404;
  }

  async test() {
    await this.mkdirp('');
    const items = await this.propfind(this.root, 0);
    return { ok: true, entries: items.length };
  }
}

function parseMultiStatus(xml) {
  const out = [];
  const re = /<[a-z0-9]*:?response[\s>][\s\S]*?<\/[a-z0-9]*:?response>/gi;
  const blocks = xml.match(re) || [];
  for (const block of blocks) {
    const hrefM = block.match(/<[a-z0-9]*:?href[^>]*>([\s\S]*?)<\/[a-z0-9]*:?href>/i);
    if (!hrefM) continue;
    const lenM = block.match(/<[a-z0-9]*:?getcontentlength[^>]*>(\d+)</i);
    const modM = block.match(/<[a-z0-9]*:?getlastmodified[^>]*>([^<]+)</i);
    out.push({
      href: xmlUnescape(hrefM[1].trim()),
      collection: /<[a-z0-9]*:?collection\s*\/?>/i.test(block),
      size: lenM ? Number(lenM[1]) : 0,
      mtime: modM ? Date.parse(modM[1].trim()) || 0 : 0
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 本地目录同步（网盘挂载盘 / 移动硬盘）                                 */
/* ------------------------------------------------------------------ */
class FolderDAV {
  constructor(cfg) {
    this.root = path.join(cfg.dir || '', REMOTE_DIR);
  }
  url(rel) { return path.join(this.root, rel); }
  async test() {
    fs.mkdirSync(this.root, { recursive: true });
    return { ok: true, entries: 0 };
  }
  async listAll() {
    const files = new Map();
    const walk = (dir, rel) => {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(full, r);
        else {
          try { const st = fs.statSync(full); files.set(r, { size: st.size, mtime: st.mtimeMs, icon: 'folder' }); } catch (err) {}
        }
      }
    };
    walk(this.root, '');
    return files;
  }
  async get(rel) { return fs.readFileSync(this.url(rel)); }
  async put(rel, buf) {
    const dest = this.url(rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return true;
  }
  async del(rel) { try { fs.unlinkSync(this.url(rel)); } catch (e) {} return true; }
}

/* ------------------------------------------------------------------ */
/* 合并策略                                                            */
/* ------------------------------------------------------------------ */
function mergeLibrary(local, remote) {
  const out = JSON.parse(JSON.stringify(local || { books: [], deleted: {} }));
  out.books = out.books || [];
  out.deleted = out.deleted || {};
  const byId = new Map(out.books.map((b) => [b.id, b]));
  for (const rb of (remote.books || [])) {
    const lb = byId.get(rb.id);
    if (!lb) { byId.set(rb.id, Object.assign({}, rb)); out.books.push(rb); continue; }
    // 进度取最近阅读的一方
    if ((rb.lastOpenedAt || 0) > (lb.lastOpenedAt || 0)) {
      lb.progress = rb.progress;
      lb.lastOpenedAt = rb.lastOpenedAt;
    }
    lb.title = lb.title || rb.title;
    lb.author = lb.author || rb.author;
    lb.cover = lb.cover || rb.cover;
    lb.favorite = !!(lb.favorite || rb.favorite);
    lb.tags = Array.from(new Set([].concat(lb.tags || [], rb.tags || [])));
  }
  for (const [id, ts] of Object.entries(remote.deleted || {})) {
    out.deleted[id] = Math.max(out.deleted[id] || 0, ts);
  }
  // 已删除的书从书架上抹掉
  out.books = out.books.filter((b) => !out.deleted[b.id]);
  return out;
}

function mergeAnnotations(local, remote) {
  const out = { version: 1, items: [], bookmarks: [] };
  const pick = (key) => {
    const map = new Map();
    for (const src of [remote || {}, local || {}]) {
      for (const it of (src[key] || [])) {
        const cur = map.get(it.id);
        if (!cur || (it.updatedAt || 0) > (cur.updatedAt || 0)) map.set(it.id, it);
      }
    }
    return Array.from(map.values());
  };
  out.items = pick('items');
  out.bookmarks = pick('bookmarks');
  return out;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
function localSnapshot(root) {
  const files = new Map();
  const add = (rel) => {
    if (!isSyncable(rel)) return;
    const abs = path.join(root, rel);
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) files.set(rel, { size: st.size, mtime: st.mtimeMs, abs });
    } catch (e) {}
  };
  add('library.json'); add('settings.json');
  const booksDir = path.join(root, 'books');
  let ids = [];
  try { ids = fs.readdirSync(booksDir); } catch (e) {}
  for (const id of ids) {
    const dir = path.join(booksDir, id);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) {}
    for (const n of names) add('books/' + id + '/' + n);
  }
  return files;
}

async function runSync(cfg, onProgress = () => {}) {
  const root = store.DATA_DIR;
  const log = [];
  const report = { uploaded: 0, downloaded: 0, merged: 0, deleted: 0, skipped: 0 };
  const say = (msg, kind) => { log.push({ t: Date.now(), msg, kind: kind || 'info' }); onProgress({ phase: 'log', msg, kind }); };

  if (!cfg || !cfg.type) throw new Error('还未配置同步账号');
  const dav = cfg.type === 'folder' ? new FolderDAV(cfg) : new WebDAV(cfg);
  say('连接 ' + (cfg.type === 'folder' ? cfg.dir : cfg.url) + ' …');
  await dav.test();
  say('连接成功，开始比对文件', 'ok');

  onProgress({ phase: 'list' });
  const remote = await dav.listAll((p) => onProgress(p));
  const local = localSnapshot(root);
  say('远端 ' + remote.size + ' 个文件，本地 ' + local.size + ' 个文件');

  const stateFile = path.join(root, 'syncState.json');
  const state = store.readJson(stateFile, { files: {} });
  state.files = state.files || {};
  const nextState = { files: {} };

  const all = Array.from(new Set([...remote.keys(), ...local.keys()])).sort();

  for (const rel of all) {
    const r = remote.get(rel);
    const l = local.get(rel);
    const rec = state.files[rel] || null;
    const isJson = rel.endsWith('.json');
    try {
      if (r && !l) {
        const buf = await dav.get(rel);
        const dest = path.join(root, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        report.downloaded++;
        nextState.files[rel] = { hash: md5(buf), size: buf.length, remoteMtime: r.mtime };
        say('↓ 新增 ' + rel, 'down');
        continue;
      }
      if (l && !r) {
        const buf = fs.readFileSync(l.abs);
        const hash = md5(buf);
        if (rec && rec.hash === hash) {            // 远端被外部删除，本地没改 → 跟随删除
          fs.unlinkSync(l.abs);
          delete nextState.files[rel];
          report.deleted++;
          say('✕ 远端已删除 ' + rel, 'warn');
        } else {
          await dav.put(rel, buf);
          report.uploaded++;
          nextState.files[rel] = { hash, size: buf.length, remoteMtime: Date.now() };
          say('↑ 新增 ' + rel, 'up');
        }
        continue;
      }
      // 两边都有
      const localBuf = fs.readFileSync(l.abs);
      const localHash = md5(localBuf);
      const sizeSame = r.size === l.size;
      const remoteChanged = rec ? (r.size !== rec.size || Math.abs((r.mtime || 0) - (rec.remoteMtime || 0)) > 2000) : true;
      const localChanged = rec ? rec.hash !== localHash : true;

      if (sizeSame && !localChanged && !remoteChanged) {
        nextState.files[rel] = rec;
        report.skipped++;
        continue;
      }
      if (sizeSame && !remoteChanged) {
        nextState.files[rel] = { hash: localHash, size: l.size, remoteMtime: r.mtime || rec.remoteMtime };
        report.skipped++;
        continue;
      }
      if (!remoteChanged && localChanged) {
        await dav.put(rel, localBuf);
        report.uploaded++;
        nextState.files[rel] = { hash: localHash, size: localBuf.length, remoteMtime: Date.now() };
        say('↑ 上传 ' + rel, 'up');
        continue;
      }
      if (!localChanged && remoteChanged) {
        const buf = await dav.get(rel);
        if (md5(buf) === localHash) {
          nextState.files[rel] = { hash: localHash, size: buf.length, remoteMtime: r.mtime };
          report.skipped++;
          continue;
        }
        fs.writeFileSync(l.abs, buf);
        report.downloaded++;
        nextState.files[rel] = { hash: md5(buf), size: buf.length, remoteMtime: r.mtime };
        say('↓ 更新 ' + rel, 'down');
        continue;
      }
      // 冲突：JSON 合并，二进制取较新的一方
      if (isJson) {
        const remoteBuf = await dav.get(rel);
        const localObj = JSON.parse(localBuf.toString('utf8') || '{}');
        let remoteObj = {};
        try { remoteObj = JSON.parse(remoteBuf.toString('utf8') || '{}'); } catch (e) { remoteObj = {}; }
        let merged;
        if (rel === 'library.json') merged = mergeLibrary(localObj, remoteObj);
        else if (rel.endsWith('annotations.json')) merged = mergeAnnotations(localObj, remoteObj);
        else merged = Object.assign({}, remoteObj, localObj);
        const buf = Buffer.from(JSON.stringify(merged, null, 2), 'utf8');
        fs.writeFileSync(l.abs, buf);
        await dav.put(rel, buf);
        report.merged++;
        nextState.files[rel] = { hash: md5(buf), size: buf.length, remoteMtime: Date.now() };
        say('⇄ 合并 ' + rel, 'merge');
        continue;
      }
      if ((l.mtime || 0) >= (r.mtime || 0)) {
        await dav.put(rel, localBuf);
        report.uploaded++;
        nextState.files[rel] = { hash: localHash, size: l.size, remoteMtime: Date.now() };
        say('↑ 覆盖远端 ' + rel, 'up');
      } else {
        const buf = await dav.get(rel);
        fs.writeFileSync(l.abs, buf);
        report.downloaded++;
        nextState.files[rel] = { hash: md5(buf), size: buf.length, remoteMtime: r.mtime };
        say('↓ 覆盖本地 ' + rel, 'down');
      }
    } catch (err) {
      say('处理 ' + rel + ' 失败：' + err.message, 'error');
    }
  }

  // 处理删除标记（tombstone）
  const libFile = path.join(root, 'library.json');
  const lib = store.readJson(libFile, null);
  if (lib && lib.deleted) {
    for (const id of Object.keys(lib.deleted)) {
      const dir = path.join(root, 'books', id);
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); report.deleted++; say('✕ 清理已删除的书 ' + id, 'warn'); }
      for (const rel of Array.from(remote.keys())) {
        if (rel.startsWith('books/' + id + '/')) { await dav.del(rel); delete nextState.files[rel]; }
      }
      if (Date.now() - (lib.deleted[id] || 0) > 90 * 86400e3) delete lib.deleted[id];
    }
    store.writeJson(libFile, lib);
  }

  store.writeJson(stateFile, { files: nextState.files, lastSync: Date.now() });

  say('完成：上传 ' + report.uploaded + '，下载 ' + report.downloaded + '，合并 ' + report.merged + '，清理 ' + report.deleted + '，跳过 ' + report.skipped, 'ok');
  return Object.assign(report, { log, lastSync: Date.now() });
}

module.exports = { runSync, WebDAV, FolderDAV, mergeLibrary, mergeAnnotations, REMOTE_DIR };
