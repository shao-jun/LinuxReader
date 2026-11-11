'use strict';
/* 书库视图：书架、卡片、导入、合集、右键菜单 */
const Library = (() => {
  const api = window.linuxreader;
  let lastRendered = 0;

  const colorFor = (id) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  };

  function books() { return S.library.books || []; }
  function collections() { return S.library.collections || []; }

  function visibleBooks() {
    let list = books().slice();
    if (S.shelf === 'recent') list = list.filter((b) => b.lastOpenedAt);
    if (S.shelf === 'favorite') list = list.filter((b) => b.favorite);
    if (S.shelf === 'tag' && S.tag) list = list.filter((b) => (b.tags || []).includes(S.tag));
    if (S.shelf === 'collection' && S.collectionId) {
      const col = collections().find((c) => c.id === S.collectionId);
      const ids = new Set(col ? col.books || [] : []);
      list = list.filter((b) => ids.has(b.id));
    }
    const q = S.search.trim().toLowerCase();
    if (q) {
      list = list.filter((b) =>
        (b.title || '').toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        (b.tags || []).some((t) => String(t).toLowerCase().includes(q)));
    }
    const by = S.sort;
    list.sort((a, b) => {
      if (by === 'title') return (a.title || '').localeCompare(b.title || '', 'zh');
      if (by === 'author') return (a.author || '').localeCompare(b.author || '', 'zh');
      if (by === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
      return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || (b.addedAt || 0) - (a.addedAt || 0);
    });
    return list;
  }

  function coverUrl(book) {
    if (book.coverData) return book.coverData;
    if (!book.cover) return '';
    return 'linuxreader://local/book/' + book.id + '/src/' + String(book.cover).split('/').map(encodeURIComponent).join('/');
  }

  function cardHtml(book) {
    const url = coverUrl(book);
    const p = book.progress && book.progress.percent ? book.progress.percent : 0;
    const hue = colorFor(book.id);
    return '<div class="book-card" data-id="' + book.id + '">' +
      '<div class="book-cover">' +
      (url ? '<img loading="lazy" src="' + esc(url) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<div class="cover-fallback" style="background:linear-gradient(155deg,hsl(' + hue + ' 38% 48%),hsl(' + ((hue + 40) % 360) + ' 44% 30%))">' +
      '<div class="cf-title">' + esc(book.title || '未命名') + '</div>' +
      '<div class="cf-author">' + esc(book.author || '') + '</div></div>' +
      (book.favorite ? '<div class="badge-fav">★</div>' : '') +
      (p > 0.005 ? '<div class="cover-progress"><i style="width:' + pct(p) + '%"></i></div>' : '') +
      '</div>' +
      '<div class="book-meta">' +
      '<div class="book-name">' + esc(book.title || '未命名') + '</div>' +
      '<div class="book-author">' + esc(book.author || (book.type === 'pdf' ? 'PDF 文档' : '')) + '</div>' +
      ((book.tags || []).length ? '<div class="tag-row">' + book.tags.slice(0, 3).map((t) => '<span class="tag-chip">' + esc(t) + '</span>').join('') + '</div>' : '') +
      '<div class="book-progress-text">' + (p > 0.005 ? pct(p) + '% · ' + esc(relTime(book.lastOpenedAt)) : (book.lastOpenedAt ? '刚开始阅读' : '未读')) + '</div>' +
      '</div></div>';
  }

  function relTime(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + ' 天前';
    return fmtDate(ts);
  }

  function render() {
    const list = visibleBooks();
    const grid = $('#book-grid');
    grid.classList.toggle('list-mode', S.viewMode === 'list');
    grid.innerHTML = list.map(cardHtml).join('');
    $('#empty-state').classList.toggle('hidden', list.length > 0);
    grid.classList.toggle('hidden', list.length === 0);

    $('#shelf-title').textContent = shelfTitle();
    const total = books().length;
    $('#shelf-sub').textContent = list.length + ' 本' + (list.length !== total ? ' · 共 ' + total + ' 本' : '') +
      (books().some((b) => !b.lastOpenedAt) ? ' · ' + books().filter((b) => !b.lastOpenedAt).length + ' 本未读' : '');

    $$('#book-grid .book-card').forEach((card) => {
      card.onclick = () => open(card.dataset.id);
      card.oncontextmenu = (e) => { e.preventDefault(); contextMenu(e, card.dataset.id); };
    });
    renderSidebar();
    lastRendered = Date.now();
  }

  function shelfTitle() {
    if (S.shelf === 'recent') return '最近阅读';
    if (S.shelf === 'favorite') return '收藏';
    if (S.shelf === 'tag') return '标签：' + (S.tag || '');
    if (S.shelf === 'collection') {
      const c = collections().find((x) => x.id === S.collectionId);
      return c ? c.name : '合集';
    }
    return '全部书籍';
  }

  function allTags() {
    const map = new Map();
    for (const b of books()) {
      for (const t of (b.tags || [])) map.set(t, (map.get(t) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  }

  function renderSidebar() {
    $$('.side-item[data-shelf]').forEach((b) => b.classList.toggle('active', b.dataset.shelf === S.shelf));
    $('#count-all').textContent = books().length || '';
    const box = $('#collections');
    if (!box) return;
    const list = collections();
    box.innerHTML = list.map((c) => {
      const n = (c.books || []).length;
      return '<button class="side-item' + (S.shelf === 'collection' && S.collectionId === c.id ? ' active' : '') + '" data-col="' + c.id + '">' +
        '<span class="si-ico">▣</span>' + esc(c.name) + '<span class="count">' + (n || '') + '</span></button>';
    }).join('') || '<div style="padding:4px 10px 8px;font-size:12px;color:var(--muted)">还没有合集</div>';
    $$('#collections [data-col]').forEach((b) => {
      b.onclick = () => { S.shelf = 'collection'; S.collectionId = b.dataset.col; render(); };
      b.oncontextmenu = (e) => { e.preventDefault(); App.collectionMenu(e, b.dataset.col); };
    });

    const tagBox = $('#tags');
    if (tagBox) {
      const tags = allTags();
      tagBox.innerHTML = tags.map(([name, n]) =>
        '<button class="side-item' + (S.shelf === 'tag' && S.tag === name ? ' active' : '') + '" data-tag="' + esc(name) + '">' +
        '<span class="tag-hash">#</span>' + esc(name) + '<span class="count">' + n + '</span></button>'
      ).join('') || '<div style="padding:4px 10px 8px;font-size:12px;color:var(--muted)">书籍信息里可以加标签</div>';
      $$('#tags [data-tag]').forEach((b) => {
        b.onclick = () => {
          if (S.shelf === 'tag' && S.tag === b.dataset.tag) { S.shelf = 'all'; S.tag = null; }
          else { S.shelf = 'tag'; S.tag = b.dataset.tag; S.collectionId = null; }
          render();
        };
      });
    }
  }

  async function open(id) {
    const book = books().find((b) => b.id === id);
    if (!book) return;
    try {
      await Reader.open(id);
    } catch (e) {
      toast('打开失败：' + e.message);
    }
  }

  function contextMenu(e, id) {
    const book = books().find((b) => b.id === id);
    if (!book) return;
    const items = [
      { label: '打开', fn: () => open(id) },
      { label: book.favorite ? '取消收藏' : '加入收藏', fn: () => toggleFavorite(id) },
      { label: '标签…', fn: () => App.showTagEditor(id) },
      { label: '加入合集…', fn: () => App.showCollectionPicker(id) },
      { sep: true },
      { label: '书籍信息', fn: () => App.showBookInfo(id) },
      { label: '在文件夹中显示', fn: () => api.revealBook(id) },
      { sep: true },
      { label: '从书架移除', danger: true, fn: () => remove(id) }
    ];
    const menu = $('#ctx-menu');
    menu.innerHTML = items.map((it, i) => it.sep ? '<div class="sep"></div>' :
      '<button data-i="' + i + '" class="' + (it.danger ? 'danger' : '') + '">' + esc(it.label) + '</button>').join('');
    menu.classList.remove('hidden');
    const w = 200, h = items.length * 34;
    menu.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + 'px';
    $$('#ctx-menu button').forEach((b) => {
      b.onclick = () => { menu.classList.add('hidden'); items[Number(b.dataset.i)].fn(); };
    });
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target)) { menu.classList.add('hidden'); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 10);
  }

  async function toggleFavorite(id) {
    const book = books().find((b) => b.id === id);
    if (!book) return;
    book.favorite = !book.favorite;
    await api.saveDoc('library', S.library);
    render();
  }

  async function remove(id) {
    const book = books().find((b) => b.id === id);
    if (!book) return;
    if (!confirm('从书架移除《' + (book.title || '这本书') + '》？\n本机文件会被删除，同步时云端也会移除。')) return;
    const lib = await api.removeBook(id);
    S.library.books = lib.books;
    S.library.deleted = lib.deleted;
    render();
    toast('已移除');
  }

  async function importFiles() {
    const btn = $('#btn-import');
    btn.disabled = true; btn.textContent = '导入中…';
    try {
      const res = await api.importDialog();
      if (res && !res.canceled) await handleImportResult(res);
    } catch (e) {
      toast('导入失败：' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '导入书籍';
    }
  }

  async function handleImportResult(res) {
    const imported = (res && res.imported) || [];
    const errors = (res && res.errors) || [];
    if (!imported.length && !errors.length) return;
    for (const item of imported) {
      if (item.duplicate) continue;
      await parseAndSave(item.id);
    }
    await reloadLibrary();
    render();
    if (errors.length) toast(errors[0], 4000);
    else toast(imported.length > 1 ? ('已导入 ' + imported.length + ' 本书') : '已导入《' + (imported[0].title || '') + '》');
    if (imported.length === 1 && !errors.length) open(imported[0].id);
  }

  async function parseAndSave(id) {
    try {
      const meta = await api.meta(id);
      if (!meta) return;
      if (meta.type === 'pdf') {
        meta.title = meta.title || 'PDF 文档';
        await api.saveMeta(id, meta);
        const b = books().find((x) => x.id === id);
        if (b) b.title = meta.title;
        return;
      }
      const parsed = await Reader.parseStructure(id);
      Object.assign(meta, parsed);
      await api.saveMeta(id, meta);
      // 刚导入的书可能还没进内存里的书库（主进程刚写完 library.json），先重新读一次
      let b = books().find((x) => x.id === id);
      if (!b) { await reloadLibrary(); b = books().find((x) => x.id === id); }
      if (b) {
        b.title = parsed.title || b.title;
        b.author = parsed.author || '';
        b.cover = parsed.cover || '';
        b.coverData = parsed.coverData || '';
        b.language = parsed.language || '';
        b.chapters = parsed.chapterCount || 0;
        await api.saveDoc('library', S.library);
      }
    } catch (e) {
      toast('解析《' + id + '》失败：' + e.message, 4000);
    }
  }


  /* 老书补封面：早期导入的书记录里没有 cover，这里在后台重解析一遍首屏图片 */
  let rescanDone = false;
  async function rescanCovers() {
    if (rescanDone) return;
    rescanDone = true;
    const targets = books().filter((b) => b.type === 'epub' && !b.cover && !b.coverData && !b.coverScanned);
    if (!targets.length) return;
    let changed = 0;
    for (const b of targets) {
      try {
        await parseAndSave(b.id);
        const nb = books().find((x) => x.id === b.id);
        if (nb) {
          nb.coverScanned = true;
          if (nb.cover || nb.coverData) changed++;
        }
        const meta = await api.meta(b.id);
        if (meta) { meta.coverScanned = true; await api.saveMeta(b.id, meta); }
      } catch (e) { /* 解析失败就跳过这本书 */ }
    }
    if (changed) { await api.saveDoc('library', S.library); render(); }
  }

  async function reloadLibrary() {
    const lib = await api.loadDoc('library');
    if (lib) {
      const prev = new Map(books().map((b) => [b.id, b]));
      lib.books = lib.books || [];
      for (const b of lib.books) {
        const old = prev.get(b.id);
        if (!old) continue;
        for (const k of ['title', 'author', 'cover', 'coverData', 'language', 'chapters']) {
          if (!b[k] && old[k]) b[k] = old[k];
        }
      }
      S.library = lib;
    }
    S.library.books = S.library.books || [];
    S.library.collections = S.library.collections || [];
    await api.saveDoc('library', S.library);
  }

  function init() {
    $('#btn-import').onclick = importFiles;
    $('#btn-import-2').onclick = importFiles;
    $$('.side-item[data-shelf]').forEach((b) => {
      b.onclick = () => { S.shelf = b.dataset.shelf; S.collectionId = null; S.tag = null; render(); };
    });
    $('#sort').onchange = (e) => { S.sort = e.target.value; render(); };
    $('#view-toggle').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      S.viewMode = b.dataset.mode;
      $$('#view-toggle button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
    $('#lib-search').oninput = debounce((e) => { S.search = e.target.value; render(); }, 160);

    // 拖拽导入
    ['dragover', 'drop'].forEach((ev) => {
      document.addEventListener(ev, async (e) => {
        e.preventDefault();
        if (ev !== 'drop') return;
        const files = Array.from(e.dataTransfer.files || []);
        const paths = files.map((f) => { try { return api.getPathForFile(f); } catch (err) { return f.path; } }).filter(Boolean);
        if (!paths.length) return;
        toast('正在导入 ' + paths.length + ' 个文件…');
        const res = await api.importPaths(paths);
        await handleImportResult(res);
      });
    });
  }

  return { init, render, open, reload: reloadLibrary, parseAndSave, rescanCovers, toggleFavorite, remove, visibleBooks, handleImportResult, collectionMenu: null };
})();
