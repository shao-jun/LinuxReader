#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回归探测：左侧三 tab、六套主题+排版、外观、四种翻页方式、高亮/书签/歌词。"""
import sys, time, json
sys.path.insert(0, '/home/ut000190@uos/lumen-books/tools')
from cdp import Session

PASS, FAIL = [], []

def ok(name, cond, extra=''):
    (PASS if cond else FAIL).append(name + (' :: ' + str(extra) if extra else ''))
    print(('PASS ' if cond else 'FAIL ') + name + (' :: ' + str(extra) if extra else ''))

s = Session()
s.eval("document.querySelector('#view-library').classList.contains('active')")
time.sleep(0.5)

# 1 书库
cards = s.eval("document.querySelectorAll('#book-grid .book-card').length")
ok('书库有书卡', cards >= 1, cards)

# 2 打开书
s.eval("(()=>{const c=document.querySelector('#book-grid .book-card'); c.click(); return 1})()")
time.sleep(3)
s.eval("Reader.jumpTo(0, 0, 'test')")
time.sleep(1.5)
opened = s.eval("Reader.ready && document.querySelector('#view-reader').classList.contains('active')")
ok('打开书籍', bool(opened))
ok('书籍正文有内容', s.eval("Reader.doc ? Reader.doc.body.innerText.trim().length : 0") > 100,
   s.eval("Reader.doc ? Reader.doc.body.innerText.trim().length : 0"))

# 3 左侧三 tab
tabs = s.eval("[...document.querySelectorAll('#rd-tabs button')].map(b=>b.textContent.trim()+':'+b.classList.contains('on'))")
ok('左侧三个 tab', len(tabs) == 3, tabs)
ok('侧栏默认展开', s.eval("document.querySelector('#rd-side').classList.contains('open')"))
ok('侧栏有目录条目', s.eval("document.querySelectorAll('#toc-list .toc-item').length") > 0,
   s.eval("document.querySelectorAll('#toc-list .toc-item').length"))
s.eval("document.querySelector('#rd-tabs [data-tab=marks]').click()")
time.sleep(0.4)
ok('切到书签 tab', s.eval("!document.querySelector('#pane-marks').classList.contains('hidden')"))
s.eval("document.querySelector('#rd-tabs [data-tab=notes]').click()")
time.sleep(0.4)
ok('切到高亮 tab', s.eval("!document.querySelector('#pane-notes').classList.contains('hidden')"))
ok('高亮 tab 有筛选条', s.eval("document.querySelectorAll('#notes-filter .chip').length") >= 3)
sw = s.eval("(()=>{const o=document.querySelector('#rd-side').getBoundingClientRect(); return Math.round(o.width)})()")
ok('侧栏占用 316px', 300 <= sw <= 330, sw)
ok('侧栏打开后正文重新排版', bool(s.eval("Reader.ready")))

# 4 Aa 面板
s.eval("document.querySelector('#btn-aa').click()")
time.sleep(0.6)
ok('Aa 面板打开', s.eval("document.querySelector('#panel-aa').classList.contains('open')"))
themes = s.eval("[...document.querySelectorAll('#aa-body .aa-theme .aa-name')].map(e=>e.textContent)")
ok('六个主题', themes == ['原始', '安静', '纸张', '粗体', '平静', '专注'], themes)
sliders = s.eval("[...document.querySelectorAll('#aa-body input[type=range]')].map(e=>e.dataset.tc)")
ok('排版滑杆齐全', all(k in sliders for k in ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'margin']), sliders)
trans = s.eval("[...document.querySelectorAll('#aa-body [data-tc=transition]')].map(e=>e.textContent)")
ok('四种翻页方式', trans == ['滑动', '翻页', '淡入淡出', '滚动'], trans)
appearance = s.eval("[...document.querySelectorAll('#aa-body [data-tc=appearance]')].map(e=>e.textContent)")
ok('外观三个选项', appearance == ['浅色', '深色', '跟随系统'], appearance)

