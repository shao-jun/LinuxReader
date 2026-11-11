'use strict';
// EPUB 解包：零依赖 ZIP 读取（支持 store/deflate），以及书籍 HTML 的安全化处理。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

function readCentralDirectory(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 EPUB / ZIP 文件（找不到目录结尾记录）');
  let count = buf.readUInt16LE(eocd + 10);
  let cenSize = buf.readUInt32LE(eocd + 12);
  let cenOff = buf.readUInt32LE(eocd + 16);

  // ZIP64 处理（EPUB 极少见，但大书可能触发）
  if (cenOff === 0xffffffff || count === 0xffff || cenSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc > 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(z64) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cenSize = Number(buf.readBigUInt64LE(z64 + 40));
        cenOff = Number(buf.readBigUInt64LE(z64 + 48));
      }
    }
  }

  const entries = [];
  let off = cenOff;
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, csize, localOff });
    off += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

function extractEntry(buf, e) {
  const lo = e.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('损坏的 ZIP 条目: ' + e.name);
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  throw new Error('不支持的压缩方式 (' + e.method + '): ' + e.name);
}

function safeJoin(base, rel) {
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  const full = path.join(base, norm);
  if (!full.startsWith(base + path.sep) && full !== base) return null;
  return full;
}

/** 解压整本 EPUB 到 targetDir，返回文件清单 */
function unzipTo(file, targetDir) {
  const buf = fs.readFileSync(file);
  const entries = readCentralDirectory(buf);
  fs.mkdirSync(targetDir, { recursive: true });
  const written = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const dest = safeJoin(targetDir, e.name);
    if (!dest) continue;
    // 只解压书籍内容，跳过 macOS 垃圾文件
    if (e.name.startsWith('__MACOSX/') || e.name.endsWith('.DS_Store')) continue;
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(dest, extractEntry(buf, e));
      written.push(e.name);
    } catch (err) {
      // 单个条目失败不影响整本书
    }
  }
  return written;
}

function sha1File(file) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

/**
 * 注入阅读器基础样式，去掉脚本与内联事件，避免书里的 JS 在我们的 origin 下执行。
 */
const READER_CSS = [
  'html{ -webkit-text-size-adjust:100%; }',
  'body{ margin:0 !important; padding:0 !important; background:transparent !important; }',
  'img,svg,video{ max-width:100% !important; height:auto !important; }',
  'body{ font-family:var(--linuxreader-font, "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", serif); }'
].join('\n');

function sanitizeHtml(html) {
  let out = String(html);
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<script\b[^>]*\/?>/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  out = out.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  out = out.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  const style = '<style id="linuxreader-base">' + READER_CSS + '</style>';
  if (/<\/head\s*>/i.test(out)) out = out.replace(/<\/head\s*>/i, style + '</head>');
  else out = style + out;
  return out;
}

module.exports = { unzipTo, readCentralDirectory, extractEntry, sanitizeHtml, sha1File, READER_CSS };
