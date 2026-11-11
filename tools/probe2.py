#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第二步：逐项验证阅读器功能（翻页、高亮、笔记、目录跳转+返回、搜索、歌词、平滑滚动、标签）。"""
import json
import sys
import time

sys.path.insert(0, '/home/ut000190@uos/lumen-books/tools')
from cdp import Session

SHOT = '/home/ut000190@uos/lumen-books/shots/'
s = Session()
out = {}


def js(code):
    return s.eval(code)


def step(name, ok, extra=''):
    out[name] = ('PASS' if ok else 'FAIL') + (('  ' + str(extra)) if extra else '')
    print(('✓ ' if ok else '✗ ') + name, extra)


# 1. 书库
js("if(!document.querySelector('#view-library').classList.contains('active')) Reader.close()")
time.sleep(0.8)
cards = js("document.querySelectorAll('#book-grid .book-card').length")
step('书库有书籍卡片', cards >= 1, 'cards=%d' % cards)
s.shot(SHOT + '01-library.png')

# 2. 打开书
js("document.querySelector('#book-grid .book-card').click()")
time.sleep(3.0)
info = json.loads(js("""JSON.stringify({
  ready: Reader.ready, ch: Reader.chapterIndex,
  textLen: Reader.doc ? Reader.doc.body.textContent.length : 0,
  pagesText: document.querySelector('#rb-pages').textContent,
  chapter: document.querySelector('#rb-chapter').textContent
})"""))
step('打开书籍并排版', info['ready'] and info['textLen'] > 300, json.dumps(info, ensure_ascii=False))
s.shot(SHOT + '02-reader.png')

# 3. 翻页
before = js("Reader.doc.documentElement.scrollLeft")
js("document.querySelector('#zone-next').click()")
time.sleep(0.6)
after = js("Reader.doc.documentElement.scrollLeft")
step('翻页（平滑过渡）', after > before, 'scrollLeft %s → %s' % (before, after))
s.shot(SHOT + '03-page2.png')
js("document.querySelector('#zone-prev').click()")
time.sleep(0.5)

# 4. 选中 → 高亮
js("""(function(){
  const doc = Reader.doc;
  const p = Array.from(doc.querySelectorAll('p')).find(x => x.textContent.length > 40);
  const t = p.firstChild;
  const r = doc.createRange(); r.setStart(t, 4); r.setEnd(t, Math.min(t.length, 34));
  const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  doc.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: 420, clientY: 300}));
})()""")
time.sleep(0.4)
menu = js("!document.querySelector('#sel-menu').classList.contains('hidden')")
step('选中文字弹出操作条', bool(menu))
s.shot(SHOT + '04-selection.png')
js("document.querySelector('#sel-menu .swatch[data-color=\"yellow\"]').click()")
time.sleep(0.5)
ann = json.loads(js("JSON.stringify({n: Reader.ann.items.length, hl: Reader.doc.defaultView.CSS.highlights ? Array.from(Reader.doc.defaultView.CSS.highlights.keys()) : []})"))
step('高亮已写入', ann['n'] == 1 and 'hl-yellow' in ann['hl'], json.dumps(ann, ensure_ascii=False))
s.shot(SHOT + '05-highlight.png')

# 5. 写笔记
js("""(function(){
  const doc = Reader.doc;
  const p = Array.from(doc.querySelectorAll('p')).find(x => x.textContent.length > 60);
  const t = p.firstChild;
  const r = doc.createRange(); r.setStart(t, 6); r.setEnd(t, 26);
  const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  doc.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: 400, clientY: 380}));
})()""")
time.sleep(0.3)
js("document.querySelector('#sel-note').click()")
time.sleep(0.4)
has_pop = js("!document.querySelector('#note-pop').classList.contains('hidden')")
js("document.querySelector('#np-text').value = '这一段写得很好，标记一下。'")
js("document.querySelector('#np-save').click()")
time.sleep(0.6)
note_ok = js("Reader.ann.items.some(a => a.note && a.note.length > 3)")
step('笔记弹层与保存', bool(has_pop) and bool(note_ok))
s.shot(SHOT + '06-note.png')

# 6. 笔记抽屉
js("document.querySelector('#btn-notes').click()")
time.sleep(0.5)
step('笔记抽屉列出条目', js("document.querySelectorAll('#notes-list .note-card').length") >= 2)
s.shot(SHOT + '07-notes-drawer.png')
js("document.querySelector('[data-close=\"drawer-notes\"]').click()")

