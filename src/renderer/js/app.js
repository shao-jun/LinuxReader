'use strict';
/* 应用主控：初始化、设置面板、同步面板、书籍信息、合集 */
const App = (() => {
  const api = window.linuxreader;
  let syncTimer = null;
  let syncing = false;

  const DEFAULT_SETTINGS = {
    theme: 'original', appearance: 'light',
    font: 'serif', weight: 400,
    fontSize: 19, lineHeight: 1.62, letterSpacing: 0.1, wordSpacing: 0, margin: 8,
    mode: 'paged', transition: 'slide', smooth: true,
    sideOpen: true, autoSync: false, syncIntervalMin: 30
  };

  async function boot() {
    try {
      const st = await api.state();
      S.library = st.library || { version: 1, books: [], deleted: {}, collections: [] };
      S.library.books = S.library.books || [];
      S.library.collections = S.library.collections || [];
      S.library.deleted = S.library.deleted || {};
      S.settings = Object.assign({}, DEFAULT_SETTINGS, st.settings || {});
      S.sync = Object.assign({ type: '', url: '', user: '', pass: '', dir: '', auto: false }, st.sync || {});
      S.tts = st.tts;
      S.version = st.version;
      S.home = st.home;
    } catch (e) {
      console.error('初始化失败', e);
      toast('初始化失败：' + e.message, 5000);
    }

    applyChromeTheme();
    Library.init();
    Reader.init();
    bindChrome();
    Library.render();
    // 老书可能还没有封面（早期版本不认首屏整页图），后台补一遍
    setTimeout(() => { if (typeof Library.rescanCovers === 'function') Library.rescanCovers(); }, 1200);
    updateSyncDot(S.sync.lastSync ? 'on' : '');
    scheduleAutoSync();

    if (!S.library.books.length) $('#empty-state').classList.remove('hidden');

    api.onBookImported(async (res) => { await Library.handleImportResult(res); });
    api.onOpenExternal(async (p) => {
      try {
        const st = await api.state();
        if (st && st.library) { S.library = st.library; Library.render(); }
        if (p && p.ids && p.ids[0]) Reader.open(p.ids[0]);
      } catch (e) { console.error('打开外部文件失败', e); }
    });
    api.onImportFailed((msg) => toast('打开失败：' + msg, 5000));
    api.onWinState((s) => {});
    setInterval(() => { if (!$('#view-library').classList.contains('active')) return; },
      60000);
  }

  /* --------------------------- 窗口控制 --------------------------- */
  function bindChrome() {
    $$('#titlebar .tbtn').forEach((b) => {
      b.onclick = () => api.win(b.dataset.win);
    });
    $('#btn-settings').onclick = () => openSettings();
    $('#btn-sync-view').onclick = () => openSync();
    $('#btn-add-collection').onclick = () => createCollection();
    $('#modal-mask').onclick = (e) => { if (e.target.id === 'modal-mask') closeModal(); };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#modal-mask').classList.contains('hidden')) closeModal();
    });
    api.onSyncProgress((p) => {
      if (p.phase === 'log') appendSyncLog(p.msg, p.kind);
    });
  }

  /* --------------------------- 阅读设置 --------------------------- */
  function openSettings() {
    const m = $('#modal-settings');
    m.innerHTML =
      '<div class="modal-head"><h2>阅读设置</h2><button class="icon-btn" data-close-modal>✕</button></div>' +
      '<div class="modal-body">' +
      Reader.typeControlsHtml() +
      '<div class="aa-divider"></div>' +
      '<div class="kv"><span>数据目录</span><span style="font-size:11.5px">' + esc(S.home || '') + '</span></div>' +
      '<div class="kv"><span>语音朗读引擎</span><span>' + (S.tts ? esc(S.tts) : '未安装（可选：sudo apt install espeak-ng）') + '</span></div>' +
      '<div class="about-box">' +
      '<div class="ab-name">LinuxReader <span class="ab-ver">v' + esc(S.version) + '</span></div>' +
      '<div class="ab-line">GitHub：<button class="link" id="s-github">github.com/shao-jun/LinuxReader</button></div>' +
      '<div class="ab-line">© ' + new Date().getFullYear() + ' ftosoft 版权所有</div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn ghost" id="s-opendir">打开数据目录</button><button class="btn primary" data-close-modal>完成</button></div>';

    bindModalClose(m);
    Reader.bindTypeControls(m);
    Reader.syncSettingsUi(m);
    $('#s-github', m).onclick = () => api.openExternal('https://github.com/shao-jun/LinuxReader');
    $('#s-opendir', m).onclick = () => api.openDataDir();
    openModal('modal-settings');
  }

  function saveSettings() {
    api.saveDoc('settings', S.settings).catch(() => {});
    Reader.syncSettingsUi();
  }

  /* --------------------------- 同步 --------------------------- */
  function openSync() {
    const m = $('#modal-sync');
    const isFolder = S.sync.type === 'folder';
    m.innerHTML =
      '<div class="modal-head"><h2>同步与云账号</h2><button class="icon-btn" data-close-modal>✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="sync-opts" id="sy-type">' +
      '<button data-v="webdav" class="' + (!isFolder ? 'on' : '') + '">WebDAV 网盘</button>' +
      '<button data-v="folder" class="' + (isFolder ? 'on' : '') + '">本地 / 挂载文件夹</button>' +
      '</div>' +
      '<div id="sy-webdav" class="' + (isFolder ? 'hidden' : '') + '">' +
      '<div class="field"><label>服务器地址</label><input id="sy-url" placeholder="https://dav.jianguoyun.com/dav/" value="' + esc(S.sync.url || '') + '">' +
      '<div class="hint">坚果云填 https://dav.jianguoyun.com/dav/（账号为邮箱，密码用「应用密码」）；Nextcloud/群晖填各自的 WebDAV 地址。数据保存在该地址下的 linuxreader 目录。</div></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>账号</label><input id="sy-user" autocomplete="off" value="' + esc(S.sync.user || '') + '"></div>' +
      '<div class="field"><label>密码 / 应用密码</label><input id="sy-pass" type="password" autocomplete="off" value="' + esc(S.sync.pass || '') + '"></div>' +
      '</div>' +
      '</div>' +
      '<div id="sy-folder" class="' + (isFolder ? '' : 'hidden') + '">' +
      '<div class="field"><label>同步文件夹</label><div style="display:flex;gap:8px">' +
      '<input id="sy-dir" placeholder="选择一个本地目录或已挂载的网盘目录" value="' + esc(S.sync.dir || '') + '">' +
      '<button class="btn" id="sy-pick">选择…</button></div>' +
      '<div class="hint">适合已挂载的网盘（如 UOS 云盘、OneDrive/坚果云同步盘）。书籍与笔记会写进该目录下的 linuxreader 文件夹。</div></div>' +
      '</div>' +
      '<div class="field"><label>自动同步</label><div style="display:flex;align-items:center;gap:10px">' +
      '<button class="switch ' + (S.sync.auto ? 'on' : '') + '" id="sy-auto"><i></i></button>' +
      '<span style="font-size:12.5px;color:var(--muted)">开启后每 <input id="sy-interval" type="number" min="5" max="240" value="' + (S.settings.syncIntervalMin || 30) + '" style="width:56px;height:26px;padding:0 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg)"> 分钟自动同步一次</span>' +
      '</div></div>' +
      '<div class="kv"><span>上次同步</span><span id="sy-last">' + (S.sync.lastSync ? fmtDate(S.sync.lastSync) : '从未同步') + '</span></div>' +
      '<div class="field" style="margin-top:12px"><label>同步日志</label><div class="sync-log" id="sy-log"><div class="muted">点击「立即同步」开始</div></div></div>' +
      '</div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" id="sy-test">测试连接</button>' +
      '<button class="btn ghost" data-close-modal>关闭</button>' +
      '<button class="btn primary" id="sy-run">立即同步</button>' +
      '</div>';

    bindModalClose(m);
    let type = isFolder ? 'folder' : 'webdav';
    $$('#sy-type button', m).forEach((b) => b.onclick = () => {
      type = b.dataset.v;
      $$('#sy-type button', m).forEach((x) => x.classList.toggle('on', x === b));
      $('#sy-webdav', m).classList.toggle('hidden', type !== 'webdav');
      $('#sy-folder', m).classList.toggle('hidden', type === 'webdav');
    });
    $('#sy-auto', m).onclick = (e) => {
      S.sync.auto = !S.sync.auto;
      e.currentTarget.classList.toggle('on', S.sync.auto);
      api.saveDoc('sync', S.sync);
      scheduleAutoSync();
    };
    $('#sy-interval', m).onchange = (e) => {
      S.settings.syncIntervalMin = Math.max(5, Math.min(240, Number(e.target.value) || 30));
      saveSettings(); scheduleAutoSync();
    };
    $('#sy-pick', m).onclick = async () => {
      const dir = await api.pickFolder();
      if (dir) $('#sy-dir', m).value = dir;
    };
    $('#sy-test', m).onclick = async () => {
      const cfg = collectSync(m, type);
      if (!cfg) return;
      const log = $('#sy-log', m);
      log.innerHTML = '<div>正在连接…</div>';
      const res = await api.syncTest(cfg);
      log.innerHTML = res.ok ? '<div class="ok">✓ 连接成功' + (res.detail && res.detail.entries ? '（目录可访问）' : '') + '</div>'
        : '<div class="error">✗ ' + esc(res.error) + '</div>';
    };
    $('#sy-run', m).onclick = async () => {
      const cfg = collectSync(m, type);
      if (!cfg) return;
      appendSyncLog('开始同步…', 'info');
      await doSync(cfg, m);
    };
    openModal('modal-sync');
  }

  function collectSync(m, type) {
    const cfg = { type };
    if (type === 'folder') {
      cfg.dir = $('#sy-dir', m).value.trim();
      if (!cfg.dir) { toast('请选择同步文件夹'); return null; }
    } else {
      cfg.url = $('#sy-url', m).value.trim();
      cfg.user = $('#sy-user', m).value.trim();
      cfg.pass = $('#sy-pass', m).value;
      if (!cfg.url) { toast('请填写服务器地址'); return null; }
      if (!/^https?:\/\//i.test(cfg.url)) cfg.url = 'https://' + cfg.url;
      cfg.url = cfg.url.replace(/\/+$/, '') + '/';
    }
    S.sync = Object.assign(S.sync, cfg, { type });
    api.saveDoc('sync', S.sync).catch(() => {});
    return cfg;
  }

  function appendSyncLog(msg, kind) {
    const m = $('#sy-log');
    if (!m) return;
    if (m.dataset.clean !== '1') { m.innerHTML = ''; m.dataset.clean = '1'; }
    const div = document.createElement('div');
    if (kind) div.className = kind;
    div.textContent = msg;
    m.appendChild(div);
    m.scrollTop = m.scrollHeight;
  }

  async function doSync(cfg, modal) {
    if (syncing) { toast('正在同步中…'); return; }
    syncing = true;
    updateSyncDot('busy');
    const btn = modal ? $('#sy-run', modal) : null;
    if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
    try {
      const res = await api.syncRun(cfg || S.sync);
      if (!res.ok) {
        appendSyncLog('同步失败：' + res.error, 'error');
        updateSyncDot('err');
        toast('同步失败：' + res.error, 5000);
        return;
      }
      if (res.library) {
        S.library = res.library;
        S.library.books = S.library.books || [];
        S.library.collections = S.library.collections || [];
      }
      S.sync.lastSync = res.report.lastSync || Date.now();
      const last = $('#sy-last');
      if (last) last.textContent = fmtDate(S.sync.lastSync);
      updateSyncDot('on');
      // 补全刚拉取下来的书（本地还没解析过）
      for (const b of S.library.books) {
        if (b.type === 'epub' && !b.chapters) await Library.parseAndSave(b.id);
      }
      await Library.reload();
      Library.render();
      if ($('#view-library').classList.contains('active')) Library.render();
      const r = res.report;
      const summary = '上传 ' + r.uploaded + ' · 下载 ' + r.downloaded + ' · 合并 ' + r.merged + ' · 跳过 ' + r.skipped;
      appendSyncLog('完成：' + summary, 'ok');
      if (!modal) toast('同步完成：' + summary);
      else appendSyncLog('书库与笔记已是最新', 'ok');
    } catch (e) {
      appendSyncLog('同步异常：' + e.message, 'error');
      updateSyncDot('err');
    } finally {
      syncing = false;
      if (btn) { btn.disabled = false; btn.textContent = '立即同步'; }
    }
  }

  function runSync(manual) {
    if (!S.sync.type) {
      if (manual) openSync();
      return;
    }
    if (!manual && !S.sync.auto) return;
    const m = $('#modal-sync').classList.contains('open') ? $('#modal-sync') : null;
    doSync(S.sync, m);
  }

  function updateSyncDot(state) {
    const dot = $('#sync-dot');
    dot.className = 'sync-dot ' + (state === 'on' ? 'on' : state === 'err' ? 'err' : '');
    dot.title = state === 'on' ? '已同步' : state === 'err' ? '同步失败' : '未同步';
  }

  function scheduleAutoSync() {
    clearInterval(syncTimer);
    if (!S.sync.auto || !S.sync.type) return;
    const mins = Math.max(5, Number(S.settings.syncIntervalMin) || 30);
    syncTimer = setInterval(() => runSync(false), mins * 60e3);
    setTimeout(() => runSync(false), 8000);
  }

  /* --------------------------- 书籍信息 --------------------------- */
  async function showBookInfo(id) {
    const book = (S.library.books || []).find((b) => b.id === id);
    if (!book) return;
    const meta = (await api.meta(id)) || {};
    const m = $('#modal-info');
    m.innerHTML =
      '<div class="modal-head"><h2>书籍信息</h2><button class="icon-btn" data-close-modal>✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>书名</label><input id="bi-title" value="' + esc(meta.title || book.title || '') + '"></div>' +
      '<div class="field"><label>作者</label><input id="bi-author" value="' + esc(meta.author || book.author || '') + '"></div>' +
      (meta.publisher ? '<div class="kv"><span>出版社</span><span>' + esc(meta.publisher) + '</span></div>' : '') +
      (meta.language ? '<div class="kv"><span>语言</span><span>' + esc(meta.language) + '</span></div>' : '') +
      '<div class="kv"><span>格式</span><span>' + esc((meta.type || book.type || 'epub').toUpperCase()) + '</span></div>' +
      '<div class="kv"><span>章节</span><span>' + esc(String(meta.chapterCount || (meta.spine || []).length || '—')) + '</span></div>' +
      '<div class="kv"><span>阅读进度</span><span>' + pct(book.progress && book.progress.percent) + '%</span></div>' +
      '<div class="kv"><span>添加时间</span><span>' + fmtDate(book.addedAt) + '</span></div>' +
      '<div class="kv"><span>最近阅读</span><span>' + fmtDate(book.lastOpenedAt) + '</span></div>' +
      (meta.identifier ? '<div class="kv"><span>标识</span><span style="font-size:11px">' + esc(meta.identifier).slice(0, 60) + '</span></div>' : '') +
      '</div>' +
      '<div class="modal-foot"><button class="btn ghost" data-close-modal>取消</button><button class="btn primary" id="bi-save">保存</button></div>';
    bindModalClose(m);
    $('#bi-save', m).onclick = async () => {
      const title = $('#bi-title', m).value.trim() || book.title;
      const author = $('#bi-author', m).value.trim();
      meta.title = title; meta.author = author;
      await api.saveMeta(id, meta);
      book.title = title; book.author = author;
      await api.saveDoc('library', S.library);
      Library.render();
      closeModal();
      toast('已保存');
    };
    openModal('modal-info');
  }

  /* --------------------------- 标签 --------------------------- */
  function showTagEditor(bookId) {
    const book = (S.library.books || []).find((b) => b.id === bookId);
    if (!book) return;
    book.tags = book.tags || [];
    const existing = Array.from(new Set((S.library.books || []).flatMap((b) => b.tags || [])));
    const m = $('#modal-collection');
    m.innerHTML =
      '<div class="modal-head"><h2>标签 · ' + esc(book.title || '') + '</h2><button class="icon-btn" data-close-modal>✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>标签（回车添加，点 × 删除）</label>' +
      '<div class="tag-edit" id="tag-edit">' + book.tags.map((t) => '<span class="tag-item" data-t="' + esc(t) + '">' + esc(t) + '<b>×</b></span>').join('') +
      '<input id="tag-input" placeholder="输入后按回车…"></div></div>' +
      (existing.length ? '<div class="field"><label>已有标签</label><div class="font-picks" id="tag-suggest">' +
        existing.map((t) => '<button data-t="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div></div>' : '') +
      '</div>' +
      '<div class="modal-foot"><button class="btn ghost" data-close-modal>取消</button><button class="btn primary" id="tag-save">保存</button></div>';
    bindModalClose(m);
    openModal('modal-collection');
    const input = $('#tag-input', m);
    setTimeout(() => input.focus(), 60);

    const addTag = (t) => {
      t = String(t || '').trim().replace(/^#/, '');
      if (!t || book.tags.includes(t)) return;
      book.tags.push(t);
      renderTagList();
    };
    const renderTagList = () => {
      $('#tag-edit', m).innerHTML = book.tags.map((t) =>
        '<span class="tag-item" data-t="' + esc(t) + '">' + esc(t) + '<b>×</b></span>').join('') +
        '<input id="tag-input" placeholder="输入后按回车…">';
      const inp = $('#tag-input', m);
      inp.focus();
      bindInput(inp);
      $$('#tag-edit .tag-item b', m).forEach((x) => {
        x.onclick = () => {
          const t = x.parentElement.dataset.t;
          book.tags = book.tags.filter((y) => y !== t);
          renderTagList();
        };
      });
    };
    const bindInput = (inp) => {
      inp.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
          e.preventDefault();
          addTag(inp.value);
        }
        if (e.key === 'Backspace' && !inp.value && book.tags.length) {
          book.tags.pop(); renderTagList();
        }
      };
    };
    bindInput(input);
    $$('#tag-edit .tag-item b', m).forEach((x) => {
      x.onclick = () => { const t = x.parentElement.dataset.t; book.tags = book.tags.filter((y) => y !== t); renderTagList(); };
    });
    $$('#tag-suggest button', m).forEach((b) => { b.onclick = () => addTag(b.dataset.t); });

    $('#tag-save', m).onclick = async () => {
      const pending = $('#tag-input', m).value.trim();
      if (pending) addTag(pending);
      await api.saveDoc('library', S.library);
      Library.render();
      closeModal();
      toast('标签已保存');
    };
  }

  /* --------------------------- 合集 --------------------------- */
  function createCollection() {
    const m = $('#modal-collection');
    m.innerHTML =
      '<div class="modal-head"><h2>新建合集</h2><button class="icon-btn" data-close-modal>✕</button></div>' +
      '<div class="modal-body"><div class="field"><label>合集名称</label><input id="col-name" placeholder="例如：待读、技术、小说"></div></div>' +
      '<div class="modal-foot"><button class="btn ghost" data-close-modal>取消</button><button class="btn primary" id="col-ok">创建</button></div>';
    bindModalClose(m);
    openModal('modal-collection');
    setTimeout(() => $('#col-name').focus(), 50);
    const ok = async () => {
      const name = $('#col-name', m).value.trim();
      if (!name) return toast('请输入名称');
      S.library.collections.push({ id: uid('c'), name, books: [] });
      await api.saveDoc('library', S.library);
      Library.render();
      closeModal();
      toast('已创建合集');
    };
    $('#col-ok', m).onclick = ok;
    $('#col-name', m).onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  }

  function showCollectionPicker(bookId) {
    if (!S.library.collections.length) { createCollection(); return; }
    const m = $('#modal-collection');
    m.innerHTML =
      '<div class="modal-head"><h2>加入合集</h2><button class="icon-btn" data-close-modal>✕</button></div>' +
      '<div class="modal-body">' +
      S.library.collections.map((c) => {
        const has = (c.books || []).includes(bookId);
        return '<div class="kv" style="cursor:pointer" data-col="' + c.id + '"><span>' + esc(c.name) + '</span><span>' + (has ? '✓ 已加入' : '点击加入') + '</span></div>';
      }).join('') +
      '</div><div class="modal-foot"><button class="btn ghost" data-close-modal>关闭</button></div>';
    bindModalClose(m);
    $$('[data-col]', m).forEach((row) => {
      row.onclick = async () => {
        const col = S.library.collections.find((c) => c.id === row.dataset.col);
        col.books = col.books || [];
        if (col.books.includes(bookId)) col.books = col.books.filter((x) => x !== bookId);
        else col.books.push(bookId);
        await api.saveDoc('library', S.library);
        Library.render();
        showCollectionPicker(bookId);
      };
    });
    openModal('modal-collection');
  }

  function collectionMenu(e, id) {
    const col = S.library.collections.find((c) => c.id === id);
    if (!col) return;
    const menu = $('#ctx-menu');
    menu.innerHTML = '<button data-act="rename">重命名合集</button><button data-act="delete" class="danger">删除合集</button>';
    menu.classList.remove('hidden');
    menu.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';
    $$('#ctx-menu button').forEach((b) => {
      b.onclick = async () => {
        menu.classList.add('hidden');
        if (b.dataset.act === 'rename') {
          const name = prompt('合集名称', col.name);
          if (name && name.trim()) { col.name = name.trim(); await api.saveDoc('library', S.library); Library.render(); }
        } else if (b.dataset.act === 'delete') {
          if (!confirm('删除合集「' + col.name + '」？（书籍本身不会删除）')) return;
          S.library.collections = S.library.collections.filter((c) => c.id !== id);
          await api.saveDoc('library', S.library);
          if (S.collectionId === id) { S.shelf = 'all'; S.collectionId = null; }
          Library.render();
        }
      };
    });
  }

  /* --------------------------- 工具 --------------------------- */
  function bindModalClose(root) {
    $$('[data-close-modal]', root).forEach((b) => b.onclick = closeModal);
  }

  return {
    boot, openSettings, openSync, runSync, showBookInfo, showTagEditor,
    showCollectionPicker, collectionMenu, createCollection
  };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
