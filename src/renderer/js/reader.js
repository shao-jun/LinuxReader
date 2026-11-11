'use strict';
/* 阅读引擎：EPUB 解析、翻页/滚动排版、高亮笔记、目录、搜索、朗读定位 */
const Reader = (() => {
  const api = window.linuxreader;

  const R = {
    id: null, meta: null, ann: { version: 1, items: [], bookmarks: [] },
    chapterIndex: 0, page: 0, pages: 1, mode: 'paged',
    doc: null, win: null, token: 0, ready: false,
    chapters: [], toc: [], spineHrefs: [],
    layout: { W: 0, H: 0, pad: 0, pageW: 0 },
    nodes: null, nodesToken: -1,
    returnLoc: null, selRange: null, selOffsets: null, seg: [],
    textCache: new Map(), searchIndex: null,
    saveTimer: null, resizeTimer: null, openedAt: 0
  };

  const stage = () => $('#reader-stage');
  const frame = () => $('#book-frame');

  /* ============================ 结构解析 ============================ */
  function ln(el, name) { return el && el.localName && el.localName.toLowerCase() === name.toLowerCase(); }
  function findAll(root, name) {
    const out = [];
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (ln(all[i], name)) out.push(all[i]);
    return out;
  }
  function first(root, name) { const f = findAll(root, name); return f.length ? f[0] : null; }
  function textOf(el) { return el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : ''; }

  function resolveUrl(baseDir, href) {
    if (!href) return '';
    href = href.split('#')[0];
    try { href = decodeURIComponent(href); } catch (e) {}
    const parts = (baseDir ? baseDir.split('/') : []).concat(href.split('/'));
    const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop(); else out.push(p);
    }
    return out.join('/');
  }

  async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('读取失败 ' + r.status + ': ' + url);
    return r.text();
  }

  function parseXml(str) {
    const d = new DOMParser().parseFromString(str, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) {
      return new DOMParser().parseFromString(str, 'text/html');
    }
    return d;
  }

  function srcUrl(id, rel) {
    return 'linuxreader://local/book/' + id + '/src/' + rel.split('/').map(encodeURIComponent).join('/');
  }

  /**
   * 首屏如果是一整页图片（扫描封面、自制封面经常这么放：一个只有 <img> 的 xhtml，
   * 或者 <svg> 里裹一张 <image>），就把这张图取出来当封面，别让书库里显示占位色块。
   */
  function imageOfPage(doc, baseDir) {
    const imgs = [];
    for (const el of findAny(doc, ['img', 'image'])) {
      const src = el.getAttribute('src') || el.getAttribute('xlink:href')
        || el.getAttributeNS && el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!src) continue;
      if (/^data:/i.test(src)) { imgs.push({ src, data: true }); continue; }
      if (/^(https?:)?\/\//i.test(src)) continue;
      imgs.push({ src: resolveUrl(baseDir, src), data: false });
    }
    return imgs;
  }

  function findAny(root, names) {
    const out = [];
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const n = (all[i].localName || '').toLowerCase();
      if (names.includes(n)) out.push(all[i]);
    }
    return out;
  }

  async function coverFromFirstPage(id, spineItems) {
    const order = spineItems || [];
    for (const item of order.slice(0, 2)) {
      try {
        const doc = parseXml(await fetchText(srcUrl(id, item.href)));
        const body = first(doc, 'body') || doc.documentElement;
        if (!body) continue;
        // 页面上还有成段正文，就不是纯封面页
        const words = textOf(body).replace(/\s/g, '');
        if (words.length > 140) continue;
        const imgs = imageOfPage(doc, item.href.includes('/') ? item.href.slice(0, item.href.lastIndexOf('/')) : '');
        if (!imgs.length) continue;
        return imgs[0].src;
      } catch (e) { /* 换下一章试试 */ }
    }
    return '';
  }

  /** 解析 EPUB 结构（container.xml → OPF → 目录），返回可写入 meta.json 的对象 */
  async function parseStructure(id) {
    const container = parseXml(await fetchText(srcUrl(id, 'META-INF/container.xml')));
    const rootfile = first(container, 'rootfile');
    if (!rootfile) throw new Error('EPUB 缺少 container.xml 里的 rootfile');
    const opfPath = rootfile.getAttribute('full-path');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const opf = parseXml(await fetchText(srcUrl(id, opfPath)));

    const metaEls = first(opf, 'metadata') || opf;
    const get = (name) => textOf(first(metaEls, name));
    const title = get('title') || '未命名';
    const author = get('creator') || '';
    const language = get('language') || '';
    const publisher = get('publisher') || '';
    const description = get('description') || '';
    const identifier = get('identifier') || '';

    const manifest = {};
    for (const item of findAll(first(opf, 'manifest') || opf, 'item')) {
      manifest[item.getAttribute('id')] = {
        href: resolveUrl(opfDir, item.getAttribute('href')),
        type: item.getAttribute('media-type') || '',
        props: item.getAttribute('properties') || ''
      };
    }
    const spineEl = first(opf, 'spine');
    const spine = [];
    for (const ref of findAll(spineEl || opf, 'itemref')) {
      const it = manifest[ref.getAttribute('idref')];
      if (!it) continue;
      if (!/html|xml/.test(it.type) && !/\.x?html?$/i.test(it.href)) continue;
      spine.push({ href: it.href, id: ref.getAttribute('idref'), linear: ref.getAttribute('linear') !== 'no' });
    }
    const allSpine = spine.slice();
    // 封面页通常 linear="no"，不参与正文顺序（封面仍由 cover 字段提供）
    const linearSpine = spine.filter((s) => s.linear);
    if (linearSpine.length) { spine.length = 0; linearSpine.forEach((s) => spine.push(s)); }
    if (!spine.length) throw new Error('EPUB 正文为空（spine 未找到）');

    // 封面
    let cover = '';
    let coverData = '';
    const metaCover = findAll(metaEls, 'meta').find((m) => (m.getAttribute('name') || '') === 'cover');
    if (metaCover && manifest[metaCover.getAttribute('content')]) cover = manifest[metaCover.getAttribute('content')].href;
    if (!cover) {
      const propCover = Object.values(manifest).find((m) => /cover-image/.test(m.props));
      if (propCover) cover = propCover.href;
    }
    if (!cover) {
      const guess = Object.values(manifest).find((m) => /^image\//.test(m.type) && /cover/i.test(m.href));
      if (guess) cover = guess.href;
    }
    if (!cover) {
      const fromPage = await coverFromFirstPage(id, allSpine);
      if (fromPage) {
        if (/^data:/i.test(fromPage)) { cover = ''; coverData = fromPage; }
        else cover = fromPage;
      }
    }

    // 目录：优先 EPUB3 nav，回落 NCX
    let toc = [];
    const navItem = Object.values(manifest).find((m) => /nav/.test(m.props));
    const ncxId = spineEl && spineEl.getAttribute('toc');
    const ncxItem = (ncxId && manifest[ncxId]) || Object.values(manifest).find((m) => /ncx/.test(m.type) || /\.ncx$/i.test(m.href));

    const hrefIndex = (href) => {
      const clean = resolveUrl('', href.split('#')[0]);
      // spine href 相对 opf 目录；TOC href 也相对 opf 目录
      let idx = spine.findIndex((s) => s.href === clean);
      if (idx < 0) idx = spine.findIndex((s) => s.href.endsWith('/' + clean) || clean.endsWith('/' + s.href));
      return idx;
    };

    if (navItem) {
      try {
        const nav = parseXml(await fetchText(srcUrl(id, navItem.href)));
        const navs = findAll(nav, 'nav');
        const tocNav = navs.find((n) => /toc/.test((n.getAttribute('epub:type') || n.getAttribute('type') || n.getAttribute('role') || ''))) || navs[0];
        if (tocNav) {
          const walk = (ol, level) => {
            for (const li of Array.from(ol.children || [])) {
              if (!ln(li, 'li')) continue;
              const a = Array.from(li.children).find((c) => ln(c, 'a'));
              const sub = Array.from(li.children).find((c) => ln(c, 'ol'));
              if (a) {
                const idx = hrefIndex(a.getAttribute('href') || '');
                toc.push({ label: textOf(a) || '未命名章节', href: resolveUrl(opfDir, a.getAttribute('href') || ''), level, chapter: idx });
              }
              if (sub) walk(sub, level + 1);
            }
          };
          const topOl = Array.from(tocNav.children).find((c) => ln(c, 'ol')) || tocNav;
          walk(topOl, 0);
        }
      } catch (e) { /* 忽略，用 NCX */ }
    }
    if (!toc.length && ncxItem) {
      try {
        const ncx = parseXml(await fetchText(srcUrl(id, ncxItem.href)));
        const navMap = first(ncx, 'navMap');
        const walk = (parent, level) => {
          for (const child of Array.from(parent.children || [])) {
            if (!ln(child, 'navPoint')) continue;
            const label = textOf(first(child, 'navLabel') ? first(first(child, 'navLabel'), 'text') : null) || '未命名章节';
            const content = first(child, 'content');
            const src = content ? content.getAttribute('src') : '';
            toc.push({ label, href: resolveUrl(opfDir, src), level, chapter: hrefIndex(src) });
            walk(child, level + 1);
          }
        };
        if (navMap) walk(navMap, 0);
      } catch (e) { /* 无目录 */ }
    }
    if (!toc.length) {
      toc = spine.map((s, i) => ({ label: '第 ' + (i + 1) + ' 节', href: s.href, level: 0, chapter: i }));
    }

    return {
      id, type: 'epub', title, author, language, publisher, description, identifier,
      cover: cover ? resolveUrl('', cover) : '', coverData, opfPath, spine, toc,
      chapterCount: spine.length
    };
  }

  /* ============================ 打开 / 关闭 ============================ */
  async function open(id) {
    const book = (S.library.books || []).find((b) => b.id === id);
    if (!book) return toast('找不到这本书');
    const ensure = await api.ensureSrc(id);
    const meta = await api.meta(id);
    if (!meta) return toast('书籍信息缺失');
    R.id = id;
    R.meta = meta;
    R.chapters = meta.spine || [];
    R.toc = meta.toc || [];
    R.ann = await api.annotations(id) || { version: 1, items: [], bookmarks: [] };
    R.ann.items = R.ann.items || [];
    R.ann.bookmarks = R.ann.bookmarks || [];
    R.textCache.clear();
    R.searchIndex = null;
    R.nodes = null;
    R.nodesToken = -1;
    R.returnLoc = null;
    R.mode = S.settings.mode || 'paged';
    R.openedAt = Date.now();

    $('#view-library').classList.remove('active');
    $('#view-reader').classList.add('active');
    $('#r-title').textContent = meta.title || book.title || '未命名';
    $('#r-title').title = (meta.author ? meta.author + ' · ' : '') + (meta.title || '');
    hideJumpBack();
    hideSelMenu();

    if (meta.type === 'pdf') return showPdf(meta);

    if (!R.chapters.length) {
      const parsed = await parseStructure(id);
      Object.assign(meta, parsed);
      await api.saveMeta(id, meta);
      R.meta = meta; R.chapters = meta.spine; R.toc = meta.toc;
    }
    const prog = book.progress || {};
    R.settings_dirty = true;
    await loadChapter(Math.min(prog.chapter || 0, R.chapters.length - 1), prog.offset || 0, { silent: true });
    R.ready = true;
    renderToc();
    renderNotes();
    renderBookmarks();
    updateBookmarkBtn();
    applyModeUi();
    // 打开书后默认展开左侧栏（目录 / 书签 / 高亮标记 三个 tab）
    if (S.settings.sideOpen !== false) setSide(sideTab || 'toc', true);
    touchLibrary();
  }

  function showPdf(meta) {
    frame().classList.add('hidden');
    const host = $('#pdf-host');
    host.classList.remove('hidden');
    host.innerHTML = '<div class="pdf-note"><span>' + esc(meta.title || '') + ' · PDF（原样显示）</span>' +
      '<span>翻页与缩放在阅读区内完成</span></div>' +
      '<embed src="linuxreader://local/book/' + R.id + '/file" type="application/pdf">';
    $('#rb-chapter').textContent = 'PDF';
    $('#rb-pages').textContent = '';
    $('#progress').value = 0;
  }

  function close() {
    flushProgress();
    $('#view-reader').classList.remove('active');
    $('#view-library').classList.add('active');
    hideSelMenu(); hideNotePop(); hideJumpBack();
    Karaoke.stop();
    R.ready = false;
    R.id = null;
    frame().src = 'about:blank';
    const host = $('#pdf-host');
    host.classList.add('hidden'); host.innerHTML = '';
    frame().classList.remove('hidden');
    if (typeof Library !== 'undefined') Library.render();
  }

  /* ============================ 章节加载 ============================ */
  function chapterUrl(i) { return srcUrl(R.id, R.chapters[i].href); }

  function waitFrameLoad() {
    return new Promise((resolve, reject) => {
      const f = frame();
      const timer = setTimeout(() => { cleanup(); reject(new Error('内容加载超时')); }, 15000);
      function onload() { cleanup(); resolve(); }
      function cleanup() { clearTimeout(timer); f.removeEventListener('load', onload); }
      f.addEventListener('load', onload);
    });
  }

  async function loadScroll(index, offset, opts = {}) {
    if (!R.chapters.length) return;
    index = Math.max(0, Math.min(R.chapters.length - 1, index));
    const token = ++R.token;
    const f = frame();
    const p = waitFrameLoad();
    f.src = chapterUrl(index);
    try { await p; } catch (e) { toast('这一节加载失败'); return; }
    if (token !== R.token) return;
    R.chapterIndex = index;
    R.doc = f.contentDocument;
    R.win = f.contentWindow;
    R.nodes = null; R.nodesToken = -1;
    R.seg = [];
    if (!R.doc || !R.doc.body) return;
    applyStyles();
    await waitAssets();
    if (token !== R.token) return;
    wrapSeg(index);
    R.scrollTarget = null;
    if (R.scrollRaf) { cancelAnimationFrame(R.scrollRaf); R.scrollRaf = 0; }
    layout();
    applyHighlights();
    const sEl0 = scEl(); if (sEl0) sEl0.scrollTop = 0;
    if (offset) scrollToOffsetNow(toGlobalOff(index, offset));
    bindFrameEvents();
    updateHeader();
    updateProgressUi();
    appendChapter(index + 1);
    if (opts.markRead !== false) touchLibrary();
  }

  async function loadChapter(index, offset, opts = {}) {
    if (R.mode === 'scroll') return loadScroll(index, offset, opts);
    return loadPageChapter(index, offset, opts);
  }

  async function loadPageChapter(index, offset, opts = {}) {
    if (!R.chapters.length) return;
    index = Math.max(0, Math.min(R.chapters.length - 1, index));
    const token = ++R.token;
    const f = frame();
    const p = waitFrameLoad();
    f.src = chapterUrl(index);
    try { await p; } catch (e) { toast('这一节加载失败'); return; }
    if (token !== R.token) return;

    R.chapterIndex = index;
    R.doc = f.contentDocument;
    R.win = f.contentWindow;
    R.nodes = null; R.nodesToken = -1;
    if (!R.doc || !R.doc.body) return;

    applyStyles();
    await waitAssets();
    if (token !== R.token) return;
    R.scrollTarget = null;
    if (R.scrollRaf) { cancelAnimationFrame(R.scrollRaf); R.scrollRaf = 0; }
    layout();
    applyHighlights();
    const target = offset ? pageOfOffset(offset) : 0;
    goPage(target, true);
    updateHeader();
    updateProgressUi();
    bindFrameEvents();
    if (opts.markRead !== false) touchLibrary();
  }

  function waitAssets() {
    const doc = R.doc;
    const imgs = Array.from(doc.images || []).filter((i) => !i.complete);
    const imgPromise = imgs.length
      ? Promise.all(imgs.map((i) => new Promise((res) => { i.addEventListener('load', res, { once: true }); i.addEventListener('error', res, { once: true }); setTimeout(res, 2500); })))
      : Promise.resolve();
    const fontPromise = doc.fonts && doc.fonts.ready ? Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
    return Promise.all([imgPromise, fontPromise]);
  }

  function applyStyles() {
    const doc = R.doc;
    const t = themeOf(S.settings.theme);
    const th = { paper: t.paper, text: t.text };
    const fs = S.settings.fontSize;
    const lh = S.settings.lineHeight;
    const font = FONT_STACKS[S.settings.font] || FONT_STACKS.serif;
    const weight = Number(S.settings.weight) || 400;
    const ls = Number(S.settings.letterSpacing) || 0;
    const ws = Number(S.settings.wordSpacing) || 0;
    let st = doc.getElementById('linuxreader-reader-style');
    if (!st) { st = doc.createElement('style'); st.id = 'linuxreader-reader-style'; (doc.head || doc.documentElement).appendChild(st); }
    st.textContent = `
      :root { --linuxreader-paper:${th.paper}; --linuxreader-text:${th.text}; }
      html { background:${th.paper} !important; }
      body { background:${th.paper} !important; color:${th.text} !important;
             font-family:${font} !important; font-size:${fs}px !important; line-height:${lh} !important;
             font-weight:${weight} !important; letter-spacing:${ls}px !important; word-spacing:${ws}px !important;
             -webkit-font-smoothing:antialiased; }
      html { color:${th.text} !important; }
      body, body p, body div, body span, body li, body td, body th, body blockquote, body dd, body dt, body a, body figcaption, body h1, body h2, body h3, body h4, body h5, body h6 {
             font-family:${font} !important; }
      /* 子元素一律跟随正文色；只有这里不含 body 本身，否则 body 会去继承 html 的默认黑 */
      body *:not(a) { color:inherit !important; }
      section.lr-seg + section.lr-seg { margin-top:2.6em; padding-top:1.4em; border-top:1px solid rgba(128,128,128,.22); }
      body p, body li, body dd, body blockquote { font-weight:${weight} !important; letter-spacing:${ls}px !important; word-spacing:${ws}px !important; }
      body b, body strong, body h1, body h2, body h3 { font-weight:${Math.min(900, weight + 200)} !important; }
      body h1, body h2, body h3 { line-height:1.4 !important; }
      body img, body svg, body video { max-width:100% !important; height:auto !important; }
      body a { color:${th.text} !important; text-decoration:underline; text-decoration-color:rgba(128,128,128,.4); }
      body pre, body code { font-family:"Source Code Pro",Menlo,monospace !important; white-space:pre-wrap; }
      ::selection { background: rgba(226,96,60,.22); }
      ::highlight(hl-yellow) { background-color: rgba(255,214,10,.45); color: inherit; }
      ::highlight(hl-green) { background-color: rgba(120,205,110,.42); color: inherit; }
      ::highlight(hl-blue) { background-color: rgba(110,175,255,.42); color: inherit; }
      ::highlight(hl-pink) { background-color: rgba(255,140,180,.42); color: inherit; }
      ::highlight(hl-underline) { text-decoration: underline 2px solid #e2603c; }
      ::highlight(hl-note) { text-decoration: underline dotted #e2603c; }
      ::highlight(search-hit) { background-color: rgba(255,193,7,.55); color: inherit; }
      ::highlight(current-line) { background-color: rgba(226,96,60,.16); }
    `;
    // 段落首行缩进（中文排版），仅在书籍本身没设置时兜底
    const ps = doc.querySelectorAll('p');
    let hasIndent = false;
    for (const p of ps) { if (getComputedStyle(p).textIndent !== '0px') { hasIndent = true; break; } }
    if (!hasIndent) {
      const st2 = doc.createElement('style');
      st2.id = 'linuxreader-indent';
      st2.textContent = 'body p { text-indent: 2em; margin: 0 0 .55em; } body p:first-of-type { text-indent: 2em; }';
      (doc.head || doc.documentElement).appendChild(st2);
    }
  }

  /* ============================ 排版 ============================ */
  function layout() {
    const doc = R.doc, body = doc.body, html = doc.documentElement;
    const st = stage();
    const W = Math.max(320, st.clientWidth);
    const H = Math.max(240, st.clientHeight);
    const padPct = Math.min(16, Math.max(2, Number(S.settings.margin) || 6));
    const pad = Math.round(Math.min(140, Math.max(20, W * padPct / 100)));
    const t = themeOf(S.settings.theme);
    const th = { paper: t.paper };
    R.layout.W = W; R.layout.H = H; R.layout.pad = pad;

    html.style.cssText = 'margin:0;padding:0;height:' + H + 'px;width:' + W + 'px;overflow:hidden;background:' + th.paper;
    if (R.mode === 'paged') {
      // 正文一栏不超过 760px，其余作为页边距；每页步长恒为 W
      const cw = Math.max(280, Math.min(W - 2 * pad, 760));
      const M = Math.round((W - cw) / 2);
      const gap = W - cw;
      const padY = Math.round(H * 0.055);
      body.style.cssText = [
        'box-sizing:border-box',
        'width:' + cw + 'px', 'height:' + H + 'px',
        'column-width:' + cw + 'px', 'column-gap:' + gap + 'px', 'column-fill:auto',
        // 多栏溢出必须可见，html 上的 overflow:hidden 才是分页的裁剪面
        'overflow:visible', 'background:' + th.paper
      ].join(';');
      // 书籍自带的 body{margin:0 !important} 会盖掉行内边距，这里必须用 important 才能居中
      body.style.setProperty('margin', '0 0 0 ' + M + 'px', 'important');
      body.style.setProperty('padding', padY + 'px 0', 'important');
      R.layout.pageW = W;
      R.layout.M = M;
      R.layout.padY = padY;
      const SW = Math.max(body.scrollWidth, html.scrollWidth);
      R.pages = Math.max(1, Math.ceil((SW - M) / W));
    } else {
      const cw = Math.min(W - 2 * pad, 720);
      body.style.cssText = [
        'width:' + cw + 'px', 'height:auto', 'overflow:visible', 'background:' + th.paper
      ].join(';');
      body.style.setProperty('display', 'block', 'important');
      body.style.setProperty('margin', '0 auto', 'important');
      body.style.setProperty('padding', Math.round(pad * 0.7) + 'px 0 ' + Math.round(H * 0.4) + 'px', 'important');
      html.style.overflowY = 'auto';
      R.layout.pageW = cw;
      R.layout.M = 0;
      R.layout.padY = Math.round(pad * 0.7);
      R.pages = 1;
    }
  }

  /* ============================ 平滑滚动 ============================ */
  const smoothOn = () => S.settings.smooth !== false;
  const ANCHOR_Y = 90;                 // 定位锚点：视口顶部往下 90px 这一行

  function cancelAnim(el) {
    if (el && el.__anim) { cancelAnimationFrame(el.__anim.raf); el.__anim = null; }
  }

  function animateProp(el, prop, to, dur) {
    cancelAnim(el);
    const from = el[prop];
    const d = to - from;
    if (Math.abs(d) < 1.5) { el[prop] = to; return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);          // easeOutCubic
      el[prop] = from + d * e;
      if (k < 1) el.__anim = { raf: requestAnimationFrame(step) };
      else { el.__anim = null; el[prop] = to; }
    };
    el.__anim = { raf: requestAnimationFrame(step) };
  }

  /* 有的书（CSS 里 html/body 的 overflow 组合）滚动容器是 body 而不是 html，
     直接读写 documentElement.scrollTop 会一直是 0，所以统一走 scrollingElement */
  function scEl(docu) { const d = docu || R.doc; return (d && (d.scrollingElement || d.documentElement)) || null; }

  // 滚动模式下用目标位置 + 每帧插值，滚轮/空格都走得顺滑
  // 滚动模式：滚到本章末尾继续滚就进下一章，往回滚到开头则回上一章末尾
  function scrollStep(dy) {
    if (!R.doc) return;
    const el = scEl();
    const max = Math.max(0, el.scrollHeight - R.layout.H);
    const base = (R.scrollTarget == null) ? el.scrollTop : R.scrollTarget;
    if (dy > 0 && base >= max - 2) {
      if (segReady() && lastSegCh() < R.chapters.length - 1) { R.scrollTarget = null; appendChapter(lastSegCh() + 1); return; }
      if (!segReady() && R.chapterIndex < R.chapters.length - 1) { R.scrollTarget = null; loadChapter(R.chapterIndex + 1, 0); return; }
      smoothScrollTo(max);
      return;
    }
    if (dy < 0 && base <= 2) {
      if (segReady() && firstSegCh() > 0) { R.scrollTarget = null; prependChapter(firstSegCh() - 1); return; }
      if (!segReady() && R.chapterIndex > 0) { R.scrollTarget = null; loadChapter(R.chapterIndex - 1, 999999); return; }
      smoothScrollTo(0);
      return;
    }
    smoothScrollBy(dy);
  }
  function smoothScrollBy(dy) {
    if (!R.doc) return;
    const el = scEl();
    const max = Math.max(0, el.scrollHeight - R.layout.H);
    const base = (R.scrollTarget == null) ? el.scrollTop : R.scrollTarget;
    R.scrollTarget = Math.max(0, Math.min(max, base + dy));
    if (R.scrollRaf) return;
    const step = () => {
      const cur = el.scrollTop;
      const d = R.scrollTarget - cur;
      if (Math.abs(d) < 0.8) {
        el.scrollTop = R.scrollTarget;
        R.scrollRaf = 0;
        R.scrollTarget = null;
        updateProgressUi(); scheduleSave();
        return;
      }
      el.scrollTop = cur + d * 0.24;
      R.scrollRaf = requestAnimationFrame(step);
    };
    R.scrollRaf = requestAnimationFrame(step);
  }

  function smoothScrollTo(top) {
    if (!R.doc) return;
    const el = scEl();
    const max = Math.max(0, el.scrollHeight - R.layout.H);
    R.scrollTarget = Math.max(0, Math.min(max, top));
    if (R.scrollRaf) return;
    const step = () => {
      const cur = el.scrollTop;
      const d = R.scrollTarget - cur;
      if (Math.abs(d) < 0.8) { el.scrollTop = R.scrollTarget; R.scrollRaf = 0; R.scrollTarget = null; updateProgressUi(); return; }
      el.scrollTop = cur + d * 0.28;
      R.scrollRaf = requestAnimationFrame(step);
    };
    R.scrollRaf = requestAnimationFrame(step);
  }

  /* ======================== 翻页动效：滑动 / 翻页 / 淡入淡出 ======================== */
  function turnEffect(x, dir) {
    const html = R.doc.documentElement;
    const fx = S.settings.transition || 'slide';
    if (!smoothOn() || fx === 'scroll') {
      cancelAnim(html); html.scrollLeft = x;
      return;
    }
    if (fx === 'fade') {
      const st = stage();
      st.style.transition = 'opacity .13s ease';
      st.style.opacity = '.2';
      setTimeout(() => {
        cancelAnim(html);
        html.scrollLeft = x;
        st.style.opacity = '1';
      }, 125);
      return;
    }
    if (fx === 'page') {
      const f = $('#book-frame');
      if (!f) { animateProp(html, 'scrollLeft', x, 200); return; }
      const d = dir || (x > html.scrollLeft ? 1 : -1);
      f.style.transition = 'transform .3s cubic-bezier(.32,.72,.28,1), box-shadow .3s ease';
      f.style.transformOrigin = d > 0 ? 'left center' : 'right center';
      f.style.boxShadow = d > 0 ? '-14px 0 28px rgba(0,0,0,.16)' : '14px 0 28px rgba(0,0,0,.16)';
      f.style.transform = 'perspective(1800px) rotateY(' + (d > 0 ? -12 : 12) + 'deg) translateX(' + (d > 0 ? 2.4 : -2.4) + '%)';
      setTimeout(() => { cancelAnim(html); html.scrollLeft = x; }, 135);
      setTimeout(() => { f.style.transform = ''; f.style.boxShadow = ''; }, 175);
      return;
    }
    animateProp(html, 'scrollLeft', x, 215);
  }

  function goPage(page, silent) {
    if (R.mode === 'scroll') return;
    const prev = R.page;
    R.page = Math.max(0, Math.min(R.pages - 1, page | 0));
    const x = R.page * R.layout.pageW;
    if (silent) {
      const html = R.doc.documentElement;
      cancelAnim(html);
      html.scrollLeft = x;
      if (Math.abs(html.scrollLeft - x) > 2 && R.doc.body.scrollLeft !== undefined) R.doc.body.scrollLeft = x;
    } else {
      turnEffect(x, R.page >= prev ? 1 : -1);
    }
    if (!silent) { updateProgressUi(); scheduleSave(); }
    // 页首字符作为锚点：用户翻页时更新，改排版时只认它，避免一页页往回退
    markPagedAnchor(silent ? 0 : 360);
  }

  function goOffsetExact(off) {
    const pt = pointOfOffset(off);
    if (!pt) return;
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset); r.setEnd(pt.node, pt.offset);
      const html = R.doc.documentElement;
      const absX = r.getBoundingClientRect().left + html.scrollLeft;
      // 必须落在页网格上：只有 scrollLeft = q*W 时当前页正好是「页边距 + 一栏 + 页边距」，
      // 否则上一栏的尾巴会露出来，下次取锚点就会抓到前面的字，一页页往回退
      const M = R.layout.M || 0, W = R.layout.pageW;
      const q = Math.max(0, Math.min(R.pages - 1, Math.floor(Math.max(0, absX) / W)));
      cancelAnim(html);
      html.scrollLeft = q * W;
      R.page = q;
    } catch (e) {}
  }
  function pageOfOffset(off) {
    if (!R.doc) return 0;
    if (R.mode === 'scroll') return 0;
    const pt = pointOfOffset(off);
    if (!pt) return 0;
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset);
      r.setEnd(pt.node, Math.min(pt.node.nodeValue.length, pt.offset + 1));
      const rect = r.getBoundingClientRect();
      const absX = rect.left + R.doc.documentElement.scrollLeft;
      return Math.max(0, Math.min(R.pages - 1, Math.floor(absX / R.layout.pageW)));
    } catch (e) { return 0; }
  }

  function textNodes() {
    if (R.nodes && R.nodesToken === R.token) return R.nodes;
    const nodes = [];
    let total = 0;
    if (R.doc && R.doc.body) {
      const w = R.doc.createTreeWalker(R.doc.body, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = w.nextNode())) {
        const len = n.nodeValue ? n.nodeValue.length : 0;
        if (!len) continue;
        nodes.push({ node: n, start: total, end: total + len });
        total += len;
      }
    }
    R.nodes = { list: nodes, total };
    R.nodesToken = R.token;
    return R.nodes;
  }

  function pointOfOffset(off) {
    const { list, total } = textNodes();
    if (!list.length) return null;
    off = Math.max(0, Math.min(total, off | 0));
    let lo = 0, hi = list.length - 1, best = list[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const it = list[mid];
      if (it.start <= off) { best = it; lo = mid + 1; } else { hi = mid - 1; }
    }
    return { node: best.node, offset: Math.min(best.node.nodeValue.length, Math.max(0, off - best.start)) };
  }

  function offsetOfPoint(node, offset) {
    if (!R.doc) return 0;
    try {
      const r = R.doc.createRange();
      r.selectNodeContents(R.doc.body);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch (e) { return 0; }
  }

  // 记录“当前正在读的那一行”及其在视口里的像素位置，重排后按像素还原，避免串行漂移
  function markPagedAnchor(delay) {
    R.pagedAnchor = null;
    const run = () => { if (R.doc) R.pagedAnchor = offsetAtViewportStart(); };
    if (delay) setTimeout(run, delay); else run();
  }

  // 分页模式以“段落开头”为锚点：同一段落始终停在页首，重排不会一页页往前后跑
  function paragraphStartOf(off) {
    const pt = pointOfOffset(off);
    if (!pt) return off;
    let n = pt.node;
    while (n && n.nodeType !== 1) n = n.parentNode;
    while (n && n.parentNode && n.parentNode !== R.doc.body) {
      if (/^(P|DIV|LI|BLOCKQUOTE|SECTION|ARTICLE|H1|H2|H3|H4|H5|H6|DD|DT|TD|FIGCAPTION)$/.test(n.tagName)) break;
      n = n.parentNode;
    }
    if (!n || !R.doc.body.contains(n)) return off;
    try { return offsetOfPoint(n, 0); } catch (e) { return off; }
  }
  function captureAnchor() {
    let off = currentOffset();
    if (R.mode === 'paged') off = (R.pagedAnchor == null) ? paragraphStartOf(off) : R.pagedAnchor;
    const pt = pointOfOffset(off);
    if (!pt) return { off, y: ANCHOR_Y, dx: 0 };
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset); r.setEnd(pt.node, pt.offset);
      const rect = r.getBoundingClientRect();
      return { off, y: rect.top, dx: rect.left };
    } catch (e) { return { off, y: ANCHOR_Y, dx: 0 }; }
  }

  // 分页模式：把锚点那个字放回它在视口里原来的横向位置，重排后正文不会左右跳
  function restoreAnchorX(a) {
    const pt = pointOfOffset(a.off);
    if (!pt) return;
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset); r.setEnd(pt.node, pt.offset);
      const html = R.doc.documentElement;
      const absX = r.getBoundingClientRect().left + html.scrollLeft;
      cancelAnim(html);
      html.scrollLeft = Math.max(0, absX - (a.dx || 0));
      R.page = Math.max(0, Math.min(R.pages - 1, Math.round(html.scrollLeft / R.layout.pageW)));
    } catch (e) {}
  }
  function restoreAnchor(a) {
    if (!a) return;
    const pt = pointOfOffset(a.off);
    if (!pt) return;
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset); r.setEnd(pt.node, pt.offset);
      const el = R.doc.documentElement;
      el.scrollTop = el.scrollTop + r.getBoundingClientRect().top - a.y;
    } catch (e) {}
  }
  // 分页模式取“当前页左上角第一个字”的偏移：多栏里 caretRangeFromPoint 会命中别的栏，
  // 直接按几何位置扫，避免每次重排都往回退一页
  function offsetAtViewportStart() {
    const { list } = textNodes();
    if (!list.length) return 0;
    const sc = R.doc.documentElement.scrollLeft;
    const px = Math.max(0, sc - 1);
    for (const it of list) {
      const node = it.node, len = node.nodeValue.length;
      if (!len) continue;
      for (let i = 0; i < len; i++) {
        try {
          const r = R.doc.createRange();
          r.setStart(node, i); r.setEnd(node, Math.min(len, i + 1));
          const rect = r.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const absL = rect.left + sc;
          if (absL >= px - 1) return it.start + i;
        } catch (e) { break; }
      }
    }
    return 0;
  }
  function currentOffset() {
    if (!R.doc) return 0;
    if (R.mode === 'scroll') {
      const sg = segReady() ? anchorSeg() : null;
      const cw = R.layout.pageW || R.layout.W;
      const x = Math.max(30, Math.min(R.layout.W - 30, (R.layout.W - cw) / 2 + Math.min(cw, 360)));
      const range = R.doc.caretRangeFromPoint ? R.doc.caretRangeFromPoint(x, ANCHOR_Y) : null;
      if (range && R.doc.body.contains(range.startContainer) && (!sg || sg.el.contains(range.startContainer))) {
        // 取到的点必须就在当前这一章的 section 里，否则（点在段间空白/页边/别的章）按比例估
        return offsetOfPoint(range.startContainer, range.startOffset);
      }
      if (sg) {
        const r = sg.el.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (ANCHOR_Y - r.top) / Math.max(1, r.height)));
        return sg.start + Math.round(f * sg.len);
      }
      const { total } = textNodes();
      const sEl = scEl();
      const frac = sEl.scrollTop / Math.max(1, sEl.scrollHeight - R.layout.H);
      return Math.round(frac * total);
    }
    const at = offsetAtViewportStart();
    if (at) return at;
    const { total } = textNodes();
    return Math.round((R.page / Math.max(1, R.pages)) * total);
  }

  function rangeOfOffsets(start, end) {
    if (!R.doc) return null;
    const a = pointOfOffset(start), b = pointOfOffset(end);
    if (!a || !b) return null;
    try {
      const r = R.doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return r;
    } catch (e) { return null; }
  }

  /* ============================ 高亮 ============================ */
  function annsOfChapter(idx) {
    return R.ann.items.filter((a) => a.chapter === idx && !a.deletedAt);
  }

  function applyHighlights(extra) {
    const CSSns = R.win && R.win.CSS;
    if (!CSSns || !CSSns.highlights) return;
    CSSns.highlights.clear();
    const groups = {};
    const chapters = segReady() ? R.seg.map((x) => x.ch) : [R.chapterIndex];
    for (const ch of chapters) {
      const base = toGlobalOff(ch, 0) - (segReady() ? 0 : 0);
      for (const a of annsOfChapter(ch)) {
        const off0 = segReady() ? toGlobalOff(ch, a.start) : a.start;
        const off1 = segReady() ? toGlobalOff(ch, a.end) : a.end;
        const r = rangeOfOffsets(off0, off1);
        if (!r) continue;
        const c = a.color || 'yellow';
        (groups[c] = groups[c] || []).push(r);
        if (a.note && a.note.trim()) (groups['hl-note'] = groups['hl-note'] || []).push(r.cloneRange());
      }
    }
    for (const [name, ranges] of Object.entries(groups)) {
      try { CSSns.highlights.set(name.startsWith('hl-') ? name : 'hl-' + name, new R.win.Highlight(...ranges)); } catch (e) {}
    }
    if (extra && extra.length) {
      try { CSSns.highlights.set('search-hit', new R.win.Highlight(...extra)); } catch (e) {}
    }
  }

  /* ============================ 进度 ============================ */
  function bookPercent() {
    if (!R.doc) return 0;                       // 章节还没加载完时不要炸
    const n = R.chapters.length || 1;
    if (R.mode === 'scroll') {
      const sg = anchorSeg();
      if (sg && sg.el) {
        const r = sg.el.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (ANCHOR_Y - r.top) / Math.max(1, r.height)));
        return Math.min(1, (sg.ch + f) / n);
      }
      const doc = R.doc;
      const sEl = scEl(doc);
      const max = Math.max(1, sEl.scrollHeight - R.layout.H);
      const f = Math.min(1, Math.max(0, sEl.scrollTop / max));
      return Math.min(1, (R.chapterIndex + f) / n);
    }
    return Math.min(1, (R.chapterIndex + (R.page + 1) / R.pages) / n);
  }

  function updateProgressUi() {
    const pctv = bookPercent();
    $('#progress').value = Math.round(pctv * 1000);
    if (R.mode === 'scroll') {
      $('#rb-pages').textContent = pct(pctv) + '%';
    } else {
      $('#rb-pages').textContent = (R.page + 1) + ' / ' + R.pages + '  ·  ' + pct(pctv) + '%';
    }
    const ch = chapterTitle(R.chapterIndex);
    $('#rb-chapter').textContent = ch;
    $('#r-chapter').textContent = ch;
  }

  function chapterTitle(idx) {
    const item = R.toc.filter((t) => t.chapter === idx);
    if (item.length) return item[0].label;
    const near = R.toc.filter((t) => t.chapter <= idx && t.chapter >= 0);
    if (near.length) return near[near.length - 1].label;
    return '第 ' + (idx + 1) + ' 节';
  }

  function updateHeader() {
    $('#r-chapter').textContent = chapterTitle(R.chapterIndex);
    $('#rb-chapter').textContent = chapterTitle(R.chapterIndex);
    $$('#toc-list .toc-item').forEach((b) => b.classList.toggle('cur', Number(b.dataset.ch) === R.chapterIndex));
  }

  function touchLibrary() {
    const book = (S.library.books || []).find((b) => b.id === R.id);
    if (!book) return;
    book.lastOpenedAt = Date.now();
    book.progress = {
      chapter: R.chapterIndex,
      offset: currentOffset(),
      page: R.page,
      pages: R.pages,
      percent: bookPercent(),
      at: Date.now()
    };
    if (book.type === 'pdf') book.progress = { chapter: 0, offset: 0, percent: 0, at: Date.now() };
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(R.saveTimer);
    R.saveTimer = setTimeout(() => {
      touchLibrary();
      flushProgress();
    }, 500);
  }

  function flushProgress() {
    if (!R.id) return;
    clearTimeout(R.saveTimer);
    api.saveDoc('library', S.library).catch(() => {});
    if (typeof Library !== 'undefined') Library.render();
  }

  /* ============================ 目录 / 笔记面板 ============================ */
  function renderToc() {
    const box = $('#toc-list');
    const total = R.chapters.length || 1;
    box.innerHTML = R.toc.map((t, i) => {
      const ch = t.chapter >= 0 ? t.chapter : 0;
      return '<button class="toc-item" data-ch="' + ch + '" style="padding-left:' + (10 + (t.level || 0) * 14) + 'px">' +
        '<span class="toc-label">' + esc(t.label) + '</span>' +
        '<span class="toc-pct">' + pct((ch + 1) / total) + '%</span></button>';
    }).join('');
    $$('#toc-list .toc-item').forEach((b) => {
      b.onclick = () => {
        const ch = Number(b.dataset.ch);
        jumpTo(ch, 0, '目录：' + b.querySelector('.toc-label').textContent);
      };
    });
    updateHeader();
    renderBookmarks();
  }

  function renderBookmarks() {
    const box = $('#bookmark-list');
    const list = (R.ann.bookmarks || []).slice().sort((a, b) => a.chapter - b.chapter || a.offset - b.offset);
    if (!list.length) { box.innerHTML = '<div class="note-empty">还没有书签。<br>阅读时点顶部的「书签」即可添加当前页。</div>'; return; }
    box.innerHTML = list.map((b) =>
      '<div class="note-card" data-id="' + b.id + '" style="border-left-color:#ffd60a">' +
      '<div class="nc-quote">' + esc(b.label || chapterTitle(b.chapter)) + '</div>' +
      '<div class="nc-note">' + esc(b.snippet || '') + '</div>' +
      '<div class="nc-meta"><span>' + esc(fmtDate(b.createdAt)) + '</span><button class="nc-del" data-del="' + b.id + '">删除</button></div></div>'
    ).join('');
    $$('#bookmark-list .note-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.dataset.del) return;
        const b = R.ann.bookmarks.find((x) => x.id === card.dataset.id);
        if (b) { jumpTo(b.chapter, b.offset, '书签'); }
      };
    });
    $$('#bookmark-list [data-del]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        R.ann.bookmarks = R.ann.bookmarks.filter((x) => x.id !== btn.dataset.del);
        await saveAnnotations();
        renderBookmarks();
      };
    });
  }

  let notesFilter = 'all';
  function renderNotes() {
    const box = $('#notes-list');
    let list = R.ann.items.filter((a) => !a.deletedAt);
    if (notesFilter === 'note') list = list.filter((a) => a.note && a.note.trim());
    if (notesFilter === 'highlight') list = list.filter((a) => !a.note || !a.note.trim());
    list.sort((a, b) => a.chapter - b.chapter || a.start - b.start);
    if (!list.length) {
      box.innerHTML = '<div class="note-empty">' + (R.ann.items.length ? '没有符合条件的条目' : '还没有高亮。<br><br>选中正文后，点颜色即可高亮；点「笔记本」可以写下想法。') + '</div>';
      return;
    }
    const colors = { yellow: '#ffd60a', green: '#7fd36a', blue: '#6eafff', pink: '#ff8cb4', underline: '#e2603c' };
    box.innerHTML = list.map((a) =>
      '<div class="note-card" data-id="' + a.id + '" style="border-left-color:' + (colors[a.color] || colors.yellow) + '">' +
      '<div class="nc-quote">' + esc(a.text || '') + '</div>' +
      (a.note && a.note.trim() ? '<div class="nc-note">' + esc(a.note) + '</div>' : '') +
      '<div class="nc-meta"><span>' + esc(chapterTitle(a.chapter)) + ' · ' + esc(fmtDate(a.createdAt)) + '</span>' +
      '<button class="nc-del" data-del="' + a.id + '">删除</button></div></div>'
    ).join('');
    $$('#notes-list .note-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.dataset.del) return;
        const a = R.ann.items.find((x) => x.id === card.dataset.id);
        if (a) { jumpTo(a.chapter, a.start, '笔记：' + (a.note || a.text || '').slice(0, 18)); }
      };
    });
    $$('#notes-list [data-del]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const a = R.ann.items.find((x) => x.id === btn.dataset.del);
        if (a) { a.deletedAt = Date.now(); a.updatedAt = Date.now(); }
        await saveAnnotations();
        renderNotes(); applyHighlights();
      };
    });
  }

  async function saveAnnotations() {
    if (!R.id) return;
    await api.saveAnnotations(R.id, R.ann);
  }

  /* ============================ 跳转与返回 ============================ */
  function rememberReturn() {
    if (R.returnLoc) return;         // 连续跳转只记最开始的位置
    const rl = toLocalOff(currentOffset());
    R.returnLoc = { chapter: rl.ch, offset: rl.offset, page: R.page, mode: R.mode };
  }

  function showJumpBack(label) {
    const el = $('#jump-back');
    el.textContent = '← 返回阅读位置';
    el.classList.remove('hidden');
    el.title = label || '';
    clearTimeout(el._t);
  }
  function hideJumpBack() { $('#jump-back').classList.add('hidden'); }

  async function jumpTo(chapter, offset, label) {
    if (!R.ready && !R.chapters.length) return;
    rememberReturn();
    const inDoc = segReady() && R.seg.some((x) => x.ch === chapter);
    if (R.mode === 'scroll' && inDoc) {
      scrollToOffsetNow(toGlobalOff(chapter, offset));
      R.chapterIndex = chapter;
      updateProgressUi();
    } else if (chapter === R.chapterIndex && R.doc && !segReady()) {
      goPage(pageOfOffset(offset));
      updateProgressUi();
      flash();
    } else {
      await loadChapter(chapter, offset);
      if (R.mode === 'paged') flash();
    }
    showJumpBack(label);
    scheduleSave();
  }

  function returnToPrevious() {
    if (!R.returnLoc) return;
    const loc = R.returnLoc;
    R.returnLoc = null;
    hideJumpBack();
    if (loc.chapter === R.chapterIndex && R.doc) {
      if (R.mode === 'scroll') scrollToOffset(loc.offset); else goPage(loc.page);
      updateProgressUi();
      flash();
    } else {
      loadChapter(loc.chapter, loc.offset);
    }
  }

  function scrollToOffset(off) {
    const pt = pointOfOffset(off);
    if (!pt) return;
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset); r.setEnd(pt.node, pt.offset);
      const rect = r.getBoundingClientRect();
      smoothScrollTo(scEl().scrollTop + rect.top - ANCHOR_Y);
    } catch (e) {}
  }

  function flash() {
    const f = $('#page-flash');
    f.classList.remove('flash');
    void f.offsetWidth;
    f.classList.add('flash');
  }

  /* ============================ 弹层 ============================ */
  function showSelMenu(rect, selText) {
    const menu = $('#sel-menu');
    const maxX = stage().clientWidth - 300;
    const x = Math.max(8, Math.min(maxX, rect.left + rect.width / 2 - 150));
    const y = Math.max(6, rect.top - 46);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
  }
  function hideSelMenu() { $('#sel-menu').classList.add('hidden'); R.selRange = null; }
  function hideNotePop() { $('#note-pop').classList.add('hidden'); }

  function showNotePop(x, y, ann) {
    const pop = $('#note-pop');
    pop.innerHTML =
      '<div class="np-quote">' + esc((ann.text || '').slice(0, 180)) + '</div>' +
      '<textarea id="np-text" placeholder="写下你的想法…">' + esc(ann.note || '') + '</textarea>' +
      '<div class="np-row"><div class="np-actions">' +
      '<button class="btn ghost" id="np-del">删除高亮</button></div>' +
      '<div class="np-actions"><button class="btn ghost" id="np-cancel">取消</button><button class="btn primary" id="np-save">保存</button></div></div>';
    pop.classList.remove('hidden');
    const w = 300;
    pop.style.left = Math.max(8, Math.min(stage().clientWidth - w - 8, x - w / 2)) + 'px';
    pop.style.top = Math.max(8, Math.min(stage().clientHeight - 180, y + 8)) + 'px';
    const ta = $('#np-text');
    ta.focus();
    $('#np-save').onclick = async () => {
      ann.note = ta.value;
      ann.updatedAt = Date.now();
      await saveAnnotations();
      hideNotePop(); applyHighlights(); renderNotes();
      toast('笔记已保存');
    };
    $('#np-del').onclick = async () => {
      ann.deletedAt = Date.now(); ann.updatedAt = Date.now();
      await saveAnnotations();
      hideNotePop(); applyHighlights(); renderNotes();
      toast('已删除');
    };
    $('#np-cancel').onclick = hideNotePop;
  }


  /* ============ 滚动模式：多章拼进同一个文档，滚起来是连续的 ============ */
  function segReady() { return !!(R.seg && R.seg.length); }

  function rebuildSeg() {
    R.seg = [];
    if (!R.doc || !R.doc.body) return;
    let acc = 0;
    R.doc.body.querySelectorAll(':scope > section.lr-seg').forEach((el) => {
      const ch = Number(el.dataset.ch);
      const len = el.textContent.length;
      R.seg.push({ ch, el, start: acc, len });
      acc += len;
    });
  }

  function segOfGlobal(off) {
    if (!segReady()) return null;
    for (let i = R.seg.length - 1; i >= 0; i--) if (off >= R.seg[i].start) return R.seg[i];
    return R.seg[0];
  }
  // 文档内全局字符偏移 ↔ (章, 章内偏移)：标注、书签一律按章内偏移存
  function toLocalOff(off) {
    const s = segOfGlobal(off);
    if (!s) return { ch: R.chapterIndex, offset: off };
    return { ch: s.ch, offset: Math.max(0, Math.min(s.len, off - s.start)) };
  }
  function toGlobalOff(ch, local) {
    if (!segReady()) return local;
    const s = R.seg.find((x) => x.ch === ch);
    return s ? s.start + Math.max(0, Math.min(s.len, local || 0)) : local;
  }
  function firstSegCh() { return segReady() ? R.seg[0].ch : R.chapterIndex; }
  function lastSegCh() { return segReady() ? R.seg[R.seg.length - 1].ch : R.chapterIndex; }

  function anchorSeg() {
    if (!segReady()) return null;
    for (const s of R.seg) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom > ANCHOR_Y) return s;
    }
    return R.seg[R.seg.length - 1];
  }

  function wrapSeg(ch) {
    const body = R.doc.body;
    if (body.querySelector(':scope > section.lr-seg')) { rebuildSeg(); return; }
    const sec = R.doc.createElement('section');
    sec.className = 'lr-seg';
    sec.dataset.ch = String(ch);
    while (body.firstChild) sec.appendChild(body.firstChild);
    body.appendChild(sec);
    rebuildSeg();
  }

  // 章节自带 <style>/<link> 要搬过来，否则拼进来的章节没有字体和图片样式
  function copyChapterStyles(d2) {
    d2.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      const key = n.tagName === 'LINK' ? (n.getAttribute('href') || '') : ('inline:' + (n.textContent || '').slice(0, 80));
      if (!key) return;
      const exist = [...R.doc.querySelectorAll('style, link[rel="stylesheet"]')].some((m) => {
        const k2 = m.tagName === 'LINK' ? (m.getAttribute('href') || '') : ('inline:' + (m.textContent || '').slice(0, 80));
        return k2 === key;
      });
      if (exist) return;
      const c = n.cloneNode(true);
      if (c.tagName === 'STYLE') c.setAttribute('data-lr-ch', '1');
      R.doc.head.appendChild(c);
    });
  }

  async function fetchChapterNode(ch) {
    const res = await fetch(chapterUrl(ch));
    const html = await res.text();
    const d2 = new DOMParser().parseFromString(html, 'text/html');
    copyChapterStyles(d2);
    const sec = R.doc.createElement('section');
    sec.className = 'lr-seg';
    sec.dataset.ch = String(ch);
    const frag = R.doc.importNode(d2.body, true);
    while (frag.firstChild) sec.appendChild(frag.firstChild);
    return sec;
  }

  async function appendChapter(ch) {
    if (!R.id || !R.doc || ch == null || ch < 0 || ch >= (R.chapters || []).length) return false;
    if (R.seg.some((s) => s.ch === ch)) return false;
    if (R._segBusy) return false;
    R._segBusy = true;
    const docRef = R.doc;
    try {
      const sec = await fetchChapterNode(ch);
      if (R.doc !== docRef) return false;
      docRef.body.appendChild(sec);
      rebuildSeg();
      applyHighlights();
      updateProgressUi();
      return true;
    } catch (e) { return false; }
    finally { R._segBusy = false; }
  }

  async function prependChapter(ch) {
    if (!R.id || !R.doc || ch == null || ch < 0 || ch >= (R.chapters || []).length) return false;
    if (R.seg.some((s) => s.ch === ch)) return false;
    if (R._segBusy) return false;
    R._segBusy = true;
    const docRef = R.doc;
    try {
      const sec = await fetchChapterNode(ch);
      if (R.doc !== docRef) return false;
      const el = scEl(docRef);
      const before = el.scrollHeight;
      docRef.body.insertBefore(sec, docRef.body.firstChild);
      rebuildSeg();
      el.scrollTop += Math.max(0, el.scrollHeight - before);
      applyHighlights();
      return true;
    } catch (e) { return false; }
    finally { R._segBusy = false; }
  }

  function scrollToOffsetNow(off) {
    const pt = pointOfOffset(off);
    if (!pt) return;
    try {
      const r = R.doc.createRange();
      r.setStart(pt.node, pt.offset); r.setEnd(pt.node, pt.offset);
      const el = scEl();
      el.scrollTop = el.scrollTop + r.getBoundingClientRect().top - ANCHOR_Y;
      R.scrollTarget = null;
    } catch (e) {}
  }

  /* ============================ iframe 事件 ============================ */
  function bindFrameEvents() {
    const doc = R.doc, win = R.win;
    doc.addEventListener('mouseup', onMouseUp);
    doc.addEventListener('keyup', onMouseUp);
    doc.addEventListener('click', onClick);
    // 点正文（iframe 里的文档）也要能关掉 Aa / ⋯ 浮层：外层的 document click 收不到 iframe 内的点击
    doc.addEventListener('mousedown', () => { hideSelMenu(); closePanels(); });
    win.addEventListener('scroll', onScroll, { passive: true });
    doc.addEventListener('wheel', (e) => {
      if (R.mode === 'paged') {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); turn(e.deltaY > 0 ? 1 : -1); }
        return;
      }
      // 滚动模式：滚轮交给浏览器原生滚动（GPU 合成，最顺），只在章节首尾接管
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? R.layout.H : 1;
      const dy = e.deltaY * unit;
      const el = scEl();
      const atBottom = el.scrollTop + R.layout.H >= el.scrollHeight - 2;
      const atTop = el.scrollTop <= 2;
      const needNext = dy > 0 && atBottom && R.chapterIndex < R.chapters.length - 1;
      const needPrev = dy < 0 && atTop && R.chapterIndex > 0;
      if (needNext || needPrev) { e.preventDefault(); scrollStep(dy); }
    }, { passive: false });
    doc.addEventListener('keydown', (e) => {
      if (R.mode !== 'paged') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn(1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
    });
  }

  let wheelLock = 0;
  function onScroll() {
    if (R.mode !== 'scroll') return;
    if (segReady() && R.doc) {
      const sg = anchorSeg();
      if (sg && sg.ch !== R.chapterIndex) {
        R.chapterIndex = sg.ch;
        updateHeader();
      }
      const el = scEl();
      const remain = el.scrollHeight - el.scrollTop - R.layout.H;
      if (remain < R.layout.H * 2.5) appendChapter(lastSegCh() + 1);
      if (el.scrollTop < R.layout.H * 1.5) prependChapter(firstSegCh() - 1);
    }
    updateProgressUi();
    scheduleSave();
  }

  function onMouseUp() {
    const sel = R.win.getSelection();
    if (!sel || sel.isCollapsed) { hideSelMenu(); return; }
    const text = sel.toString().trim();
    if (!text) { hideSelMenu(); return; }
    const range = sel.getRangeAt(0);
    R.selRange = range.cloneRange();
    R.selOffsets = {
      start: offsetOfPoint(range.startContainer, range.startOffset),
      end: offsetOfPoint(range.endContainer, range.endOffset),
      text: text.slice(0, 500)
    };
    const rect = range.getBoundingClientRect();
    showSelMenu(rect, text);
  }

  function onClick(e) {
    hideSelMenu();
    const sel = R.win.getSelection();
    if (sel && !sel.isCollapsed) return;
    const range = R.doc.caretRangeFromPoint ? R.doc.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (!range) return;
    const off = offsetOfPoint(range.startContainer, range.startOffset);
    const loc0 = toLocalOff(off);
    const hit = annsOfChapter(loc0.ch).find((a) => loc0.offset >= a.start && loc0.offset <= a.end);
    if (hit) showNotePop(e.clientX, e.clientY, hit);
    else hideNotePop();
  }

  function addAnn(color) {
    if (!R.selOffsets) return;
    const loc1 = toLocalOff(R.selOffsets.start);
    const span1 = R.selOffsets.end - R.selOffsets.start;
    const a = {
      id: uid('a'), chapter: loc1.ch,
      start: loc1.offset, end: loc1.offset + span1,
      text: R.selOffsets.text, color, note: '',
      createdAt: Date.now(), updatedAt: Date.now()
    };
    R.ann.items.push(a);
    saveAnnotations();
    applyHighlights();
    renderNotes();
    hideSelMenu();
    const sel = R.win.getSelection(); if (sel) sel.removeAllRanges();
    toast('已高亮');
  }

  function addNoteFromSelection() {
    if (!R.selOffsets) return;
    const loc2 = toLocalOff(R.selOffsets.start);
    const span2 = R.selOffsets.end - R.selOffsets.start;
    const a = {
      id: uid('a'), chapter: loc2.ch,
      start: loc2.offset, end: loc2.offset + span2,
      text: R.selOffsets.text, color: 'yellow', note: '',
      createdAt: Date.now(), updatedAt: Date.now()
    };
    R.ann.items.push(a);
    saveAnnotations();
    applyHighlights();
    hideSelMenu();
    const rect = R.selRange ? R.selRange.getBoundingClientRect() : { left: 100, top: 100, width: 0 };
    showNotePop(rect.left + rect.width / 2, rect.top, a);
  }

  /* ============================ 翻页 ============================ */
  function turn(dir) {
    if (!R.ready) return;
    hideJumpBack();
    if (R.mode === 'scroll') {
      scrollStep(dir * R.layout.H * 0.86);
      return;
    }
    if (dir > 0 && R.page >= R.pages - 1) {
      if (R.chapterIndex < R.chapters.length - 1) { loadChapter(R.chapterIndex + 1, 0); return; }
      toast('已经是最后一页');
      return;
    }
    if (dir < 0 && R.page <= 0) {
      if (R.chapterIndex > 0) loadChapter(R.chapterIndex - 1, 999999);
      return;
    }
    goPage(R.page + dir);
    updateHeader();
  }

  function applyModeUi() {
    const st = stage();
    st.classList.toggle('scroll-mode', R.mode === 'scroll');
    syncSettingsUi(document);
  }

  async function setMode(mode) {
    if (mode === R.mode) return;
    const loc = toLocalOff(currentOffset());
    R.mode = mode;
    S.settings.mode = mode;
    api.saveDoc('settings', S.settings);
    applyModeUi();
    if (!R.doc) return;
    // 滚动模式要把相邻章节拼进同一个文档，翻页模式回到单章，所以都按目标模式重建
    if (mode === 'scroll') await loadScroll(loc.ch, loc.offset);
    else await loadPageChapter(loc.ch, loc.offset);
    updateProgressUi();
    scheduleSave();
  }

  function applySettings() {
    if (!R.doc || !R.ready) return;
    const a = captureAnchor();            // 以“正在读的那一行”为锚点
    applyStyles();
    layout();
    applyHighlights();
    if (R.mode === 'paged') goOffsetExact(a.off);
    else { restoreAnchor(a); restoreAnchor(a); }   // 二次校正：不同字号的行高残差
    updateProgressUi();
  }

  /* ============================ 搜索 ============================ */
  async function buildSearchIndex(progressCb) {
    if (R.searchIndex) return R.searchIndex;
    const idx = [];
    for (let i = 0; i < R.chapters.length; i++) {
      let text = R.textCache.get(i);
      if (text == null) {
        try {
          const html = await fetchText(chapterUrl(i));
          const doc = new DOMParser().parseFromString(html, 'text/html');
          text = doc.body ? doc.body.textContent.replace(/\s+/g, ' ').replace(/ /g, ' ') : '';
          // 只压缩效果偏移：textContent 原样保留，用于偏移换算
          text = doc.body ? doc.body.textContent : '';
          R.textCache.set(i, text);
        } catch (e) { text = ''; }
      }
      idx.push(text);
      if (progressCb) progressCb(i, R.chapters.length);
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    R.searchIndex = idx;
    return idx;
  }

  async function search(query, cb) {
    const q = query.trim();
    if (!q) return [];
    const index = await buildSearchIndex((i, n) => cb && cb('index', i, n));
    const hits = [];
    const lower = q.toLowerCase();
    for (let i = 0; i < index.length && hits.length < 300; i++) {
      const text = index[i] || '';
      const lt = text.toLowerCase();
      let from = 0;
      while (hits.length < 300) {
        const pos = lt.indexOf(lower, from);
        if (pos < 0) break;
        hits.push({
          chapter: i, offset: pos, length: q.length,
          snippet: text.slice(Math.max(0, pos - 42), pos + q.length + 48).replace(/\s+/g, ' ')
        });
        from = pos + q.length;
      }
    }
    return hits;
  }

  async function highlightSearch(chapter, offset, length) {
    const r = rangeOfOffsets(offset, offset + length);
    if (r) applyHighlights([r]);
  }

  /* ============================ 书签 ============================ */
  async function toggleBookmark() {
    if (!R.ready) return;
    const off = currentOffset();
    const bloc = toLocalOff(off);
    const exist = R.ann.bookmarks.find((b) => b.chapter === bloc.ch && Math.abs(b.offset - bloc.offset) < 400);
    if (exist) {
      R.ann.bookmarks = R.ann.bookmarks.filter((b) => b.id !== exist.id);
      await saveAnnotations();
      toast('已移除书签');
    } else {
      const snippet = (textOfOffset(off) || '').slice(0, 80);
      R.ann.bookmarks.push({
        id: uid('m'), chapter: bloc.ch, offset: bloc.offset, page: R.page,
        label: chapterTitle(bloc.ch), snippet,
        createdAt: Date.now(), updatedAt: Date.now()
      });
      await saveAnnotations();
      toast('已添加书签');
    }
    renderBookmarks();
    updateBookmarkBtn();
  }

  function updateBookmarkBtn() {
    const off = currentOffset();
    const on = R.ann.bookmarks.some((b) => b.chapter === R.chapterIndex && Math.abs(b.offset - off) < 400);
    $('#btn-bookmark').classList.toggle('active', on);
  }

  function textOfOffset(off) {
    const { list } = textNodes();
    const start = list.find((n) => off >= n.start && off < n.end);
    if (!start) return '';
    return start.node.nodeValue.slice(Math.max(0, off - start.start), Math.max(0, off - start.start) + 300);
  }

  /* ============================ 歌词模式用 ============================ */
  function chapterSentences() {
    const { list } = textNodes();
    const out = [];
    let buf = '';
    let bufStart = null;
    let lastEnd = 0;
    const push = (end) => {
      const t = buf.replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && bufStart != null) out.push({ text: t, start: bufStart, end });
      buf = ''; bufStart = null;
    };
    for (const item of list) {
      const val = item.node.nodeValue;
      for (let i = 0; i < val.length; i++) {
        const ch = val[i];
        const abs = item.start + i;
        if (bufStart == null) {
          if (/\s/.test(ch)) continue;
          bufStart = abs;
        }
        buf += ch;
        const isEnd = /[。！？!?…]/.test(ch) || (ch === '；' && buf.length > 12) || ch === '\n';
        if (isEnd || buf.length >= 60) {
          push(abs + 1);
          lastEnd = abs + 1;
        }
      }
    }
    if (buf.trim().length >= 2 && bufStart != null) push(lastEnd || bufStart + buf.length);
    return out;
  }

  function chapterTextLength() { return textNodes().total; }

  function syncToOffset(off) {
    if (!R.doc) return;
    if (R.mode === 'scroll') scrollToOffset(off);
    else goPage(pageOfOffset(off), true);
    updateProgressUi();
  }

  function locationNow() {
    const loc = toLocalOff(currentOffset());
    return { chapter: loc.ch, offset: loc.offset, page: R.page };
  }

  function nextChapter() {
    if (R.chapterIndex >= R.chapters.length - 1) return false;
    loadChapter(R.chapterIndex + 1, 0);
    return true;
  }

  /* ============================ 事件绑定 ============================ */
  function init() {
    bindStageResize();
    $('#btn-back-lib').onclick = () => close();
    $('#zone-prev').onclick = () => turn(-1);
    $('#zone-next').onclick = () => turn(1);
    $('#jump-back').onclick = returnToPrevious;

    $('#btn-toc').onclick = () => setSide('toc');
    $('#btn-notes').onclick = () => setSide('notes');
    $('#btn-bookmark').onclick = toggleBookmark;
    $('#btn-search-book').onclick = openSearch;
    $('#btn-close-search').onclick = closeSearch;
    $('#btn-karaoke').onclick = () => Karaoke.toggle();
    $('#btn-aa').onclick = (e) => { e.stopPropagation(); togglePanel('panel-aa'); };
    $('#btn-reader-menu').onclick = (e) => { e.stopPropagation(); togglePanel('panel-menu'); };

    $$('#sel-menu .swatch').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); addAnn(btn.dataset.color); };
    });
    $('#sel-note').onclick = (e) => { e.stopPropagation(); addNoteFromSelection(); };
    $('#sel-copy').onclick = (e) => {
      e.stopPropagation();
      if (R.win) { try { R.win.navigator.clipboard.writeText(R.win.getSelection().toString()); toast('已复制'); } catch (err) {} }
      hideSelMenu();
    };
    $('#sel-search').onclick = (e) => {
      e.stopPropagation();
      const q = R.win.getSelection().toString().trim().slice(0, 30);
      hideSelMenu();
      if (q) { openSearch(); $('#book-search-input').value = q; doSearch(); }
    };

    $$('#notes-filter .chip').forEach((c) => {
      c.onclick = () => {
        notesFilter = c.dataset.filter;
        $$('#notes-filter .chip').forEach((x) => x.classList.toggle('on', x === c));
        renderNotes();
      };
    });
    $$('#rd-tabs button').forEach((b) => {
      b.onclick = () => setSide(b.dataset.tab, true);
    });
    $('#btn-close-side').onclick = () => setSide(null, false);

    $('#progress').oninput = (e) => {
      if (!R.chapters.length) return;
      const target = Number(e.target.value) / 1000;
      const ch = Math.min(R.chapters.length - 1, Math.floor(target * R.chapters.length));
      const inCh = target * R.chapters.length - ch;
      if (ch !== R.chapterIndex) loadChapter(ch, Math.round(inCh * 100000));
      else if (R.mode === 'paged') goPage(Math.round(inCh * R.pages));
    };

    // 排版 / 主题控件（Aa 面板与设置弹层共用）
    renderAaPanel();
    if (window.matchMedia) {
      try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyChromeTheme()); } catch (err) {}
    }
    $$('#panel-menu button').forEach((b) => {
      b.onclick = () => {
        closePanels();
        const m = b.dataset.menu;
        if (m === 'karaoke') Karaoke.start();
        if (m === 'scroll') setMode(R.mode === 'paged' ? 'scroll' : 'paged');
        if (m === 'info') App.showBookInfo(R.id);
        if (m === 'reveal') api.revealBook(R.id);
        if (m === 'sync') App.runSync(true);
        if (m === 'settings') App.openSettings();
      };
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#panel-aa') && !e.target.closest('#panel-menu') && !e.target.closest('#btn-aa') && !e.target.closest('#btn-reader-menu')) closePanels();
    });
    document.addEventListener('keydown', (e) => {
      if ($('#view-reader').classList.contains('active') === false) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setSide(sideTab || 'toc');         // Ctrl+B 展开 / 收起目录
        return;
      }
      if (e.key === 'Escape') {
        // 有浮层先关浮层；都没有就回书库
        const floating = !$('#sel-menu').classList.contains('hidden') ||
          !$('#note-pop').classList.contains('hidden') ||
          !$('#search-overlay').classList.contains('hidden') ||
          !!$('.panel.open') || $('#rd-side').classList.contains('open');
        hideSelMenu(); hideNotePop(); closeSearch(); closePanels();
        if (floating) { closeDrawers(); return; }
        close();
        return;
      }
      if (e.key === 'ArrowRight') turn(1);
      if (e.key === 'ArrowLeft') turn(-1);
      if (e.key === ' ') { e.preventDefault(); turn(1); }
      if (e.key === 'b' || e.key === 'B') toggleBookmark();
    });
    window.addEventListener('resize', debounce(() => { if (R.ready) applySettings(); }, 220));
    // 选中条 / 笔记弹层的按钮（用事件委托，元素在 HTML 里固定）
    $('#sel-menu').addEventListener('mousedown', (e) => e.preventDefault());
  }

  /* ==================== 排版控件（Aa 面板 / 设置弹层共用） ==================== */

  function fmtVal(k, v) {
    if (k === 'fontSize') return Math.round(v) + ' px';
    if (k === 'lineHeight') return Number(v).toFixed(2);
    if (k === 'margin') return Math.round(v) + ' %';
    if (k === 'letterSpacing' || k === 'wordSpacing') return Number(v).toFixed(1) + ' px';
    return String(v);
  }
  function rangeOf(k) {
    const v = Number(S.settings[k]);
    if (k === 'fontSize') return v;
    if (k === 'lineHeight') return Math.round(v * 100);
    return v;
  }

  function typeControlsHtml() {
    const themes = THEME_KEYS.map((k) => {
      const t = themeOf(k);
      return '<button class="aa-theme" data-tc="theme" data-v="' + k + '" title="' + esc(t.desc || t.label) + '">' +
        '<span class="aa-thumb" style="background:' + t.paper + ';color:' + t.text + ';font-family:' + (FONT_STACKS[t.font] || FONT_STACKS.serif) + '">Aa</span>' +
        '<span class="aa-name">' + esc(t.label) + '</span></button>';
    }).join('');
    const fonts = Object.keys(FONT_LABELS).filter((f) => FONT_STACKS[f])
      .map((f) => '<button data-tc="font" data-v="' + f + '" style="font-family:' + FONT_STACKS[f] + '">' + FONT_LABELS[f] + '</button>').join('');
    const row = (k, label, min, max, step) =>
      '<div class="aa-row"><span class="aa-label">' + label + '</span>' +
      '<input type="range" data-tc="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + rangeOf(k) + '">' +
      '<span class="aa-val" data-val="' + k + '"></span></div>';
    return '' +
      '<div class="aa-section-title">阅读主题</div>' +
      '<div class="aa-themes">' + themes + '</div>' +
      '<div class="aa-section-title">排版</div>' +
      '<div class="aa-row"><span class="aa-label">字体</span><div class="font-picks">' + fonts + '</div></div>' +
      '<div class="aa-row"><span class="aa-label">粗体</span><button class="switch" data-tc="weight"><i></i></button>' +
        '<span class="aa-val" data-val="weight" style="width:auto;flex:0 0 auto"></span></div>' +
      row('fontSize', '字号', 12, 36, 1) +
      row('lineHeight', '行距', 120, 260, 5) +
      row('letterSpacing', '字距', 0, 30, 1) +
      row('wordSpacing', '词距', 0, 60, 1) +
      row('margin', '页边距', 2, 18, 1) +
      '<div class="aa-section-title">翻页方式</div>' +
      '<div class="aa-row"><div class="font-picks" style="flex:1">' +
        '<button data-tc="transition" data-v="slide">滑动</button>' +
        '<button data-tc="transition" data-v="page">翻页</button>' +
        '<button data-tc="transition" data-v="fade">淡入淡出</button>' +
        '<button data-tc="transition" data-v="scroll">滚动</button>' +
      '</div></div>' +
      '<div class="aa-row"><span class="aa-label">平滑过渡</span><button class="switch" data-tc="smooth"><i></i></button>' +
        '<span style="flex:1"></span></div>' +
      '<div class="aa-section-title">界面外观</div>' +
      '<div class="aa-row"><div class="font-picks" style="flex:1">' +
        '<button data-tc="appearance" data-v="light">浅色</button>' +
        '<button data-tc="appearance" data-v="dark">深色</button>' +
        '<button data-tc="appearance" data-v="system">跟随系统</button>' +
      '</div></div>' +
      '<button class="aa-reset" data-tc="reset">恢复该主题的默认排版</button>';
  }

  function bindTypeControls(root) {
    const r = root || document;
    $$('[data-tc]', r).forEach((el) => {
      const kind = el.dataset.tc;
      if (kind === 'theme') {
        el.onclick = () => {
          const name = el.dataset.v;
          applyThemeDefaults(S.settings, name);
          afterTypeChange(root);
          toast('主题：' + themeOf(name).label);
        };
      } else if (kind === 'font') {
        el.onclick = () => { S.settings.font = el.dataset.v; afterTypeChange(root); };
      } else if (kind === 'weight') {
        el.onclick = () => { S.settings.weight = Number(S.settings.weight) >= 600 ? 400 : 700; afterTypeChange(root); };
      } else if (kind === 'smooth') {
        el.onclick = () => { S.settings.smooth = !(S.settings.smooth !== false); syncSettingsUi(root); saveSettings(); };
      } else if (kind === 'appearance') {
        el.onclick = () => { S.settings.appearance = el.dataset.v; applyChromeTheme(); syncSettingsUi(root); saveSettings(); };
      } else if (kind === 'transition') {
        el.onclick = () => {
          const v = el.dataset.v;
          S.settings.transition = v;
          S.settings.mode = v === 'scroll' ? 'scroll' : 'paged';
          if (R.doc) setMode(S.settings.mode);
          syncSettingsUi(root); saveSettings();
        };
      } else if (kind === 'reset') {
        el.onclick = () => { applyThemeDefaults(S.settings, S.settings.theme); afterTypeChange(root); toast('已恢复默认排版'); };
      } else if (el.type === 'range') {
        el.oninput = () => {
          let v = Number(el.value);
          if (kind === 'lineHeight') v = v / 100;
          S.settings[kind] = v;
          const lab = $('[data-val="' + kind + '"]', r);
          if (lab) lab.textContent = fmtVal(kind, v);
          applySettings();
          saveSettings();
        };
      }
    });
  }

  function afterTypeChange(root) {
    applyChromeTheme();
    applySettings();
    if (R.doc) layout();
    syncSettingsUi(root);
    saveSettings();
  }

  function syncSettingsUi(root) {
    const r = root || document;
    const s = S.settings;
    $$('[data-tc="theme"]', r).forEach((b) => b.classList.toggle('on', b.dataset.v === s.theme));
    $$('[data-tc="font"]', r).forEach((b) => b.classList.toggle('on', b.dataset.v === s.font));
    $$('[data-tc="appearance"]', r).forEach((b) => b.classList.toggle('on', b.dataset.v === (s.appearance || 'light')));
    const tr = s.mode === 'scroll' ? 'scroll' : (s.transition || 'slide');
    $$('[data-tc="transition"]', r).forEach((b) => b.classList.toggle('on', b.dataset.v === tr));
    const w = $('[data-tc="weight"]', r);
    if (w) w.classList.toggle('on', Number(s.weight) >= 600);
    const wv = $('[data-val="weight"]', r);
    if (wv) wv.textContent = Number(s.weight) >= 600 ? '开启' : '关闭';
    const sm = $('[data-tc="smooth"]', r);
    if (sm) sm.classList.toggle('on', s.smooth !== false);
    ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'margin'].forEach((k) => {
      const inp = $('[data-tc="' + k + '"]', r);
      if (inp) inp.value = rangeOf(k);
      const lab = $('[data-val="' + k + '"]', r);
      if (lab) lab.textContent = fmtVal(k, s[k]);
    });
  }

  function renderAaPanel() {
    const body = $('#aa-body');
    if (!body || body.dataset.built) { syncSettingsUi($('#aa-body') || document); return; }
    body.dataset.built = '1';
    body.innerHTML = typeControlsHtml();
    bindTypeControls(body);
    syncSettingsUi(body);
  }

  function saveSettings() { api.saveDoc('settings', S.settings).catch(() => {}); }

  /* ==================== 左侧栏：目录 / 书签 / 高亮标记 ==================== */
  let sideTab = 'toc';
  function setSide(tab, force) {
    bindSideTransition();
    bindStageResize();
    const side = $('#rd-side');
    if (!side) return;
    const isOpen = side.classList.contains('open');
    if (tab === null) { side.classList.remove('open'); relayoutSoon(); return; }
    if (!force && isOpen && sideTab === tab) { side.classList.remove('open'); relayoutSoon(); return; }
    sideTab = tab;
    side.classList.add('open');
    $$('#rd-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ['toc', 'marks', 'notes'].forEach((t) => {
      const pane = document.getElementById('pane-' + t);
      if (pane) pane.classList.toggle('hidden', t !== tab);
    });
    if (tab === 'toc') renderToc();
    if (tab === 'marks') renderBookmarks();
    if (tab === 'notes') renderNotes();
    relayoutSoon();
  }
  function closeDrawers() {
    const s = $('#rd-side');
    if (s) { s.classList.remove('open'); relayoutSoon(); }
  }
  // 侧栏展开动画结束就立刻重排，不用等定时器
  /* 侧栏开合 / 窗口缩放时，正文要跟着实时重新居中，所以监听舞台尺寸而不是只在动画结束后量一次 */
  let _stageRO = null, _stageRaf = 0;
  function bindStageResize() {
    const el = $('#book-frame');
    if (!el || typeof ResizeObserver === 'undefined') return;
    if (_stageRO) _stageRO.disconnect();
    _stageRO = new ResizeObserver(() => {
      if (_stageRaf) return;
      _stageRaf = requestAnimationFrame(() => {
        _stageRaf = 0;
        if (R.doc && R.ready) layout();
      });
    });
    _stageRO.observe(el);
  }

  function bindSideTransition() {
    const side = $('#rd-side');
    if (!side || side._relayoutBound) return;
    side._relayoutBound = true;
    side.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'margin-left' && R.doc && R.ready) applySettings();
    });
  }

  function relayoutSoon() {
    clearTimeout(relayoutSoon._t);
    clearTimeout(relayoutSoon._t2);
    const run = () => { if (R.doc && R.ready) applySettings(); };
    // 侧栏有 220ms 的展开动画，等动画结束再量宽度，才能按最终尺寸居中
    relayoutSoon._t = setTimeout(run, 260);
    relayoutSoon._t2 = setTimeout(run, 520);
  }
  function togglePanel(id) {
    const el = document.getElementById(id);
    const open = el.classList.contains('open');
    closePanels();
    if (!open) { el.classList.add('open'); if (id === 'panel-aa') renderAaPanel(); }
  }
  function closePanels() { $$('.panel').forEach((p) => p.classList.remove('open')); }

  /* ============================ 搜索 UI ============================ */
  let searchToken = 0;
  function openSearch() {
    $('#search-overlay').classList.remove('hidden');
    setTimeout(() => $('#book-search-input').focus(), 30);
  }
  function closeSearch() { $('#search-overlay').classList.add('hidden'); }

  async function doSearch() {
    const q = $('#book-search-input').value.trim();
    const box = $('#search-results');
    if (!q) { box.innerHTML = '<p class="muted" style="padding:10px">输入关键词后回车</p>'; return; }
    const token = ++searchToken;
    box.innerHTML = '<p class="muted" style="padding:10px">正在搜索整本书…</p>';
    const hits = await search(q, (phase, i, n) => {
      if (token === searchToken) box.innerHTML = '<p class="muted" style="padding:10px">建立索引 ' + i + '/' + n + '</p>';
    });
    if (token !== searchToken) return;
    if (!hits.length) { box.innerHTML = '<p class="muted" style="padding:10px">没有找到「' + esc(q) + '」</p>'; return; }
    box.innerHTML = hits.map((h, i) => {
      const safe = esc(h.snippet).replace(new RegExp(escReg(q), 'gi'), (m) => '<mark>' + m + '</mark>');
      return '<div class="sr-item" data-i="' + i + '"><div class="sr-ch">' + esc(chapterTitle(h.chapter)) + '</div><div class="sr-text">…' + safe + '…</div></div>';
    }).join('');
    $$('#search-results .sr-item').forEach((el) => {
      el.onclick = async () => {
        const h = hits[Number(el.dataset.i)];
        closeSearch();
        await jumpTo(h.chapter, h.offset, '搜索：' + q);
        setTimeout(() => highlightSearch(h.chapter, h.offset, h.length), 120);
      };
    });
  }

  function escReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  return {
    init, open, close, parseStructure, jumpTo, turn, applySettings, applyModeUi,
    chapterSentences, chapterTextLength, locationNow, nextChapter, scrollToOffset, syncToOffset,
    get id() { return R.id; }, get meta() { return R.meta; }, get ready() { return R.ready; },
    _dev: { layout, applyStyles, applySettings, captureAnchor, restoreAnchor, pointOfOffset, currentOffset, get R() { return R; } },
    get chapterIndex() { return R.chapterIndex; }, get doc() { return R.doc; },
    get ann() { return R.ann; }, get toc() { return R.toc; },
    goPage, updateProgressUi, renderToc, renderNotes, doSearch, openSearch, closeSearch,
    syncSettingsUi, saveSettings, layout, applyHighlights,
    typeControlsHtml, bindTypeControls, renderAaPanel, setSide, renderBookmarks, setMode
  };
})();
