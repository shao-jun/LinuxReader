'use strict';
/* 通用工具 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const S = {
  library: { version: 1, books: [], deleted: {}, collections: [] },
  settings: {
    theme: 'original',
    appearance: 'light',
    font: 'serif', weight: 400,
    fontSize: 19, lineHeight: 1.62, letterSpacing: 0.1, wordSpacing: 0, margin: 8,
    mode: 'paged', transition: 'slide', smooth: true, autoSync: false, syncIntervalMin: 30
  },
  sync: { type: '', url: '', user: '', pass: '', dir: '', auto: false, rejectUnauthorized: true },
  tts: null,
  shelf: 'all', collectionId: null, viewMode: 'grid', sort: 'recent', search: '', tag: null,
  book: null,
  version: '1.0.3',
  home: ''
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid(prefix) {
  return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDate(ts) {
  if (!ts) return '未读';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  if (sameDay) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function pct(v) { return Math.round(Math.max(0, Math.min(1, v || 0)) * 100); }

let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2400);
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

/** 由书名生成稳定的封面渐变 */
function coverGradient(title) {
  let h = 0;
  const s = String(title || '书');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  const a = h, b = (h + 42) % 360;
  return `linear-gradient(150deg, hsl(${a} 42% 46%), hsl(${b} 48% 30%))`;
}

function openModal(id) {
  $('#modal-mask').classList.remove('hidden');
  $$('.modal').forEach((m) => m.classList.remove('open'));
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}
function closeModal() {
  $('#modal-mask').classList.add('hidden');
  $$('.modal').forEach((m) => m.classList.remove('open'));
}

/* 阅读主题：每个主题带一整套默认排版，用户在主题基础上微调 */
const READ_THEMES = {
  original: {
    label: '原始', desc: '出版社原样', paper: '#fcfcfa', text: '#1d1d1f', sample: '#ffffff',
    font: 'serif', weight: 400, fontSize: 19, lineHeight: 1.62, letterSpacing: 0.1, wordSpacing: 0, margin: 8, dark: false
  },
  quiet: {
    label: '安静', desc: '疏朗留白', paper: '#f6f4ef', text: '#3d3b36', sample: '#f6f4ef',
    font: 'serif', weight: 400, fontSize: 18, lineHeight: 1.9, letterSpacing: 0.3, wordSpacing: 0.6, margin: 11, dark: false
  },
  paper: {
    label: '纸张', desc: '米色书页', paper: '#f2e7d0', text: '#4a3b28', sample: '#f2e7d0',
    font: 'kai', weight: 400, fontSize: 19, lineHeight: 1.95, letterSpacing: 0.3, wordSpacing: 0.8, margin: 9, dark: false
  },
  bold: {
    label: '粗体', desc: '深色强调', paper: '#ffffff', text: '#0f0f11', sample: '#ffffff',
    font: 'sans', weight: 700, fontSize: 20, lineHeight: 1.72, letterSpacing: 0, wordSpacing: 0, margin: 7, dark: false
  },
  calm: {
    label: '平静', desc: '冷灰护眼', paper: '#edf1f2', text: '#2b3236', sample: '#edf1f2',
    font: 'sans', weight: 400, fontSize: 19, lineHeight: 2.0, letterSpacing: 0.4, wordSpacing: 1, margin: 12, dark: false
  },
  focus: {
    label: '专注', desc: '夜间模式', paper: '#15151a', text: '#c9c9d2', sample: '#15151a',
    font: 'sans', weight: 400, fontSize: 19, lineHeight: 1.95, letterSpacing: 0.3, wordSpacing: 0.6, margin: 13, dark: true
  }
};

const THEME_KEYS = ['original', 'quiet', 'paper', 'bold', 'calm', 'focus'];

function themeOf(name) {
  return READ_THEMES[name] || READ_THEMES.original;
}

/** 把一个主题的默认值灌进设置（用户之后的微调只在字段上生效） */
function applyThemeDefaults(settings, name) {
  const t = themeOf(name);
  settings.theme = name;
  for (const k of ['font', 'weight', 'fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'margin']) {
    settings[k] = t[k];
  }
  return settings;
}

const FONT_STACKS = {
  serif: '"Source Han Serif SC","思源宋体","Noto Serif CJK SC",serif',
  sans: '"Source Han Sans SC","思源黑体","Noto Sans CJK SC",sans-serif',
  kai: '"国标楷体","方正楷体_GBK","KaiTi","Kaiti SC",serif',
  fangsong: '"国标仿宋","方正仿宋_GBK","FangSong",serif'
};

const FONT_LABELS = { serif: '宋体', sans: '黑体', kai: '楷体', fangsong: '仿宋' };

function applyChromeTheme() {
  const appearance = S.settings.appearance || 'light';
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = appearance === 'dark' || (appearance === 'system' && sysDark) || themeOf(S.settings.theme).dark;
  document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.style.setProperty('--paper', themeOf(S.settings.theme).paper);
}