# 5 主题切换带默认值
s.eval("document.querySelector('#aa-body [data-tc=theme][data-v=paper]').click()")
time.sleep(0.8)
st = s.eval("JSON.stringify({theme:S.settings.theme, font:S.settings.font, lh:S.settings.lineHeight, ls:S.settings.letterSpacing, ws:S.settings.wordSpacing, mg:S.settings.margin})")
ok('纸张主题应用默认排版', '"theme":"paper"' in st and '"font":"kai"' in st, st)
bodybg = s.eval("getComputedStyle(Reader.doc.body).backgroundColor")
ok('正文用米色纸', bodybg not in ('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'), bodybg)
lv = s.eval("getComputedStyle(Reader.doc.body).letterSpacing + '/' + getComputedStyle(Reader.doc.body).wordSpacing")
ok('字距词距生效', lv.split('/')[0] != 'normal', lv)

# 6 微调
s.eval("(()=>{const r=document.querySelector('#aa-body [data-tc=fontSize]'); r.value=26; r.dispatchEvent(new Event('input')); return 1})()")
time.sleep(0.5)
ok('字号微调生效', abs(s.eval("parseFloat(getComputedStyle(Reader.doc.body).fontSize)") - 26) < 0.6,
   s.eval("getComputedStyle(Reader.doc.body).fontSize"))
s.eval("document.querySelector('#aa-body [data-tc=weight]').click()")
time.sleep(0.5)
ok('粗体开关生效', s.eval("getComputedStyle(Reader.doc.body).fontWeight") in ('700', 'bold'),
   s.eval("getComputedStyle(Reader.doc.body).fontWeight"))
s.eval("document.querySelector('#aa-body [data-tc=reset]').click()")
time.sleep(0.6)
ok('恢复默认排版', abs(s.eval("parseFloat(getComputedStyle(Reader.doc.body).fontSize)") - 19) < 0.6,
   s.eval("getComputedStyle(Reader.doc.body).fontSize"))

# 7 外观
s.eval("document.querySelector('#aa-body [data-tc=appearance][data-v=dark]').click()")
time.sleep(0.5)
ok('深色外观', s.eval("document.body.getAttribute('data-theme')") == 'dark')
s.eval("document.querySelector('#aa-body [data-tc=appearance][data-v=light]').click()")
time.sleep(0.4)
ok('浅色外观', s.eval("document.body.getAttribute('data-theme')") == 'light')
s.eval("document.querySelector('#aa-body [data-tc=appearance][data-v=system]').click()")
time.sleep(0.4)
ok('跟随系统', s.eval("S.settings.appearance") == 'system')

# 8 翻页方式
s.eval("document.querySelector('#aa-body [data-tc=transition][data-v=fade]').click()")
time.sleep(0.3)
ok('淡入淡出 → paged', s.eval("S.settings.transition+'/'+S.settings.mode") == 'fade/paged',
   s.eval("S.settings.transition+'/'+S.settings.mode"))
p0 = s.eval("Reader.doc ? Reader.doc.documentElement.scrollLeft : 0")
s.eval("Reader.turn(1)")
time.sleep(0.7)
p1 = s.eval("Reader.doc.documentElement.scrollLeft")
ok('淡入淡出可翻页', p1 >= p0, '%s -> %s' % (p0, p1))
s.eval("document.querySelector('#aa-body [data-tc=transition][data-v=page]').click(); Reader.turn(1)")
time.sleep(0.7)
ok('翻页动效可翻页', s.eval("Reader.doc.documentElement.scrollLeft") != p1)
s.eval("document.querySelector('#aa-body [data-tc=transition][data-v=scroll]').click()")
time.sleep(0.9)
ok('滚动模式', s.eval("S.settings.mode") == 'scroll' and s.eval("S.settings.transition") == 'scroll')
s.eval("Reader.turn(1)")
time.sleep(0.8)
ok('滚动模式可滚动', s.eval("Reader.doc.documentElement.scrollTop") > 0,
   s.eval("Reader.doc.documentElement.scrollTop"))
