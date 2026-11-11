'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const store = require('./store');
const { unzipTo, sanitizeHtml, sha1File } = require('./epub');
const { runSync } = require('./sync');

const APP_ROOT = path.join(__dirname, '..', '..');       // /opt/linuxreader/resources/app
const RENDERER = path.join(APP_ROOT, 'src', 'renderer');
const VERSION = require(path.join(APP_ROOT, 'package.json')).version;

store.ensureDirs();
// 开发/调试时可以用 LR_PROFILE 指向单独的 profile，避免和已安装的实例抢单实例锁
app.setPath('userData', process.env.LR_PROFILE || path.join(store.DATA_DIR, 'profile'));
app.setName('LinuxReader');

protocol.registerSchemesAsPrivileged([{
  scheme: 'linuxreader',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf', '.ncx': 'application/xml', '.opf': 'application/oebps-package+xml',
  '.xml': 'application/xml'
};

let mainWindow = null;

/* .epub / .pdf 双击打开：命令行参数、文件管理器「用 LinuxReader 打开」、二次启动都走这里 */
const BOOK_EXTS = ['.epub', '.pdf'];

function filesFromArgv(argv) {
  return (argv || []).filter((a) => typeof a === 'string' && a.charAt(0) !== '-' &&
    BOOK_EXTS.includes(path.extname(a).toLowerCase()) && fs.existsSync(a))
    .map((a) => path.resolve(a));
}

async function openExternalFiles(files) {
  if (!files || !files.length) return;
  try {
    const res = await importFiles(files);
    send('book:imported', res);
    if (res.imported && res.imported.length) send('book:open-external', { ids: res.imported.map((x) => x.id) });
    if (res.errors && res.errors.length) send('book:import-failed', res.errors.join('；'));
  } catch (e) {
    send('book:import-failed', e.message);
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function safeResolve(base, rel) {
  const norm = decodeURIComponent(rel).replace(/^\/+/, '');
  const full = path.resolve(base, norm);
  if (full !== path.resolve(base) && !full.startsWith(path.resolve(base) + path.sep)) return null;
  return full;
}

function serveFile(file, sanitize) {
  const ext = path.extname(file).toLowerCase();
  let data;
  try { data = fs.readFileSync(file); } catch (e) { return new Response('Not Found', { status: 404 }); }
  const type = MIME[ext] || 'application/octet-stream';
  if (sanitize && ['.xhtml', '.html', '.htm'].includes(ext)) {
    return new Response(sanitizeHtml(data.toString('utf8')), { headers: { 'content-type': type } });
  }
  return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
}

function setupProtocol() {
  protocol.handle('linuxreader', async (request) => {
    const u = new URL(request.url);
    const p = u.pathname;
    // linuxreader://local/app/... -> 应用界面（不做过 HTML 清洗，脚本要能跑）
    if (p.startsWith('/app/')) {
      const f = safeResolve(RENDERER, p.slice(5));
      return f ? serveFile(f, false) : new Response('Forbidden', { status: 403 });
    }
    // linuxreader://local/book/<id>/src/<rel>（书籍内容，去掉脚本）
    let m = p.match(/^\/book\/([A-Za-z0-9_-]+)\/src\/(.*)$/);
    if (m) {
      const base = path.join(store.bookDir(m[1]), 'src');
      const f = safeResolve(base, m[2]);
      return f ? serveFile(f, true) : new Response('Forbidden', { status: 403 });
    }
    // linuxreader://local/book/<id>/file  -> 原始 epub/pdf
    m = p.match(/^\/book\/([A-Za-z0-9_-]+)\/file$/);
    if (m) {
      const dir = store.bookDir(m[1]);
      for (const n of ['book.pdf', 'book.epub']) {
        const f = path.join(dir, n);
        if (fs.existsSync(f)) return serveFile(f);
      }
      return new Response('Not Found', { status: 404 });
    }
    // linuxreader://local/book/<id>/cover  -> 封面图片
    m = p.match(/^\/book\/([A-Za-z0-9_-]+)\/cover$/);
    if (m) {
      const dir = store.bookDir(m[1]);
      for (const n of fs.readdirSync(dir)) {
        if (n.startsWith('cover.')) return serveFile(path.join(dir, n));
      }
      return new Response('Not Found', { status: 404 });
    }
    return new Response('Not Found', { status: 404 });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 640,
    frame: false, backgroundColor: '#f4f4f6', show: false,
    title: 'LinuxReader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      plugins: true, spellcheck: false, webSecurity: true
    }
  });
  mainWindow.loadURL('linuxreader://local/app/index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
    const importIdx = process.argv.indexOf('--import');
    if (importIdx > -1 && process.argv[importIdx + 1]) {
      importFiles([process.argv[importIdx + 1]])
        .then((res) => send('book:imported', res))
        .catch((e) => send('book:import-failed', e.message));
    }
    // 双击 .epub/.pdf 启动：直接导入并打开
    const opened = filesFromArgv(process.argv.slice(1));
    if (opened.length) setTimeout(() => openExternalFiles(opened), 400);
  });
  mainWindow.on('maximize', () => send('win:state', { maximized: true }));
  mainWindow.on('unmaximize', () => send('win:state', { maximized: false }));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/* ---------------------------------------------------------------- */
/* 导入                                                              */
/* ---------------------------------------------------------------- */
function slugHash(file) { try { return sha1File(file); } catch (e) { return null; } }

async function importFiles(files) {
  const library = store.readJson(store.docPath('library'), { version: 1, books: [], deleted: {} });
  library.books = library.books || [];
  const imported = [];
  const errors = [];
  for (const src of files) {
    try {
      const ext = path.extname(src).toLowerCase();
      if (!['.epub', '.pdf'].includes(ext)) { errors.push(path.basename(src) + '：只支持 EPUB / PDF'); continue; }
      const hash = slugHash(src);
      const exist = library.books.find((b) => b.hash === hash);
      if (exist) { imported.push({ id: exist.id, type: exist.type, duplicate: true }); continue; }
      const id = 'b' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const dir = store.bookDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const destName = ext === '.pdf' ? 'book.pdf' : 'book.epub';
      fs.copyFileSync(src, path.join(dir, destName));
      const type = ext === '.pdf' ? 'pdf' : 'epub';
      if (type === 'epub') {
        try { unzipTo(path.join(dir, destName), path.join(dir, 'src')); }
        catch (e) { throw new Error('EPUB 解包失败：' + e.message); }
      }
      const meta = {
        id, type, title: path.basename(src, ext), author: '', hash,
        addedAt: Date.now(), lastOpenedAt: 0,
        progress: { chapter: 0, offset: 0, percent: 0 },
        file: destName
      };
      store.writeJson(path.join(dir, 'meta.json'), meta);
      library.books.push({ id, type, title: meta.title, author: '', hash, addedAt: meta.addedAt, lastOpenedAt: 0, progress: meta.progress });
      send('import:progress', { file: path.basename(src), done: true });
      imported.push({ id, type, title: meta.title });
    } catch (e) {
      errors.push(path.basename(src) + '：' + e.message);
    }
  }
  store.writeJson(store.docPath('library'), library);
  return { imported, errors };
}

/* ---------------------------------------------------------------- */
/* TTS（朗读）                                                        */
/* ---------------------------------------------------------------- */
const TTS_CANDIDATES = [
  { bin: 'espeak-ng', args: (t, r) => ['-v', 'cmn', '-s', String(r), '--stdout'], direct: true },
  { bin: 'espeak', args: (t, r) => ['-v', 'zh', '-s', String(r)], direct: false },
  { bin: 'spd-say', args: (t, r) => ['-w', '-l', 'zh', '-r', String(Math.round((r - 175) / 2)), t], direct: false },
  { bin: 'pico2wave', args: () => [], direct: false }
];
let ttsBin = null;
let ttsProc = null;

function detectTts() {
  return new Promise((resolve) => {
    const which = require('child_process').execFile('which', TTS_CANDIDATES.map((c) => c.bin), (err, stdout) => {
      const found = (stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
      ttsBin = found.length ? found[0] : null;
      resolve(ttsBin);
    });
  });
}

/* ---------------------------------------------------------------- */
/* IPC                                                               */
/* ---------------------------------------------------------------- */
function registerIpc() {
  ipcMain.handle('app:state', async () => ({
    version: VERSION,
    home: store.DATA_DIR,
    library: store.readJson(store.docPath('library'), { version: 1, books: [], deleted: {} }),
    settings: store.readJson(store.docPath('settings'), {}),
    sync: store.readJson(store.docPath('sync'), { type: '', url: '', user: '', pass: '', auto: false }),
    tts: ttsBin || null
  }));

  ipcMain.handle('doc:load', (e, name) => store.readJson(store.docPath(name), null));
  ipcMain.handle('doc:save', (e, name, data) => {
    if (!['library', 'settings', 'sync'].includes(name)) throw new Error('不允许写入 ' + name);
    store.writeJson(store.docPath(name), data);
    return true;
  });

  ipcMain.handle('book:meta', (e, id) => store.readJson(path.join(store.bookDir(id), 'meta.json'), null));
  ipcMain.handle('book:meta-save', (e, id, meta) => {
    store.writeJson(path.join(store.bookDir(id), 'meta.json'), meta);
    return true;
  });

  ipcMain.handle('book:annotations', (e, id) =>
    store.readJson(path.join(store.bookDir(id), 'annotations.json'), { version: 1, items: [], bookmarks: [] }));
  ipcMain.handle('book:annotations-save', (e, id, data) => {
    store.writeJson(path.join(store.bookDir(id), 'annotations.json'), data);
    return true;
  });

  ipcMain.handle('book:ensure-src', async (e, id) => {
    const dir = store.bookDir(id);
    const src = path.join(dir, 'src');
    const meta = store.readJson(path.join(dir, 'meta.json'), null);
    if (meta && meta.type === 'pdf') return { type: 'pdf', ready: fs.existsSync(path.join(dir, 'book.pdf')) };
    const epub = path.join(dir, 'book.epub');
    if (!fs.existsSync(epub)) return { type: 'epub', ready: false, error: '书籍文件缺失（可能还没同步下来）' };
    if (!fs.existsSync(src) || fs.readdirSync(src).length === 0) {
      unzipTo(epub, src);
    }
    return { type: 'epub', ready: true };
  });

  ipcMain.handle('book:remove', (e, id) => {
    const lib = store.readJson(store.docPath('library'), { version: 1, books: [], deleted: {} });
    lib.books = (lib.books || []).filter((b) => b.id !== id);
    lib.deleted = lib.deleted || {};
    lib.deleted[id] = Date.now();
    store.writeJson(store.docPath('library'), lib);
    fs.rmSync(store.bookDir(id), { recursive: true, force: true });
    return lib;
  });

  ipcMain.handle('book:import-dialog', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '导入书籍', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '电子书', extensions: ['epub', 'pdf'] }, { name: '所有文件', extensions: ['*'] }]
    });
    if (r.canceled || !r.filePaths.length) return { imported: [], errors: [], canceled: true };
    return importFiles(r.filePaths);
  });
  ipcMain.handle('book:import-paths', (e, files) => importFiles(files));

  ipcMain.handle('dialog:pick-folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: '选择同步文件夹', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('sync:test', async (e, cfg) => {
    const { WebDAV, FolderDAV } = require('./sync');
    try {
      const dav = cfg.type === 'folder' ? new FolderDAV(cfg) : new WebDAV(cfg);
      const r = await dav.test();
      return { ok: true, detail: r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sync:run', async (e, cfg) => {
    try {
      const res = await runSync(cfg, (p) => send('sync:progress', p));
      if (cfg.auto !== undefined) {
        const s = store.readJson(store.docPath('sync'), {});
        store.writeJson(store.docPath('sync'), Object.assign(s, { lastSync: res.lastSync }));
      }
      return { ok: true, report: res, library: store.readJson(store.docPath('library'), null) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('tts:speak', (e, text, rate) => {
    if (!ttsBin) return { ok: false, error: '未安装语音引擎' };
    try { if (ttsProc) ttsProc.kill(); } catch (err) {}
    const cand = TTS_CANDIDATES.find((c) => c.bin === ttsBin) || TTS_CANDIDATES[1];
    const args = cand.bin === 'pico2wave'
      ? ['-l', 'zh-CN', '-o', path.join(os.tmpdir(), 'linuxreader-tts.wav'), text]
      : cand.args(text, rate || 175);
    if (cand.bin === 'espeak-ng') {
      // espeak-ng --stdout 输出 wav，交给 renderer 播放可以精确跟随时间
      const out = path.join(os.tmpdir(), 'linuxreader-tts-' + process.pid + '.wav');
      const p = spawn('espeak-ng', ['-v', 'cmn', '-s', String(rate || 175), '-w', out, text]);
      ttsProc = p;
      return new Promise((resolve) => {
        p.on('exit', (code) => {
          if (code !== 0 || !fs.existsSync(out)) return resolve({ ok: false, error: '语音合成失败' });
          resolve({ ok: true, audio: 'file://' + out });
        });
        p.on('error', (err) => resolve({ ok: false, error: err.message }));
      });
    }
    const p = spawn(ttsBin, args);
    ttsProc = p;
    return new Promise((resolve) => {
      p.on('error', (err) => resolve({ ok: false, error: err.message }));
      p.on('exit', () => resolve({ ok: true, audio: null }));
    });
  });
  ipcMain.handle('tts:stop', () => { try { if (ttsProc) ttsProc.kill(); } catch (e) {} ttsProc = null; return true; });

  ipcMain.handle('win:action', (e, action) => {
    if (!mainWindow) return false;
    if (action === 'min') mainWindow.minimize();
    else if (action === 'max') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('win:state', () => (mainWindow ? { maximized: mainWindow.isMaximized() } : {}));
  ipcMain.handle('shell:data-dir', () => shell.openPath(store.DATA_DIR));
  ipcMain.handle('shell:open', (e, url) => shell.openExternal(url));
  ipcMain.handle('app:info', () => ({ version: VERSION, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, home: store.DATA_DIR }));
  ipcMain.handle('app:reveal-book', (e, id) => shell.openPath(store.bookDir(id)));
}

/* ---------------------------------------------------------------- */
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', (e, argv, cwd) => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    const files = filesFromArgv(argv).map((f) => path.isAbsolute(f) ? f : path.resolve(cwd || process.cwd(), f));
    if (files.length) openExternalFiles(files);
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    setupProtocol();
    await detectTts();
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
