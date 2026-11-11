#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第一步：检查书库渲染、打开书籍、阅读器排版是否正常。"""
import json
import sys
import time

sys.path.insert(0, '/home/ut000190@uos/lumen-books/tools')
from cdp import Session

s = Session()
print('title:', s.eval('document.title'))
print('body size:', s.eval('[innerWidth, innerHeight]'))
print('library state:', s.eval('JSON.stringify({books:(S.library.books||[]).length, shelf:S.shelf})'))
print('cards:', s.eval("document.querySelectorAll('#book-grid .book-card').length"))
print('empty hidden:', s.eval("document.querySelector('#empty-state').classList.contains('hidden')"))
s.shot('/home/ut000190@uos/lumen-books/shots/01-library.png')

# 打开第一本书
s.eval("document.querySelector('#book-grid .book-card').click()")
time.sleep(3.5)
info = s.eval("""JSON.stringify({
  readerActive: document.querySelector('#view-reader').classList.contains('active'),
  ready: Reader.ready, chapter: Reader.chapterIndex, toc: Reader.toc.length,
  pages: Reader.layout ? 0 : 0, frameSrc: document.querySelector('#book-frame').src,
  docOk: !!(Reader.doc && Reader.doc.body), textLen: Reader.doc ? Reader.doc.body.textContent.length : 0,
  scrollW: Reader.doc ? Reader.doc.documentElement.scrollWidth : 0,
  bodyScrollW: Reader.doc ? Reader.doc.body.scrollWidth : 0,
  scrollLeft: Reader.doc ? Reader.doc.documentElement.scrollLeft : 0,
  pagesText: document.querySelector('#rb-pages').textContent,
  chapterTitle: document.querySelector('#rb-chapter').textContent
})""")
print('reader:', info)
s.shot('/home/ut000190@uos/lumen-books/shots/02-reader.png')
print('errors:', json.dumps(s.errors[:10], ensure_ascii=False, indent=1))
s.close()
