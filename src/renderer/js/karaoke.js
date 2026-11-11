'use strict';
/* 歌词（卡拉OK）模式：逐句高亮、自动滚动、可跟读 */
const Karaoke = (() => {
  const api = window.linuxreader;
  const K = {
    on: false, lines: [], idx: 0, playing: false,
    startTs: 0, dur: 0, raf: 0, speed: 1, tts: null, audio: null,
    chapter: -1, autoAdvance: false
  };

  const box = () => $('#karaoke');

  function start() {
    if (!Reader.ready) { toast('先打开一本书'); return; }
    K.on = true;
    K.playing = false;
    box().classList.remove('hidden');
    build(true);
    $('#btn-karaoke').classList.add('active');
    setTimeout(() => play(), 120);
  }

  function stop() {
    K.on = false; K.playing = false;
    cancelAnimationFrame(K.raf);
    if (K.audio) { try { K.audio.pause(); } catch (e) {} K.audio = null; }
    api.ttsStop().catch(() => {});
    const b = box();
    if (b) b.classList.add('hidden');
    const btn = $('#btn-karaoke');
    if (btn) btn.classList.remove('active');
  }

  function toggle() { K.on ? stop() : start(); }

  function build(toCurrent) {
    const lines = Reader.chapterSentences();
    K.lines = lines;
    K.chapter = Reader.chapterIndex;
    // 定位到当前阅读位置
    if (toCurrent) {
      const loc = Reader.locationNow();
      let i = lines.findIndex((l) => loc.offset >= l.start && loc.offset < l.end);
      if (i < 0) {
        i = 0;
        for (let j = 0; j < lines.length; j++) if (lines[j].start <= loc.offset) i = j;
      }
      K.idx = Math.max(0, i);
    } else {
      K.idx = 0;
    }
    render();
    center(false);
  }

  function render() {
    const b = box();
    b.innerHTML =
      '<div class="ka-head">' +
      '<span class="ka-title">歌词模式</span>' +
      '<span class="ka-ch">' + esc(Reader.toc.find((t) => t.chapter === K.chapter)?.label || ('第 ' + (K.chapter + 1) + ' 节')) + '</span>' +
      '<span class="spacer"></span>' +
      '<button id="ka-prev">上一句</button>' +
      '<button id="ka-next">下一句</button>' +
      '<button id="ka-exit">退出歌词</button>' +
      '</div>' +
      '<div class="ka-lines" id="ka-lines"><div class="ka-track" id="ka-track">' +
      K.lines.map((l, i) => '<div class="ka-line" data-i="' + i + '">' + esc(l.text) + '</div>').join('') +
      '</div></div>' +
      '<div class="ka-foot">' +
      '<button class="ka-big" id="ka-play">▶</button>' +
      '<span id="ka-pos">1 / ' + K.lines.length + '</span>' +
      '<div class="ka-progress"><input type="range" id="ka-range" min="0" max="' + Math.max(1, K.lines.length - 1) + '" value="' + K.idx + '"></div>' +
      '<div class="ka-speed">语速 <input type="range" id="ka-speed" min="60" max="320" value="' + Math.round(K.speed * 100) + '"><span id="ka-speed-val">' + K.speed.toFixed(1) + 'x</span></div>' +
      '<span class="ka-tip">空格 播放/暂停 · ← → 切换句子</span>' +
      '</div>';

    $('#ka-exit').onclick = stop;
    $('#ka-prev').onclick = () => go(K.idx - 1);
    $('#ka-next').onclick = () => go(K.idx + 1);
    $('#ka-play').onclick = () => (K.playing ? pause() : play());
    $('#ka-range').oninput = (e) => go(Number(e.target.value));
    $('#ka-speed').oninput = (e) => {
      K.speed = Number(e.target.value) / 100;
      $('#ka-speed-val').textContent = K.speed.toFixed(1) + 'x';
    };
    $$('.ka-line').forEach((el) => {
      el.onclick = () => go(Number(el.dataset.i));
    });
    highlightLine();
  }

  function highlightLine() {
    $$('.ka-line').forEach((el, i) => {
      el.classList.toggle('cur', i === K.idx);
      el.classList.toggle('prev', i < K.idx);
      el.classList.toggle('next', i > K.idx);
      if (i === K.idx) {
        const t = K.lines[i] ? K.lines[i].text : '';
        el.innerHTML = '<span class="wipe">' + esc(t) + '</span>';
      } else if (el.querySelector('.wipe')) {
        el.textContent = el.textContent;
      }
    });
    const pos = $('#ka-pos');
    if (pos) pos.textContent = (K.idx + 1) + ' / ' + K.lines.length;
    const range = $('#ka-range');
    if (range) range.value = K.idx;
  }

  function center(animate = true) {
    const track = $('#ka-track');
    const linesEl = $('#ka-lines');
    if (!track || !linesEl) return;
    const cur = track.children[K.idx];
    if (!cur) return;
    track.style.transition = animate ? '' : 'none';
    const wrapH = linesEl.clientHeight;
    const y = cur.offsetTop + cur.offsetHeight / 2 - wrapH / 2;
    track.style.transform = 'translateY(' + (-y) + 'px)';
    if (!animate) requestAnimationFrame(() => { track.style.transition = ''; });
  }

  function go(i) {
    if (!K.lines.length) return;
    if (i < 0) {
      if (Reader.chapterIndex > 0) { jumpChapter(-1); }
      return;
    }
    if (i >= K.lines.length) {
      if (!jumpChapter(1)) { pause(); toast('全书读完啦'); }
      return;
    }
    K.idx = i;
    highlightLine();
    center(true);
    syncReader();
    restartTimer();
  }

  function jumpChapter(dir) {
    const wasPlaying = K.playing;
    const ok = dir > 0 ? Reader.nextChapter() : null;
    if (dir < 0) {
      const prev = Reader.chapterIndex - 1;
      if (prev < 0) return false;
      Reader.jumpTo(prev, 0, '歌词模式');
      build(true);
      if (wasPlaying) play();
      return true;
    }
    if (!ok) return false;
    setTimeout(() => {
      build(false);
      if (wasPlaying) play();
    }, 420);
    return true;
  }

  function syncReader() {
    const line = K.lines[K.idx];
    if (!line) return;
    try { Reader.syncToOffset(line.start); } catch (e) {}
  }

  function speedRate() { return Math.round(175 * K.speed); }
  function duration(text) {
    const chars = Math.max(4, text.replace(/\s/g, '').length);
    return Math.max(1100, chars * 230 / K.speed);
  }

  async function play() {
    if (!K.on) return;
    K.playing = true;
    const btn = $('#ka-play');
    if (btn) btn.textContent = '❚❚';
    syncReader();
    startSentence();
  }

  function pause() {
    K.playing = false;
    cancelAnimationFrame(K.raf);
    if (K.audio) { try { K.audio.pause(); } catch (e) {} K.audio = null; }
    api.ttsStop().catch(() => {});
    const btn = $('#ka-play');
    if (btn) btn.textContent = '▶';
  }

  function restartTimer() {
    if (!K.playing) return;
    startSentence();
  }

  async function startSentence() {
    cancelAnimationFrame(K.raf);
    const line = K.lines[K.idx];
    if (!line) return;
    K.dur = duration(line.text);
    K.startTs = performance.now();
    animateWipe();
    if (S.tts) await speak(line.text);
  }

  async function speak(text) {
    try {
      const res = await api.ttsSpeak(text, speedRate());
      if (!K.playing) return;
      if (res && res.audio) {
        const audio = new Audio(res.audio);
        K.audio = audio;
        audio.onended = () => { if (K.playing) next(); };
        audio.play().catch(() => {});
      } else if (res && res.ok) {
        next();
      }
    } catch (e) { /* 没有语音引擎就走计时 */ }
  }

  function next() {
    if (!K.playing) return;
    if (K.idx >= K.lines.length - 1) { go(K.idx + 1); return; }
    go(K.idx + 1);
  }

  function animateWipe() {
    if (!K.playing) return;
    const el = $('.ka-line.cur .wipe');
    const now = performance.now();
    const p = Math.min(1, (now - K.startTs) / K.dur);
    if (el) el.style.setProperty('--wp', (p * 100).toFixed(1) + '%');
    if (p >= 1) { next(); return; }
    K.raf = requestAnimationFrame(animateWipe);
  }

  document.addEventListener('keydown', (e) => {
    if (!K.on) return;
    if (e.key === 'Escape') { stop(); return; }
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); K.playing ? pause() : play(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(K.idx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(K.idx - 1); }
  });

  window.addEventListener('resize', () => { if (K.on) center(false); });

  return { start, stop, toggle, get active() { return K.on; } };
})();