# 7. 目录跳转 + 返回按钮
js("document.querySelector('#btn-toc').click()")
time.sleep(0.4)
tocn = js("document.querySelectorAll('#toc-list .toc-item').length")
js("document.querySelectorAll('#toc-list .toc-item')[2].click()")
time.sleep(2.2)
jump = json.loads(js("""JSON.stringify({ch: Reader.chapterIndex, back: !document.querySelector('#jump-back').classList.contains('hidden'), label: document.querySelector('#r-chapter').textContent})"""))
step('目录跳转 + 返回按钮', jump['ch'] == 2 and jump['back'], json.dumps(jump, ensure_ascii=False) + ' toc=%d' % tocn)
s.shot(SHOT + '08-toc-jump.png')
js("document.querySelector('#jump-back').click()")
time.sleep(1.6)
back = js("Reader.chapterIndex")
step('返回按钮回到原位', back == 0, 'chapter=%s' % back)

# 8. 全书搜索
js("document.querySelector('#btn-search-book').click()")
time.sleep(0.3)
js("document.querySelector('#book-search-input').value = '书店'")
js("Reader.doSearch()")
time.sleep(2.5)
hits = js("document.querySelectorAll('#search-results .sr-item').length")
step('全书搜索命中', hits >= 1, 'hits=%s' % hits)
s.shot(SHOT + '09-search.png')
if hits:
    js("document.querySelectorAll('#search-results .sr-item')[0].click()")
    time.sleep(2.0)
    step('搜索结果跳转后出现返回按钮', js("!document.querySelector('#jump-back').classList.contains('hidden')"))
s.shot(SHOT + '10-search-jump.png')

# 9. 歌词模式
js("document.querySelector('#btn-karaoke').click()")
time.sleep(1.2)
ka = json.loads(js("""JSON.stringify({
  on: !document.querySelector('#karaoke').classList.contains('hidden'),
  lines: document.querySelectorAll('.ka-line').length,
  cur: document.querySelectorAll('.ka-line.cur').length,
  wipe: document.querySelector('.ka-line.cur .wipe') ? document.querySelector('.ka-line.cur .wipe').style.getPropertyValue('--wp') : null
})"""))
step('歌词模式渲染', ka['on'] and ka['lines'] > 3 and ka['cur'] == 1, json.dumps(ka, ensure_ascii=False))
time.sleep(1.2)
s.shot(SHOT + '11-karaoke.png')
js("document.querySelector('#ka-exit').click()")
time.sleep(0.4)

# 10. 滚动模式 + 平滑滚动
js("document.querySelector('#btn-aa').click()")
time.sleep(0.3)
js("document.querySelector('#mode-picks button[data-mode=\"scroll\"]').click()")
time.sleep(1.0)
mode = json.loads(js("""JSON.stringify({scroll: document.querySelector('#reader-stage').classList.contains('scroll-mode'), max: Reader.doc ? Reader.doc.documentElement.scrollHeight : 0})"""))
js("""(function(){ const d = Reader.doc;
  for (let i = 0; i < 3; i++) d.dispatchEvent(new WheelEvent('wheel', {deltaY: 260, bubbles: true, cancelable: true}));
})()""")
time.sleep(1.2)
top = js("Reader.doc.documentElement.scrollTop")
step('滚动模式 + 平滑滚动', mode['scroll'] and top > 20, 'top=%s maxH=%s' % (top, mode['max']))
s.shot(SHOT + '12-scroll-mode.png')
js("document.querySelector('#mode-picks button[data-mode=\"paged\"]').click()")
time.sleep(0.8)
js("document.querySelector('#btn-aa').click()")

# 11. 标签
js("App.showTagEditor(Reader.id)")
time.sleep(0.5)
js("""(function(){ const inp = document.querySelector('#tag-input');
  inp.value = '测试标签'; inp.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
})()""")
time.sleep(0.3)
js("document.querySelector('#tag-save').click()")
time.sleep(0.7)
tag = json.loads(js("""JSON.stringify({
  modal: document.querySelector('#modal-mask').classList.contains('hidden'),
  books: (S.library.books[0].tags || []),
  sidebar: document.querySelectorAll('#tags [data-tag]').length,
  chips: document.querySelectorAll('.tag-chip').length
})"""))
step('标签保存并出现在侧栏/卡片', tag['modal'] and '测试标签' in tag['books'] and tag['sidebar'] >= 1, json.dumps(tag, ensure_ascii=False))
s.shot(SHOT + '13-tags.png')

# 12. 阅读设置 / 同步面板
js("App.openSettings()")
time.sleep(0.6)
s.shot(SHOT + '14-settings.png')
js("App.openSync()")
time.sleep(0.6)
s.shot(SHOT + '15-sync.png')

print('\nerrors:', json.dumps(s.errors[:12], ensure_ascii=False, indent=1))
print('\nsummary:', json.dumps(out, ensure_ascii=False, indent=1))
s.close()