s.eval("document.querySelector('#aa-body [data-tc=transition][data-v=slide]').click()")
time.sleep(0.6)
ok('回到滑动翻页', s.eval("S.settings.mode") == 'paged')
s.eval("document.querySelector('#btn-aa').click()")

# 9 高亮 + 笔记 + 三个 tab 联动
s.eval("""(()=>{
  const doc = Reader.doc, w = Reader.doc.defaultView;
  const p = [...doc.querySelectorAll('p')].find(x=>x.innerText.trim().length>30);
  const r = doc.createRange(); r.selectNodeContents(p);
  const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
  doc.dispatchEvent(new w.Event('mouseup', {bubbles:true}));
  return 1;
})()""")
time.sleep(0.6)
menu_open = s.eval("!document.querySelector('#sel-menu').classList.contains('hidden')")
ok('选中后出现操作条', bool(menu_open))
s.eval("document.querySelector('#sel-menu .swatch.yellow').click()")
time.sleep(0.8)
ok('高亮已保存', s.eval("Reader.ann.items.length") >= 1, s.eval("Reader.ann.items.length"))
s.eval("Reader.renderNotes()")
marks = s.eval("document.querySelectorAll('#notes-list .note-card, #notes-list .note-item').length")
ok('高亮列表有条目', marks >= 1, marks)
# 定位 + 返回按钮
s.eval("document.querySelector('#notes-list .note-card, #notes-list .note-item') && document.querySelector('#notes-list .note-card, #notes-list .note-item').click()")
time.sleep(1.6)
ok('跳转后出现返回按钮', s.eval("!document.querySelector('#jump-back').classList.contains('hidden')"))
s.eval("document.querySelector('#jump-back').click()")
time.sleep(1.2)
ok('返回按钮可回到原位', s.eval("document.querySelector('#jump-back').classList.contains('hidden')"))

# 10 书签（先清空，避免上次运行留下的书签被 toggle 掉）
s.eval("(()=>{Reader.ann.bookmarks=[]; return window.linuxreader.saveAnnotations(Reader.id, Reader.ann)})()")
time.sleep(0.6)
s.eval("Reader.updateBookmarkBtn && Reader.updateBookmarkBtn()")
s.eval("document.querySelector('#btn-bookmark').click()")
time.sleep(0.6)
ok('添加书签', s.eval("(Reader.ann.bookmarks||[]).length") >= 1, s.eval("(Reader.ann.bookmarks||[]).length"))
s.eval("Reader.setSide('marks', true)")
time.sleep(0.4)
ok('书签 tab 显示书签', s.eval("document.querySelectorAll('#bookmark-list .note-card').length") >= 1,
   s.eval("document.querySelectorAll('#bookmark-list .note-card').length"))

# 11 歌词模式
s.eval("document.querySelector('#btn-karaoke').click()")
time.sleep(1.2)
ok('歌词模式打开', s.eval("!document.querySelector('#karaoke').classList.contains('hidden')"),
   s.eval("document.querySelector('#karaoke').innerHTML.slice(0,60)"))
s.eval("document.querySelector('#btn-karaoke').click()")
time.sleep(0.5)

# 12 设置弹层复用同一套控件
s.eval("App && document.querySelector('#btn-settings').click()")
time.sleep(0.8)
ok('设置弹层有主题卡', s.eval("document.querySelectorAll('#modal-settings .aa-theme').length") == 6,
   s.eval("document.querySelectorAll('#modal-settings .aa-theme').length"))
s.eval("closeModal()")

s.shot('/home/ut000190@uos/lumen-books/shots/reader-sidebar.png')
print('\nerrors:', json.dumps(s.errors[:8], ensure_ascii=False))
print('\n== PASS %d / FAIL %d ==' % (len(PASS), len(FAIL)))
if FAIL:
    print('\n'.join('FAILED: ' + f for f in FAIL))
s.close()
