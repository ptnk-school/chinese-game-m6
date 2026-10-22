/* =========================================================
   汉语大冒险 · ผจญภัยภาษาจีน — ตัวเกมหลัก
   ========================================================= */
(() => {
'use strict';

/* ---------------- ตัวช่วย ---------------- */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (a, n) => shuffle(a).slice(0, n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ALL_VOCAB = [];
Object.keys(VOCAB).forEach(l => VOCAB[l].forEach(([zh, py, th]) => ALL_VOCAB.push({ zh, py, th, lesson: +l })));
const vocabOf = lesson => lesson ? ALL_VOCAB.filter(v => v.lesson === lesson) : ALL_VOCAB;
const ALL_SENT = [];
Object.keys(SENTENCES).forEach(l => SENTENCES[l].forEach(([s, th]) => ALL_SENT.push({ tokens: s.split('|').map(t => t.replace(/[。，？！、]/g, '')), full: s.replace(/\|/g, ''), th, lesson: +l })));
const sentOf = lesson => lesson ? ALL_SENT.filter(s => s.lesson === lesson) : ALL_SENT;
const levelById = id => LEVELS.find(l => l.id === id);
const worldById = id => WORLDS.find(w => w.id === id);

/* ---------------- ระบบบันทึก & เชื่อมต่อออนไลน์ ---------------- */
const KEY = 'hanyu_adventure_v1';
const TEACHER_PIN = '2365';
let DB;
try { DB = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { DB = {}; }
DB.players = DB.players || {};
DB.settings = Object.assign({ sound: true, rate: 0.8, unlockAll: false, cloudUrl: '' }, DB.settings || {});
DB.last = DB.last || '';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { } };

// รับลิงก์ Google Sheet จาก URL parameter (?sheet=...) อัตโนมัติถ้าครูแชร์ลิงก์พร้อมพารามิเตอร์
try {
  const qs = new URLSearchParams(location.search);
  const sUrl = qs.get('sheet') || qs.get('cloud');
  if (sUrl && /^https:\/\/script\.google\.com\//i.test(sUrl.trim())) {
    DB.settings.cloudUrl = sUrl.trim();
    save();
  }
} catch (e) { }

const getCloudUrl = () => (DB.settings.cloudUrl || (typeof DEFAULT_CLOUD_URL !== 'undefined' ? DEFAULT_CLOUD_URL : '') || '').trim();
const normName = s => String(s || '').trim().replace(/\s+/g, ' ');
function findExistingName(raw) {
  const target = normName(raw).toLowerCase();
  if (!target) return null;
  return Object.keys(DB.players).find(k => normName(k).toLowerCase() === target) || null;
}
function mergeLevels(oldLv, newLv) {
  const out = {};
  const keys = new Set([...Object.keys(oldLv || {}), ...Object.keys(newLv || {})]);
  keys.forEach(k => {
    const a = (oldLv && oldLv[k]) || {};
    const b = (newLv && newLv[k]) || {};
    out[k] = {
      best: Math.max(Number(a.best) || 0, Number(b.best) || 0),
      stars: Math.max(Number(a.stars) || 0, Number(b.stars) || 0),
      plays: Math.max(Number(a.plays) || 0, Number(b.plays) || 0),
      last: Math.max(Number(a.last) || 0, Number(b.last) || 0)
    };
  });
  return out;
}

let player = null;
const P = () => DB.players[player];

function totals(name) {
  const lv = (DB.players[name] || {}).levels || {};
  let stars = 0, score = 0, passed = 0, plays = 0;
  Object.values(lv).forEach(r => {
    stars += Number(r.stars) || 0;
    score += Number(r.best) || 0;
    if ((Number(r.stars) || 0) > 0) passed++;
    plays += Number(r.plays) || 0;
  });
  return { stars, score, passed, plays };
}

async function pullCloudAll(silent = true) {
  const url = getCloudUrl();
  if (!url) return { ok: false, noUrl: true };
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}action=list&t=${Date.now()}`, { method: 'GET', cache: 'no-store' });
    const data = await res.json();
    if (!data || !data.ok || !data.players) throw new Error((data && data.error) || 'Invalid response');
    Object.keys(data.players).forEach(cloudName => {
      const clean = normName(cloudName);
      if (!clean) return;
      const key = findExistingName(clean) || clean;
      if (!DB.players[key]) DB.players[key] = { levels: {}, created: Date.now() };
      DB.players[key].levels = mergeLevels(DB.players[key].levels, data.players[cloudName].levels || {});
      if (data.players[cloudName].updated) DB.players[key].updated = data.players[cloudName].updated;
    });
    save();
    if (!silent) toast('☁️ ดึงข้อมูลคะแนนล่าสุดจาก Google Sheet แล้ว ✓');
    return { ok: true, count: Object.keys(data.players).length };
  } catch (err) {
    if (!silent) toast('⚠️ เชื่อมต่อ Google Sheet ไม่สำเร็จ กรุณาตรวจสอบลิงก์หรืออินเทอร์เน็ต');
    return { ok: false, error: err };
  }
}

async function pushCloudPlayer(name, lastPlay = null, replace = false) {
  const url = getCloudUrl();
  if (!url || !name || !DB.players[name]) return { ok: false, noUrl: true };
  const payload = JSON.stringify({
    action: 'sync',
    name,
    levels: DB.players[name].levels || {},
    lastPlay,
    replace
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload
    });
    const data = await res.json();
    if (data && data.ok && data.levels) {
      DB.players[name].levels = replace ? data.levels : mergeLevels(DB.players[name].levels, data.levels);
      save();
      return { ok: true, data };
    }
    throw new Error((data && data.error) || 'Sync error');
  } catch (err) {
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload
      });
      return { ok: true, opaque: true };
    } catch (e2) {
      return { ok: false, error: e2 };
    }
  }
}
const MAX_STARS = LEVELS.length * 3;
function rankOf(stars) {
  if (stars >= 66) return '🐲 ราชามังกร 龙王';
  if (stars >= 46) return '🥋 ปรมาจารย์ 大师';
  if (stars >= 26) return '⚔️ นักรบภาษา 勇士';
  if (stars >= 10) return '📚 ศิษย์ฝึกหัด 学徒';
  return '🌱 มือใหม่ 新手';
}

/* ---------------- เสียงเอฟเฟกต์ ---------------- */
let AC = null;
function tone(freq, dur, type = 'sine', when = 0, vol = .15) {
  if (!DB.settings.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime + when);
    g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + when + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(AC.currentTime + when); o.stop(AC.currentTime + when + dur + .02);
  } catch (e) { }
}
const sfx = {
  ok: () => { tone(660, .12, 'triangle'); tone(990, .18, 'triangle', .09); },
  bad: () => { tone(220, .25, 'sawtooth', 0, .08); tone(170, .3, 'sawtooth', .1, .08); },
  flip: () => tone(520, .06, 'square', 0, .05),
  click: () => tone(400, .05, 'triangle', 0, .08),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, 'triangle', i * .12)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, .3, 'sine', i * .18)),
  hit: () => { tone(120, .2, 'square', 0, .12); tone(80, .3, 'sawtooth', .05, .1); }
};

/* ---------------- เสียงพูดภาษาจีน (TTS) ---------------- */
let zhVoice = null;
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find(v => /zh[-_]CN/i.test(v.lang) && /google|xiaoxiao|yunxi|natural|online/i.test(v.name))
    || vs.find(v => /zh[-_]CN/i.test(v.lang))
    || vs.find(v => /^zh/i.test(v.lang) && !/HK|yue/i.test(v.lang))
    || vs.find(v => /^zh/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
const hasZh = () => !!zhVoice;
function speak(text, rate) {
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[|【】]/g, ''));
    u.lang = 'zh-CN'; if (zhVoice) u.voice = zhVoice;
    u.rate = rate || DB.settings.rate;
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, 15000);
  });
}

/* ---------------- หน้าจอ ---------------- */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function floatPts(target, text, isBad) {
  const r = target && target.getBoundingClientRect ? target.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
  const f = el('div', 'float-pts' + (isBad ? ' bad' : ''), text);
  f.style.left = (r.left + r.width / 2 - 20) + 'px'; f.style.top = (r.top - 10) + 'px';
  document.body.appendChild(f); setTimeout(() => f.remove(), 1000);
}

/* ---------------- หน้าเริ่ม ---------------- */
function updateNameStatus() {
  const elSt = $('#name-status');
  if (!elSt) return;
  const raw = normName($('#inp-name').value);
  if (!raw) {
    elSt.className = 'name-status';
    elSt.innerHTML = '💡 ใช้ชื่อเดิมทุกครั้งที่เข้าเล่น คะแนนและดาวจะสะสมต่อเนื่องอัตโนมัติ';
    return;
  }
  const ex = findExistingName(raw);
  if (ex) {
    const t = totals(ex);
    elSt.className = 'name-status found';
    elSt.innerHTML = `✨ พบข้อมูลเดิมของ <b>${esc(ex)}</b> — สะสม ⭐ <b>${t.stars}/${MAX_STARS}</b> ดาว · 🪙 <b>${t.score.toLocaleString()}</b> คะแนน (ผ่าน ${t.passed}/${LEVELS.length} ด่าน) กดเริ่มเพื่อเล่นต่อได้เลย!`;
  } else {
    elSt.className = 'name-status';
    elSt.innerHTML = `🌱 ผู้เล่นใหม่ <b>${esc(raw)}</b> — ครั้งต่อไปพิมพ์ชื่อเดิมนี้เพื่อสะสมคะแนนและดาวต่อได้ทันที`;
  }
}

function renderPlayerButtons() {
  const list = $('#player-list');
  if (!list) return;
  list.innerHTML = '';
  const names = Object.keys(DB.players).sort((a, b) => totals(b).score - totals(a).score || totals(b).stars - totals(a).stars);
  if (names.length) {
    list.appendChild(el('div', '', '<small style="width:100%;display:block;color:#8a5a44">รายชื่อผู้เล่น (กดชื่อตัวเองเพื่อเล่นต่อและอัปเดตคะแนน)</small>'));
    names.slice(0, 16).forEach(n => {
      const t = totals(n);
      const b = el('button', '', `${esc(n)} ⭐${t.stars} · 🪙${t.score.toLocaleString()}`);
      b.onclick = () => login(n);
      list.appendChild(b);
    });
  }
}

function renderStart() {
  $('#inp-name').value = DB.last || '';
  renderPlayerButtons();
  updateNameStatus();
  show('screen-start');
  if (getCloudUrl()) {
    pullCloudAll(true).then(r => {
      if (r.ok && $('#screen-start').classList.contains('active')) {
        renderPlayerButtons();
        updateNameStatus();
      }
    });
  }
}

async function login(name) {
  const clean = normName(name);
  if (!clean) { toast('กรุณาพิมพ์ชื่อก่อนนะ 😊'); $('#inp-name').focus(); return; }
  const existing = findExistingName(clean);
  const finalName = existing || clean;
  if (!DB.players[finalName]) DB.players[finalName] = { levels: {}, created: Date.now() };
  player = finalName; DB.last = finalName; save(); sfx.click();
  renderMap();
  if (getCloudUrl()) {
    const r = await pullCloudAll(true);
    if (r.ok && player === finalName) {
      await pushCloudPlayer(finalName);
      if ($('#screen-map').classList.contains('active')) renderMap();
    }
  }
}
$('#btn-start').onclick = () => login($('#inp-name').value);
$('#inp-name').addEventListener('input', updateNameStatus);
$('#inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') login($('#inp-name').value); });
$('#btn-logout').onclick = () => { player = null; renderStart(); };

/* ---------------- แผนที่ ---------------- */
function isLocked(lv) {
  if (DB.settings.unlockAll) return false;
  if (lv.needStars) return totals(player).stars < lv.needStars;
  return false;
}
function starStr(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
function renderMap() {
  const t = totals(player);
  $('#map-name').textContent = player;
  $('#map-rank').textContent = rankOf(t.stars) + ` · ⭐ ${t.stars}/${MAX_STARS}`;
  $('#map-stars').textContent = t.stars;
  $('#map-score').textContent = t.score.toLocaleString();
  const wl = $('#world-list'); wl.innerHTML = '';
  WORLDS.forEach(w => {
    const lvls = LEVELS.filter(l => l.world === w.id);
    const got = lvls.reduce((s, l) => s + ((P().levels[l.id] || {}).stars || 0), 0);
    const box = el('div', 'world'); box.style.setProperty('--wc', w.color);
    box.innerHTML = `<div class="world-head"><div class="world-icon">${w.icon}</div>
      <div class="world-name">${w.name}<small>${w.sub}</small></div>
      <div class="world-stars">⭐ ${got}/${lvls.length * 3}</div></div>`;
    const ll = el('div', 'level-list');
    lvls.forEach((lv, i) => {
      const rec = P().levels[lv.id] || {};
      const locked = isLocked(lv);
      const b = el('button', 'level' + (locked ? ' locked' : ''));
      b.innerHTML = `<div class="num">${locked ? '🔒' : (w.id === 'boss' ? '🐉' : i + 1)}</div>
        <div class="info"><b>${esc(lv.title)}</b><small>${locked ? `ต้องมี ⭐ ${lv.needStars} ดวงจึงจะท้าทายได้` : esc(lv.desc)}</small></div>
        <div><div class="stars" style="color:${rec.stars ? '#f4a100' : '#d9c4a6'}">${starStr(rec.stars || 0)}</div>
        <div class="best">${rec.best ? '🪙 ' + rec.best : ''}</div></div>`;
      b.onclick = () => { if (locked) { toast(`สะสมดาวให้ครบ ${lv.needStars} ดวงก่อนนะ (ตอนนี้มี ${t.stars})`); sfx.bad(); return; } startLevel(lv); };
      ll.appendChild(b);
    });
    box.appendChild(ll); wl.appendChild(box);
  });
  show('screen-map');
}

/* ---------------- Session ---------------- */
let S = null;
const area = () => $('#play-area');
function startLevel(lv) {
  stopSession();
  S = { lv, score: 0, correct: 0, total: 0, combo: 0, maxCombo: 0, review: [], timers: [], intervals: [], ended: false, cleanups: [] };
  $('#play-title').textContent = worldById(lv.world).icon + ' ' + lv.title;
  $('#play-extra').hidden = true;
  area().innerHTML = '';
  updateHud(); setProgress(0, 1);
  show('screen-play');
  ENGINES[lv.type](lv);
}
function stopSession() {
  if (!S) return;
  S.ended = true;
  S.timers.forEach(clearTimeout); S.intervals.forEach(clearInterval);
  S.cleanups.forEach(f => { try { f(); } catch (e) { } });
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
const later = (fn, ms) => { const s = S; const id = setTimeout(() => { if (s === S && !s.ended) fn(); }, ms); S.timers.push(id); return id; };
const every = (fn, ms) => { const id = setInterval(fn, ms); S.intervals.push(id); return id; };
function updateHud() {
  $('#play-score').textContent = S.score.toLocaleString();
  const c = $('#play-combo');
  if (S.combo >= 2) { c.hidden = false; c.textContent = `🔥 x${S.combo}`; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; }
  else c.hidden = true;
}
function setProgress(done, total) { $('#play-progress').style.width = Math.min(100, done / total * 100) + '%'; }
function good(target, base = 100) {
  S.correct++; S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
  const pts = base + Math.min(S.combo - 1, 5) * 20;
  S.score += pts; floatPts(target, '+' + pts); sfx.ok(); updateHud();
}
function bad(target, review) {
  S.combo = 0; floatPts(target, '✗', true); sfx.bad(); updateHud();
  if (review) S.review.push(review);
}
$('#btn-quit').onclick = () => {
  if (S && !S.ended && !confirm('ออกจากด่านนี้? คะแนนรอบนี้จะไม่ถูกบันทึก')) return;
  stopSession(); renderMap();
};

function finish(opt = {}) {
  if (!S || S.ended) return;
  const total = opt.total != null ? opt.total : S.total;
  const correct = opt.correct != null ? opt.correct : S.correct;
  let stars = opt.stars;
  if (stars == null) {
    const r = total ? correct / total : 0;
    stars = r >= .9 ? 3 : r >= .7 ? 2 : r >= .5 ? 1 : 0;
  }
  if (opt.bonus) S.score += opt.bonus;
  stopSession();
  const lv = S.lv;
  const prevTotals = totals(player);
  const rec = P().levels[lv.id] || { best: 0, stars: 0, plays: 0 };
  const prevBest = Number(rec.best) || 0;
  const prevStars = Number(rec.stars) || 0;
  const newBest = S.score > prevBest;
  const newStars = stars > prevStars;
  rec.best = Math.max(prevBest, S.score);
  rec.stars = Math.max(prevStars, stars);
  rec.plays = (Number(rec.plays) || 0) + 1;
  rec.last = Date.now();
  P().levels[lv.id] = rec;
  P().updated = new Date().toLocaleString('th-TH');
  save();
  const nowTotals = totals(player);
  const diffStars = nowTotals.stars - prevTotals.stars;
  const diffScore = nowTotals.score - prevTotals.score;

  const titles = ['พยายามอีกนิดนะ 💪', 'ผ่านแล้ว! 👍', 'เก่งมาก! 🎉', 'สุดยอด! 完美！ 🏆'];
  $('#res-title').textContent = opt.title || titles[stars];
  $('#res-stars').innerHTML = [0, 1, 2].map(i => `<span style="color:${i < stars ? '#f4a100' : '#d9c4a6'}">${i < stars ? '★' : '☆'}</span>`).join('');
  $('#res-score').textContent = S.score.toLocaleString();
  $('#res-correct').textContent = opt.correctText || `${correct}/${total}`;
  $('#res-combo').textContent = S.maxCombo;

  if ((newBest || newStars) && (diffStars > 0 || diffScore > 0)) {
    const gains = [];
    if (diffStars > 0) gains.push(`+${diffStars} ⭐`);
    if (diffScore > 0) gains.push(`+${diffScore.toLocaleString()} คะแนน`);
    $('#res-best').textContent = `🎉 อัปเดตสถิติใหม่ด่านนี้! (${gains.join(' , ')})`;
  } else {
    $('#res-best').textContent = `สถิติสูงสุดของด่านนี้: ⭐ ${rec.stars}/3 · 🪙 ${rec.best.toLocaleString()} คะแนน`;
  }

  const rt = $('#res-total');
  if (rt) {
    rt.innerHTML = `👤 <b>${esc(player)}</b> — สะสมรวม ⭐ <b>${nowTotals.stars}/${MAX_STARS}</b> ดาว · 🪙 <b>${nowTotals.score.toLocaleString()}</b> คะแนน (ผ่าน ${nowTotals.passed}/${LEVELS.length} ด่าน)`;
  }

  const rs = $('#res-sync');
  if (rs) {
    if (getCloudUrl()) {
      rs.textContent = '☁️ กำลังอัปเดตคะแนนและดาวเข้าตารางครู...';
      pushCloudPlayer(player, { levelId: lv.id, levelTitle: lv.title, stars, score: S.score }).then(r => {
        if (r.ok) {
          const afterT = totals(player);
          if (rt) rt.innerHTML = `👤 <b>${esc(player)}</b> — สะสมรวม ⭐ <b>${afterT.stars}/${MAX_STARS}</b> ดาว · 🪙 <b>${afterT.score.toLocaleString()}</b> คะแนน (ผ่าน ${afterT.passed}/${LEVELS.length} ด่าน)`;
          rs.textContent = `☁️ อัปเดตคะแนนของ "${player}" เข้า Google Sheet ครูเรียบร้อย ✓`;
        } else {
          rs.textContent = '💾 บันทึกในเครื่องแล้ว (จะซิงก์ออนไลน์เมื่อเชื่อมต่อสำเร็จ)';
        }
      });
    } else {
      rs.textContent = `💾 อัปเดตคะแนนสะสมของ "${player}" เรียบร้อย ✓`;
    }
  }
  const rv = $('#res-review'); rv.innerHTML = '';
  if (S.review.length) {
    rv.appendChild(el('div', '', '<b>📝 ข้อที่ควรทบทวน</b>'));
    S.review.slice(0, 12).forEach(r => rv.appendChild(el('div', '', r)));
  }
  const idx = LEVELS.indexOf(lv);
  const next = LEVELS[idx + 1];
  $('#btn-next').hidden = !next || isLocked(next);
  $('#btn-next').onclick = () => startLevel(next);
  $('#btn-retry').onclick = () => startLevel(lv);
  show('screen-result');
  if (stars >= 2) { sfx.win(); confetti(); } else if (stars === 0) sfx.lose(); else sfx.ok();
}
$('#btn-tomap').onclick = () => renderMap();

/* ---------------- ตัวช่วยสร้างหน้าจอคำถาม ---------------- */
function speakerBtn(text, big = true) {
  const wrap = el('div', '', '');
  wrap.style.textAlign = 'center';
  const b = el('button', big ? 'speaker' : 'btn btn-sm', big ? '🔊' : '🔊 ฟัง');
  const slow = el('button', 'btn btn-sm btn-ghost slow-btn', '🐢 ช้า');
  const play = async (rate) => { b.classList.add('playing'); await speak(text, rate); b.classList.remove('playing'); };
  b.onclick = () => play(); slow.onclick = () => play(.55);
  wrap.appendChild(b);
  if (big) { wrap.appendChild(el('br')); wrap.appendChild(slow); slow.style.marginTop = '12px'; }
  wrap.play = play;
  return wrap;
}
function voiceNotice(parent) {
  if (!('speechSynthesis' in window)) {
    parent.appendChild(el('div', 'notice', '⚠️ เบราว์เซอร์นี้ไม่รองรับเสียงพูด แนะนำให้ใช้ Google Chrome หรือ Microsoft Edge'));
  } else if (!hasZh()) {
    parent.appendChild(el('div', 'notice', '⚠️ ไม่พบเสียงภาษาจีนในเครื่อง ระบบจะแสดง <b>พินอิน</b> ให้แทน (แนะนำ Chrome/Edge ที่ต่ออินเทอร์เน็ต)'));
  }
}

/* MCQ ทั่วไป
   q = { prompt(html), options:[html], answer:index, th:boolean (ตัวเลือกภาษาไทย), explain(html), review(html), speak, onCorrect }
   opt = { container, mode:'button'|'auto', onDone, timePerQ, onAnswer } */
function runMCQ(questions, opt = {}) {
  const box = opt.container || area();
  let i = 0;
  S.total = questions.length;
  const next = () => {
    if (S.ended) return;
    if (i >= questions.length) { opt.onDone ? opt.onDone() : finish(); return; }
    renderQ(questions[i]);
  };
  function renderQ(q) {
    box.innerHTML = '';
    setProgress(i, questions.length);
    const panel = el('div', 'panel');
    const pr = el('div', 'prompt'); pr.innerHTML = q.prompt;
    panel.appendChild(pr);
    if (q.speak) {
      const sp = speakerBtn(q.speak);
      pr.appendChild(sp);
      if (!hasZh() && q.speakFallback) pr.appendChild(el('div', 'pinyin', q.speakFallback));
      later(() => sp.play(), 350);
    }
    const ops = el('div', 'options');
    const btns = q.options.map((o, k) => {
      const b = el('button', 'opt' + (q.th ? ' th' : ''), o);
      b.onclick = () => answer(k, b);
      ops.appendChild(b); return b;
    });
    panel.appendChild(ops);
    const ex = el('div', 'explain'); panel.appendChild(ex);
    box.appendChild(panel);
    let answered = false;
    let tId = null;
    if (opt.timePerQ) {
      const bar = el('div', 'qtimer', '<div></div>'); panel.insertBefore(bar, pr);
      const inner = bar.firstChild; const t0 = Date.now();
      tId = every(() => {
        const left = 1 - (Date.now() - t0) / (opt.timePerQ * 1000);
        inner.style.width = Math.max(0, left * 100) + '%';
        if (left <= 0) { clearInterval(tId); if (!answered) answer(-1, panel); }
      }, 100);
    }
    function answer(k, b) {
      if (answered) return; answered = true;
      if (tId) clearInterval(tId);
      btns.forEach(x => x.disabled = true);
      const ok = k === q.answer;
      btns[q.answer].classList.add('correct');
      if (ok) { good(b); q.onCorrect && q.onCorrect(pr); }
      else { if (k >= 0) b.classList.add('wrong'); bad(b, q.review); }
      opt.onAnswer && opt.onAnswer(ok);
      if (S.ended) return;
      const exHtml = (ok ? '✅ ถูกต้อง! ' : (k < 0 ? '⏰ หมดเวลา! ' : '❌ ยังไม่ถูก ')) + (q.explain || '');
      ex.innerHTML = exHtml; ex.className = 'explain show ' + (ok ? 'ok' : 'bad');
      i++;
      if (opt.mode === 'button') {
        const row = el('div', 'next-row');
        const nb = el('button', 'btn btn-ok', i >= questions.length ? 'ดูผลคะแนน 🏁' : 'ข้อต่อไป ▶');
        nb.onclick = () => { sfx.click(); next(); };
        row.appendChild(nb); panel.appendChild(row); nb.focus();
      } else {
        later(next, ok ? (opt.okDelay || 1100) : (opt.badDelay || 2200));
      }
    }
  }
  next();
  return { push: q => { questions.push(q); S.total = questions.length; } };
}
function mkOptions(correct, distractors, n = 4) {
  const opts = shuffle([correct, ...sample(distractors.filter(d => d !== correct), n - 1)]);
  return { options: opts, answer: opts.indexOf(correct) };
}
function uniq(a) { return [...new Set(a)]; }

/* ---------------- ENGINES ---------------- */
const ENGINES = {};

/* ===== เปิดการ์ดจับคู่ ===== */
ENGINES.memory = lv => {
  const words = sample(vocabOf(lv.lesson), 6);
  const cards = shuffle(words.flatMap((w, i) => [{ id: i, zh: true, w }, { id: i, zh: false, w }]));
  const panel = el('div', 'panel');
  panel.appendChild(el('div', 'prompt', '<div class="hint">เปิดการ์ดทีละ 2 ใบ จับคู่ <b>ตัวจีน</b> กับ <b>ความหมาย</b> ให้ครบ 6 คู่ (ยิ่งเปิดผิดน้อย ยิ่งได้ดาวมาก)</div>'));
  const info = el('div', 'next-row', '');
  const grid = el('div', 'mem-grid');
  let open = [], lock = false, pairs = 0, misses = 0;
  const upd = () => { info.innerHTML = `คู่ที่จับได้ <b>${pairs}/6</b> · เปิดผิด <b>${misses}</b> ครั้ง`; setProgress(pairs, 6); };
  cards.forEach(c => {
    const d = el('div', 'card');
    d.innerHTML = `<div class="face front">学</div><div class="face back ${c.zh ? 'zh' : ''}">${c.zh ? c.w.zh : esc(c.w.th)}</div>`;
    d.onclick = () => {
      if (lock || d.classList.contains('flip') || d.classList.contains('done')) return;
      d.classList.add('flip'); sfx.flip();
      if (c.zh) speak(c.w.zh);
      open.push({ c, d });
      if (open.length === 2) {
        lock = true;
        const [a, b] = open;
        if (a.c.id === b.c.id) {
          later(() => { a.d.classList.add('done'); b.d.classList.add('done'); pairs++; good(b.d); upd(); open = []; lock = false;
            if (pairs === 6) later(() => finish({ total: 6, correct: 6, stars: misses <= 4 ? 3 : misses <= 8 ? 2 : 1, bonus: Math.max(0, 300 - misses * 30), correctText: `6 คู่ (ผิด ${misses})` }), 700);
          }, 400);
        } else {
          misses++;
          later(() => { a.d.classList.add('bad'); b.d.classList.add('bad'); S.combo = 0; updateHud(); sfx.bad(); }, 450);
          later(() => { [a, b].forEach(x => x.d.classList.remove('flip', 'bad')); open = []; lock = false; upd(); }, 1150);
        }
      }
    };
    grid.appendChild(d);
  });
  panel.appendChild(grid); panel.appendChild(info); area().appendChild(panel); upd();
};

/* ===== โยงคู่ตัวจีน–พินอิน ===== */
ENGINES.match = lv => {
  const pool = sample(ALL_VOCAB, 15);
  const rounds = [pool.slice(0, 5), pool.slice(5, 10), pool.slice(10, 15)];
  let r = 0, matched = 0, wrong = 0;
  const panel = el('div', 'panel'); area().appendChild(panel);
  function round() {
    panel.innerHTML = `<div class="prompt"><div class="hint">รอบที่ ${r + 1}/3 — กดตัวจีนทางซ้าย แล้วกดพินอินที่ตรงกันทางขวา</div></div>`;
    const cols = el('div', 'match-cols');
    const L = el('div', 'col'), R = el('div', 'col');
    let sel = null, done = 0;
    shuffle(rounds[r]).forEach(w => {
      const b = el('button', 'mitem zh', w.zh); b.w = w;
      b.onclick = () => { if (b.classList.contains('done')) return; speak(w.zh); L.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); sel = b; };
      L.appendChild(b);
    });
    shuffle(rounds[r]).forEach(w => {
      const b = el('button', 'mitem', w.py);
      b.onclick = () => {
        if (b.classList.contains('done')) return;
        if (!sel) { toast('เลือกตัวจีนทางซ้ายก่อนนะ'); return; }
        if (sel.w === w) {
          sel.classList.remove('sel'); sel.classList.add('done'); b.classList.add('done'); good(b); matched++; done++; sel = null;
          setProgress(matched, 15);
          if (done === 5) { r++; later(() => r < 3 ? round() : finish({ total: 15 + wrong, correct: 15, correctText: `15 คู่ (ผิด ${wrong})` }), 600); }
        } else {
          wrong++; b.classList.add('wrong'); sel.classList.add('wrong');
          const s2 = sel; later(() => { b.classList.remove('wrong'); s2.classList.remove('wrong'); }, 450);
          bad(b, `<span class="zh">${sel.w.zh}</span> = ${sel.w.py} (${esc(sel.w.th)})`);
        }
      };
      R.appendChild(b);
    });
    cols.appendChild(L); cols.appendChild(R); panel.appendChild(cols);
  }
  round();
};

/* ===== ความหมายสายฟ้าแลบ 60 วินาที ===== */
ENGINES.speed = lv => {
  const TIME = 60;
  const ex = $('#play-extra'); ex.hidden = false;
  const t0 = Date.now(); let answered = 0;
  const bag = shuffle(ALL_VOCAB); let bi = 0;
  const box = el('div'); area().appendChild(box);
  const mkQ = () => {
    const w = bag[bi++ % bag.length];
    const same = vocabOf(w.lesson).map(v => v.th);
    const m = mkOptions(w.th, same);
    return { prompt: `<div class="hint">ตัวนี้แปลว่าอะไร?</div><div class="big-zh">${w.zh}</div><div class="pinyin">${w.py}</div>`, th: true, ...m, review: `<span class="zh">${w.zh}</span> ${w.py} = ${esc(w.th)}` };
  };
  const qs = [mkQ(), mkQ()];
  const runner = runMCQ(qs, {
    container: box, okDelay: 350, badDelay: 1000,
    onAnswer: () => { answered++; runner.push(mkQ()); }
  });
  const tick = () => {
    const left = Math.max(0, TIME - Math.floor((Date.now() - t0) / 1000));
    ex.innerHTML = `⏱️ <b>${left}</b>`;
    setProgress(TIME - left, TIME);
    if (left <= 0) {
      const c = S.correct;
      finish({ total: answered, correct: c, stars: c >= 18 ? 3 : c >= 12 ? 2 : c >= 6 ? 1 : 0, correctText: `${c}/${answered}`, title: `⚡ ตอบถูก ${c} ข้อใน 60 วินาที` });
    }
  };
  tick(); every(tick, 250);
};

/* ===== ต่อคำ ===== */
ENGINES.build = lv => {
  const words = sample(vocabOf(lv.lesson).filter(v => [...v.zh].length >= 2), 8);
  const allChars = uniq(ALL_VOCAB.flatMap(v => [...v.zh]));
  let i = 0; S.total = words.length;
  const panel = el('div', 'panel'); area().appendChild(panel);
  function render() {
    if (i >= words.length) return finish();
    setProgress(i, words.length);
    const w = words[i]; const chars = [...w.zh];
    const nDis = Math.max(3, 7 - chars.length);
    const bankChars = shuffle([...chars, ...sample(allChars.filter(c => !chars.includes(c)), nDis)]);
    panel.innerHTML = `<div class="prompt"><div class="hint">ข้อ ${i + 1}/${words.length} — เลือกตัวอักษรมาต่อเป็นคำที่แปลว่า</div>
      <div class="thai" style="font-size:28px">“${esc(w.th)}”</div><div class="pinyin">${w.py}</div></div>`;
    const slots = el('div', 'slots'); const bank = el('div', 'bank');
    const filled = chars.map(() => null);
    const slotEls = chars.map((_, k) => {
      const s = el('div', 'slot'); s.onclick = () => { if (!filled[k] || locked) return; filled[k].classList.remove('used'); filled[k] = null; s.textContent = ''; s.classList.remove('filled'); sfx.click(); };
      slots.appendChild(s); return s;
    });
    let locked = false;
    bankChars.forEach(c => {
      const t = el('button', 'tile', c);
      t.onclick = () => {
        if (locked || t.classList.contains('used')) return;
        const k = filled.indexOf(null); if (k < 0) return;
        filled[k] = t; t.classList.add('used'); slotEls[k].textContent = c; slotEls[k].classList.add('filled'); sfx.click();
        if (!filled.includes(null)) check();
      };
      bank.appendChild(t);
    });
    function check() {
      locked = true;
      const ans = filled.map(t => t.textContent).join('');
      speak(w.zh);
      if (ans === w.zh) { slots.style.borderColor = 'var(--ok)'; slots.style.background = '#e3f7f2'; good(slots); i++; later(render, 1000); }
      else {
        slots.style.borderColor = 'var(--bad)'; slots.style.background = '#ffe9eb'; slots.style.animation = 'shake .4s';
        bad(slots, `“${esc(w.th)}” = <span class="zh">${w.zh}</span> (${w.py})`);
        later(() => { slotEls.forEach((s, k) => { s.textContent = chars[k]; s.style.color = 'var(--ok)'; }); }, 500);
        i++; later(render, 2200);
      }
    }
    panel.appendChild(slots); panel.appendChild(bank);
    const sk = el('div', 'next-row'); const sb = el('button', 'btn btn-ghost btn-sm', '🔊 ฟังเสียงคำนี้'); sb.onclick = () => speak(w.zh); sk.appendChild(sb); panel.appendChild(sk);
  }
  render();
};

/* ===== เรียงประโยค (ใช้ร่วมกัน 3 แบบ) ===== */
function orderGame(list, mode) {
  let i = 0; S.total = list.length;
  if (mode === 'listen') voiceNotice(area());
  const panel = el('div', 'panel'); area().appendChild(panel);
  const allTokens = uniq(ALL_SENT.flatMap(s => s.tokens));
  function render() {
    if (i >= list.length) return finish();
    setProgress(i, list.length);
    const s = list[i]; const text = s.tokens.join(''); const full = s.full;
    const extra = mode === 'translate' ? sample(allTokens.filter(t => !s.tokens.includes(t)), 2) : [];
    let head = '';
    if (mode === 'listen') head = `<div class="hint">ข้อ ${i + 1}/${list.length} — ฟังแล้วเรียงคำให้ตรงกับที่ได้ยิน</div>`;
    else if (mode === 'translate') head = `<div class="hint">ข้อ ${i + 1}/${list.length} — แปลเป็นภาษาจีน (ระวัง! มีคำหลอก 2 คำ)</div><div class="thai" style="font-size:26px">“${esc(s.th)}”</div>`;
    else head = `<div class="hint">ข้อ ${i + 1}/${list.length} — เรียงคำให้เป็นประโยคที่ถูกต้อง</div><div class="thai">“${esc(s.th)}”</div>`;
    panel.innerHTML = `<div class="prompt">${head}</div>`;
    if (mode === 'listen') {
      const sp = speakerBtn(full); panel.querySelector('.prompt').appendChild(sp); later(() => sp.play(), 300);
      if (!hasZh()) panel.querySelector('.prompt').appendChild(el('div', 'thai', `“${esc(s.th)}”`));
    }
    const line = el('div', 'answer-line'); const bank = el('div', 'bank');
    const placed = [];
    let locked = false;
    const tokens = shuffle([...s.tokens, ...extra]);
    tokens.forEach(tk => {
      const t = el('button', 'tile', esc(tk));
      t.onclick = () => {
        if (locked || t.classList.contains('used')) return;
        t.classList.add('used'); sfx.click();
        const c = el('button', 'tile', esc(tk));
        c.onclick = () => { if (locked) return; t.classList.remove('used'); c.remove(); placed.splice(placed.indexOf(item), 1); refresh(); sfx.click(); };
        const item = { tk, c }; placed.push(item); line.appendChild(c); refresh();
      };
      bank.appendChild(t);
    });
    const row = el('div', 'next-row');
    const chk = el('button', 'btn btn-ok', 'ตรวจคำตอบ ✔');
    const clr = el('button', 'btn btn-ghost', 'ล้าง');
    clr.style.marginLeft = '8px';
    const refresh = () => { chk.disabled = placed.length !== s.tokens.length; };
    clr.onclick = () => { if (locked) return; placed.splice(0).forEach(p => p.c.remove()); bank.querySelectorAll('.used').forEach(t => t.classList.remove('used')); refresh(); };
    chk.onclick = () => {
      locked = true; chk.disabled = true; clr.disabled = true;
      const ans = placed.map(p => p.tk).join('');
      const ex = el('div', 'explain show');
      if (ans === text) { line.classList.add('ok'); good(line); ex.className += ' ok'; ex.innerHTML = `✅ ถูกต้อง! <span class="zh">${full}</span> — ${esc(s.th)}`; }
      else { line.classList.add('bad'); bad(line, `<span class="zh">${full}</span> — ${esc(s.th)}`); ex.className += ' bad'; ex.innerHTML = `❌ ประโยคที่ถูกคือ <span class="zh" style="font-size:20px">${full}</span><br>${esc(s.th)}`; }
      panel.appendChild(ex);
      speak(full);
      i++;
      const nr = el('div', 'next-row'); const nb = el('button', 'btn btn-ok', i >= list.length ? 'ดูผลคะแนน 🏁' : 'ข้อต่อไป ▶');
      nb.onclick = render; nr.appendChild(nb); panel.appendChild(nr);
    };
    refresh();
    row.appendChild(chk); row.appendChild(clr);
    panel.appendChild(line); panel.appendChild(bank); panel.appendChild(row);
  }
  render();
}
ENGINES.order = lv => orderGame(sample(sentOf(lv.lesson), 6), 'normal');
ENGINES.listenOrder = lv => orderGame(sample(ALL_SENT, 6), 'listen');
ENGINES.translate = lv => orderGame(sample(ALL_SENT, 6), 'translate');

/* ===== ไวยากรณ์ ===== */
function grammarQ(g) {
  const correct = g.o[0];
  const opts = shuffle(g.o);
  const isFix = !g.q.includes('____');
  const prompt = isFix
    ? `<div class="hint">🔍 ${esc(g.q)}</div>`
    : `<div class="hint">เลือกคำที่เหมาะสมเติมในช่องว่าง</div><div class="q-zh">${esc(g.q).replace('____', '<span class="blank">　?　</span>')}</div>`;
  return {
    prompt, options: opts.map(esc), answer: opts.indexOf(correct), explain: '💡 ' + esc(g.e),
    review: isFix ? `<span class="zh">${esc(correct)}</span> — ${esc(g.e)}` : `<span class="zh">${esc(g.q.replace('____', '【' + correct + '】'))}</span> — ${esc(g.e)}`,
    onCorrect: pr => { const b = pr.querySelector('.blank'); if (b) b.textContent = correct; },
    fixStyle: isFix
  };
}
ENGINES.grammar = lv => {
  const set = GRAMMAR[lv.set];
  const qs = sample(set, Math.min(10, set.length)).map(grammarQ);
  if (lv.set === 'fix') qs.forEach(q => q.th = false);
  runMCQ(qs, { mode: 'button' });
};

/* ===== ฟัง ===== */
ENGINES.listenMeaning = lv => {
  voiceNotice(area());
  const box = el('div'); area().appendChild(box);
  const qs = sample(ALL_VOCAB, 10).map(w => ({
    prompt: '<div class="hint">ฟังแล้วเลือกความหมายที่ถูกต้อง</div>', speak: w.zh, speakFallback: w.py,
    th: true, ...mkOptions(w.th, vocabOf(w.lesson).map(v => v.th)),
    explain: `<span class="zh" style="font-size:22px">${w.zh}</span> ${w.py} = ${esc(w.th)}`,
    review: `<span class="zh">${w.zh}</span> ${w.py} = ${esc(w.th)}`
  }));
  runMCQ(qs, { container: box, okDelay: 1500, badDelay: 2500 });
};
ENGINES.listenHanzi = lv => {
  voiceNotice(area());
  const box = el('div'); area().appendChild(box);
  const qs = sample(ALL_VOCAB, 10).map(w => {
    const len = [...w.zh].length;
    const sim = ALL_VOCAB.filter(v => [...v.zh].length === len).map(v => v.zh);
    return {
      prompt: '<div class="hint">ฟังแล้วเลือกตัวอักษรจีนที่ได้ยิน</div>', speak: w.zh, speakFallback: w.py,
      ...mkOptions(w.zh, sim.length >= 4 ? sim : ALL_VOCAB.map(v => v.zh)),
      explain: `<span class="zh" style="font-size:22px">${w.zh}</span> ${w.py} = ${esc(w.th)}`,
      review: `<span class="zh">${w.zh}</span> ${w.py} = ${esc(w.th)}`
    };
  });
  runMCQ(qs, { container: box, okDelay: 1500, badDelay: 2500 });
};

/* ===== อ่าน ===== */
ENGINES.reading = lv => {
  const R = READINGS[lv.idx];
  const pp = el('div', 'panel');
  const head = el('div', 'passage-head', `<b>📖 ${esc(R.title)}</b>`);
  const sp = el('button', 'btn btn-sm', '🔊 ฟังเรื่อง'); let playing = false;
  sp.onclick = async () => { if (playing) { speechSynthesis.cancel(); playing = false; sp.textContent = '🔊 ฟังเรื่อง'; return; } playing = true; sp.textContent = '⏹ หยุด'; await speak(R.text, DB.settings.rate * .95); playing = false; sp.textContent = '🔊 ฟังเรื่อง'; };
  head.appendChild(sp); pp.appendChild(head);
  pp.appendChild(el('div', 'passage zh', esc(R.text)));
  area().appendChild(pp);
  const box = el('div'); area().appendChild(box);
  const qs = R.qs.map(q => {
    const opts = shuffle(q.o);
    const isTh = /[\u0E00-\u0E7F]/.test(q.o[0]);
    return {
      prompt: `<div class="q-zh" style="font-size:24px">${esc(q.q)}</div>`, options: opts.map(esc), answer: opts.indexOf(q.o[0]), th: isTh,
      explain: `คำตอบ: <span class="zh">${esc(q.o[0])}</span>`, review: `${esc(q.q)} → <span class="zh">${esc(q.o[0])}</span>`
    };
  });
  runMCQ(qs, { container: box, okDelay: 1000, badDelay: 2200 });
};

/* ===== พิมพ์พินอิน ===== */
const normPy = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/v/g, 'u').replace(/[^a-z]/g, '');
ENGINES.pinyin = lv => {
  const words = sample(ALL_VOCAB.filter(v => [...v.zh].length <= 3), 10);
  let i = 0; S.total = words.length;
  const panel = el('div', 'panel'); area().appendChild(panel);
  function render() {
    if (i >= words.length) return finish();
    setProgress(i, words.length);
    const w = words[i];
    panel.innerHTML = `<div class="prompt"><div class="hint">ข้อ ${i + 1}/${words.length} — พิมพ์พินอินของคำนี้ (ไม่ต้องใส่วรรณยุกต์ / ü พิมพ์ v หรือ u ได้)</div>
      <div class="big-zh" style="font-size:60px">${w.zh}</div><div class="thai">${esc(w.th)}</div></div>`;
    const inp = el('input', 'inp pinyin-inp'); inp.placeholder = 'เช่น  xiaoxin'; inp.autocomplete = 'off'; inp.spellcheck = false;
    const row = el('div', 'next-row');
    const ok = el('button', 'btn btn-ok', 'ตอบ ✔'); const skip = el('button', 'btn btn-ghost', 'ไม่รู้ 🤔'); skip.style.marginLeft = '8px';
    const hint = el('button', 'btn btn-ghost', '🔊 ใบ้เสียง (-30)'); hint.style.marginLeft = '8px';
    let hinted = false, done = false;
    hint.onclick = () => { speak(w.zh); if (!hinted) { hinted = true; hint.textContent = '🔊 ฟังอีกครั้ง'; } };
    const ex = el('div', 'explain');
    const submit = (give) => {
      if (done) return;
      if (!give && !inp.value.trim()) { inp.focus(); return; }
      done = true; inp.disabled = true; ok.disabled = skip.disabled = true;
      const right = !give && normPy(inp.value) === normPy(w.py);
      speak(w.zh);
      if (right) { good(inp, hinted ? 70 : 100); ex.className = 'explain show ok'; ex.innerHTML = `✅ ถูกต้อง! <b>${w.py}</b>`; }
      else { bad(inp, `<span class="zh">${w.zh}</span> = ${w.py} (${esc(w.th)})`); ex.className = 'explain show bad'; ex.innerHTML = `❌ คำตอบคือ <b style="font-size:22px">${w.py}</b>`; }
      i++; later(render, right ? 1200 : 2400);
    };
    ok.onclick = () => submit(false); skip.onclick = () => submit(true);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(false); });
    row.append(ok, skip, hint);
    panel.append(inp, row, ex);
    setTimeout(() => inp.focus(), 50);
  }
  render();
};

/* ===== ฝึกเขียนตัวจีน (Hanzi Writer) ===== */
const CHAR_EXTRA = { '汗': ['hàn', 'เหงื่อ'] };
function charInfo(c) {
  const v = ALL_VOCAB.find(x => x.zh === c);
  if (v) return [v.py, v.th];
  if (CHAR_EXTRA[c]) return CHAR_EXTRA[c];
  const w = ALL_VOCAB.find(x => x.zh.includes(c));
  return w ? ['', `(อยู่ในคำ ${w.zh} ${w.py})`] : ['', ''];
}
ENGINES.strokes = lv => {
  const chars = STROKE_CHARS[lv.set];
  const panel = el('div', 'panel'); area().appendChild(panel);
  if (typeof HanziWriter === 'undefined') {
    panel.innerHTML = `<div class="prompt"><div class="thai">⚠️ โหลดระบบฝึกเขียนไม่ได้</div><div class="hint">ด่านนี้ต้องเชื่อมต่ออินเทอร์เน็ต ลองตรวจสอบการเชื่อมต่อแล้วเปิดเกมใหม่อีกครั้ง</div></div>`;
    const b = el('button', 'btn', 'กลับแผนที่'); b.onclick = () => { stopSession(); renderMap(); }; panel.appendChild(el('div', 'next-row')).appendChild(b);
    return;
  }
  let i = 0, totalMist = 0; S.total = chars.length;
  let writer = null;
  function render() {
    if (i >= chars.length) return finish({ stars: totalMist <= 6 ? 3 : totalMist <= 14 ? 2 : totalMist <= 24 ? 1 : 0, correctText: `${S.correct}/${chars.length} (พลาด ${totalMist} ขีด)` });
    setProgress(i, chars.length);
    const c = chars[i]; const [py, th] = charInfo(c);
    panel.innerHTML = `<div class="prompt"><div class="hint">ตัวที่ ${i + 1}/${chars.length} — เขียนตามเส้นจาง ๆ ให้ถูกลำดับขีด (ผิดเกิน 3 ครั้งจะมีใบ้)</div>
      <div class="pinyin" style="font-size:26px"><b>${py}</b> · ${esc(th)}</div></div>`;
    const box = el('div', 'stroke-box');
    box.innerHTML = `<svg class="grid" width="280" height="280"><line x1="0" y1="0" x2="280" y2="280" stroke="#f3d9b5" stroke-dasharray="6"/><line x1="280" y1="0" x2="0" y2="280" stroke="#f3d9b5" stroke-dasharray="6"/><line x1="140" y1="0" x2="140" y2="280" stroke="#f3d9b5" stroke-dasharray="6"/><line x1="0" y1="140" x2="280" y2="140" stroke="#f3d9b5" stroke-dasharray="6"/></svg>`;
    const target = el('div'); box.appendChild(target);
    panel.appendChild(box);
    const info = el('div', 'next-row', 'พลาด: <b>0</b> ขีด'); panel.appendChild(info);
    const row = el('div', 'next-row');
    const demo = el('button', 'btn btn-ghost btn-sm', '👀 ดูวิธีเขียน');
    const skip = el('button', 'btn btn-ghost btn-sm', 'ข้าม ⏭'); skip.style.marginLeft = '8px';
    row.append(demo, skip); panel.appendChild(row);
    let mist = 0, finished = false;
    writer = HanziWriter.create(target, c, {
      width: 280, height: 280, padding: 14, showCharacter: false, showOutline: true,
      strokeColor: '#c1121f', outlineColor: '#e9d6bd', drawingColor: '#2b1b17', drawingWidth: 26,
      showHintAfterMisses: 3, highlightOnComplete: true, highlightColor: '#2a9d8f',
      onLoadCharDataError: () => { info.innerHTML = '⚠️ โหลดข้อมูลตัวอักษรไม่ได้ (ตรวจสอบอินเทอร์เน็ต)'; }
    });
    const startQuiz = () => writer.quiz({
      onMistake: () => { mist++; info.innerHTML = `พลาด: <b>${mist}</b> ขีด`; sfx.flip(); },
      onCorrectStroke: () => sfx.click(),
      onComplete: () => {
        if (finished) return; finished = true;
        totalMist += mist; speak(c);
        if (mist <= 3) good(box); else bad(box, `ฝึกเขียน <span class="zh">${c}</span> อีกครั้งนะ (พลาด ${mist} ขีด)`);
        i++; later(render, 1500);
      }
    });
    startQuiz();
    demo.onclick = () => { mist += 2; info.innerHTML = `พลาด: <b>${mist}</b> ขีด (ดูเฉลย +2)`; writer.cancelQuiz(); writer.animateCharacter({ onComplete: () => { if (!S.ended) { writer.hideCharacter(); startQuiz(); } } }); };
    skip.onclick = () => { if (finished) return; finished = true; writer.cancelQuiz(); totalMist += 8; bad(box, `ข้ามตัว <span class="zh">${c}</span>`); i++; render(); };
  }
  S.cleanups.push(() => { try { writer && writer.cancelQuiz(); } catch (e) { } });
  render();
};

/* ===== บอส ===== */
ENGINES.boss = lv => {
  const HITS = 10; let hp = HITS, hearts = 3;
  const stage = el('div', 'panel');
  stage.innerHTML = `<div class="boss-stage"><div class="hearts" id="b-hearts"></div><div class="hp-wrap"><div style="text-align:center;font-weight:600">🐉 มังกรผู้พิทักษ์ภาษา <span id="b-hp"></span></div><div class="hp-bar"><div id="b-bar"></div></div></div><div class="boss-dragon" id="b-dragon">🐉</div></div>`;
  area().appendChild(stage);
  const box = el('div'); area().appendChild(box);
  const upd = () => {
    stage.querySelector('#b-hearts').textContent = '❤️'.repeat(hearts) + '🖤'.repeat(3 - hearts);
    stage.querySelector('#b-bar').style.width = (hp / HITS * 100) + '%';
    stage.querySelector('#b-hp').textContent = `HP ${hp * 10}/${HITS * 10}`;
    setProgress(HITS - hp, HITS);
  };
  upd();
  const gen = () => {
    const t = Math.random();
    if (t < .35) {
      const w = ALL_VOCAB[Math.floor(Math.random() * ALL_VOCAB.length)];
      return { prompt: `<div class="hint">แปลว่าอะไร?</div><div class="big-zh">${w.zh}</div>`, th: true, ...mkOptions(w.th, vocabOf(w.lesson).map(v => v.th)), review: `<span class="zh">${w.zh}</span> ${w.py} = ${esc(w.th)}` };
    } else if (t < .5) {
      const w = ALL_VOCAB[Math.floor(Math.random() * ALL_VOCAB.length)];
      return { prompt: `<div class="hint">“${esc(w.th)}” ภาษาจีนคือ?</div>`, ...mkOptions(w.zh, vocabOf(w.lesson).map(v => v.zh)), review: `${esc(w.th)} = <span class="zh">${w.zh}</span> ${w.py}` };
    } else if (t < .6 && hasZh()) {
      const w = ALL_VOCAB[Math.floor(Math.random() * ALL_VOCAB.length)];
      return { prompt: '<div class="hint">🎧 ฟังแล้วเลือกตัวจีน</div>', speak: w.zh, ...mkOptions(w.zh, ALL_VOCAB.map(v => v.zh)), review: `<span class="zh">${w.zh}</span> ${w.py}` };
    } else if (t < .68) {
      const id = IDIOMS[Math.floor(Math.random() * IDIOMS.length)];
      return { prompt: `<div class="hint">สำนวนนี้หมายความว่า?</div><div class="big-zh">${id[0]}</div>`, th: true, ...mkOptions(id[2], IDIOMS.map(x => x[2])), review: `<span class="zh">${id[0]}</span> = ${esc(id[2])}` };
    } else {
      const sets = ['g19', 'g20', 'g21', 'fix'];
      const set = GRAMMAR[sets[Math.floor(Math.random() * sets.length)]];
      return grammarQ(set[Math.floor(Math.random() * set.length)]);
    }
  };
  const qs = [gen(), gen()];
  const dragon = stage.querySelector('#b-dragon');
  const runner = runMCQ(qs, {
    container: box, timePerQ: 15, okDelay: 900, badDelay: 2000,
    onAnswer: ok => {
      dragon.classList.remove('hit', 'attack'); void dragon.offsetWidth;
      if (ok) { hp--; dragon.classList.add('hit'); sfx.hit(); }
      else { hearts--; dragon.classList.add('attack'); document.body.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 300 }); }
      upd();
      if (hp <= 0) later(() => finish({ stars: hearts, bonus: 500 + hearts * 150, title: '🎉 ปราบมังกรสำเร็จ! 你真棒！', total: S.correct + (3 - hearts), correct: S.correct }), 900);
      else if (hearts <= 0) later(() => finish({ stars: 0, title: '💀 มังกรชนะ… ทบทวนแล้วมาใหม่นะ!', total: S.correct + 3, correct: S.correct }), 900);
      else runner.push(gen());
    }
  });
};

/* ---------------- ตารางคะแนน ---------------- */
function drawBoardTable() {
  const rows = Object.keys(DB.players).map(n => ({ n, ...totals(n) })).sort((a, b) => b.score - a.score || b.stars - a.stars);
  const tb = $('#board-body'); tb.innerHTML = '';
  const hasCloud = !!getCloudUrl();
  $('#board-title').textContent = hasCloud ? '🏆 ตารางคะแนนรวม (ออนไลน์ + เครื่องนี้)' : '🏆 ตารางคะแนนสะสม';
  const sub = $('#board-sub');
  if (sub) {
    sub.innerHTML = hasCloud
      ? `☁️ เชื่อมต่อ Google Sheet แล้ว · ผู้เล่นทั้งหมด <b>${rows.length}</b> คน (ใช้ชื่อเดิมเล่นซ้ำ คะแนนและดาวจะอัปเดตที่ชื่อเดิมอัตโนมัติ)`
      : `💾 โหมดบันทึกในเครื่อง · ผู้เล่น <b>${rows.length}</b> คน (ครูสามารถกด "☁️ ตั้งค่า Google Sheet" เพื่อรวมคะแนนจากทุกเครื่องได้)`;
  }
  if (!rows.length) tb.innerHTML = '<tr><td colspan="5" style="text-align:center">ยังไม่มีผู้เล่น</td></tr>';
  rows.forEach((r, i) => {
    const tr = el('tr', r.n === player ? 'me' : '', `<td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td>${esc(r.n)}</td><td>${r.stars}/${MAX_STARS}</td><td>${r.score.toLocaleString()}</td><td>${r.passed}/${LEVELS.length}</td>`);
    tb.appendChild(tr);
  });
  $('#btn-copy').hidden = !player;
}

async function renderBoard() {
  drawBoardTable();
  show('screen-board');
  if (getCloudUrl()) {
    const r = await pullCloudAll(true);
    if (r.ok && $('#screen-board').classList.contains('active')) drawBoardTable();
  }
}
$('#btn-board').onclick = renderBoard;
$('#btn-board-start').onclick = renderBoard;
$('#btn-board-back').onclick = () => player ? renderMap() : renderStart();
$('#btn-sync-now').onclick = async () => {
  if (!getCloudUrl()) {
    toast('ยังไม่ได้ตั้งค่าลิงก์ Google Sheet (กดปุ่ม ☁️ ตั้งค่า Google Sheet ได้เลย)');
    return;
  }
  toast('🔄 กำลังดึงและอัปเดตข้อมูลคะแนน...');
  if (player) await pushCloudPlayer(player);
  await pullCloudAll(false);
  drawBoardTable();
};

function reportText(name) {
  const t = totals(name); const lv = DB.players[name].levels;
  let s = `【汉语大冒险 ผลคะแนน】\nชื่อ: ${name}\nวันที่: ${new Date().toLocaleString('th-TH')}\nคะแนนรวม: ${t.score} | ดาว: ${t.stars}/${MAX_STARS} | ผ่าน ${t.passed}/${LEVELS.length} ด่าน\nระดับ: ${rankOf(t.stars)}\n`;
  WORLDS.forEach(w => {
    s += `\n${w.icon} ${w.name}\n`;
    LEVELS.filter(l => l.world === w.id).forEach(l => { const r = lv[l.id] || {}; s += `  - ${l.title}: ${starStr(r.stars || 0)} (${r.best || 0})\n`; });
  });
  return s;
}
$('#btn-copy').onclick = async () => {
  const txt = reportText(player);
  try { await navigator.clipboard.writeText(txt); toast('คัดลอกแล้ว! นำไปวางส่งครูได้เลย 📋'); }
  catch (e) { prompt('คัดลอกข้อความนี้ส่งครู', txt); }
};
$('#btn-csv').onclick = async () => {
  if (getCloudUrl()) await pullCloudAll(true);
  const head = ['ชื่อ', 'คะแนนรวม', 'ดาวรวม (เต็ม 81)', 'ด่านที่ผ่าน (เต็ม 27)', 'ระดับยศ', 'จำนวนครั้งที่เล่น', ...LEVELS.map(l => l.id + ' ' + l.title)];
  const lines = [head];
  Object.keys(DB.players)
    .sort((a, b) => totals(b).score - totals(a).score || totals(b).stars - totals(a).stars)
    .forEach(n => {
      const t = totals(n); const lv = DB.players[n].levels;
      lines.push([n, t.score, t.stars, t.passed, rankOf(t.stars), t.plays, ...LEVELS.map(l => lv[l.id] ? `${lv[l.id].best} (${lv[l.id].stars}★)` : '')]);
    });
  const csv = '\uFEFF' + lines.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = el('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `คะแนนเกมภาษาจีน_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
};

/* ---------------- ตั้งค่า Google Sheet สำหรับครู ---------------- */
function openCloudModal() {
  const pin = prompt('ใส่รหัสครูเพื่อตั้งค่าการเชื่อมต่อ Google Sheet');
  if (pin !== TEACHER_PIN) { if (pin !== null) toast('รหัสไม่ถูกต้อง'); return; }
  const m = $('#modal'), c = $('#modal-card');
  c.innerHTML = `<h3>☁️ เชื่อมต่อ Google Sheet (สำหรับครู)</h3>
    <div class="cloud-steps">
      <b>วิธีทำ (ทำครั้งเดียว คะแนนทุกคนจะส่งเข้าชีตครูอัตโนมัติ):</b>
      <ol>
        <li>เปิด <b>Google Sheets</b> สร้างชีตว่างใหม่ 1 ไฟล์</li>
        <li>ไปที่เมนู <b>ส่วนขยาย (Extensions) &gt; Apps Script</b></li>
        <li>ลบโค้ดเดิมทิ้ง แล้ววางโค้ดจากไฟล์ <code>google_sheet_script.gs</code> ในโฟลเดอร์เกม (หรือกดปุ่มคัดลอกโค้ดด้านล่าง) แล้วกด 💾 บันทึก</li>
        <li>กด <b>ทำให้ใช้งานได้ (Deploy) &gt; การทำให้ใช้งานได้รายการใหม่ (New deployment)</b></li>
        <li>เลือกประเภทเป็น <b>เว็บแอป (Web app)</b> และตั้งค่าผู้มีสิทธิ์เข้าถึงเป็น <b>"ทุกคน (Anyone)"</b> แล้วกด Deploy</li>
        <li>คัดลอก <b>URL ของเว็บแอป</b> (ที่ลงท้ายด้วย <code>/exec</code>) มาวางในช่องด้านล่างนี้ (หรือใส่ในไฟล์ <code>js/data.js</code> บรรทัดสุดท้าย <code>DEFAULT_CLOUD_URL</code> เพื่อให้ทุกเครื่องเชื่อมอัตโนมัติ)</li>
      </ol>
    </div>
    <input id="inp-cloud-url" class="inp" style="font-size:14px" placeholder="วาง Web App URL (https://script.google.com/macros/s/.../exec)" value="${esc(getCloudUrl())}">
    <div class="res-btns" style="margin-top:8px">
      <button class="btn btn-sm btn-gold" id="btn-test-cloud">🧪 บันทึก & ทดสอบซิงก์ทันที</button>
      <button class="btn btn-sm" id="btn-share-link">🔗 คัดลอกลิงก์เกมพร้อมเชื่อม Sheet</button>
      <button class="btn btn-sm btn-ghost" id="btn-close-cloud">ปิด</button>
    </div>`;
  m.hidden = false;

  $('#btn-test-cloud').onclick = async () => {
    const val = $('#inp-cloud-url').value.trim();
    DB.settings.cloudUrl = val;
    save();
    if (!val) { toast('ล้างลิงก์ Google Sheet แล้ว (ใช้โหมดบันทึกในเครื่อง)'); return; }
    toast('⏳ กำลังทดสอบเชื่อมต่อและซิงก์คะแนนทั้งหมด...');
    for (const n of Object.keys(DB.players)) {
      await pushCloudPlayer(n);
    }
    const r = await pullCloudAll(true);
    if (r.ok) {
      toast(`✅ เชื่อมต่อสำเร็จ! ซิงก์ข้อมูลผู้เล่นทั้งหมด ${Object.keys(DB.players).length} คนเรียบร้อย`);
      if ($('#screen-board').classList.contains('active')) drawBoardTable();
      if ($('#screen-start').classList.contains('active')) { renderPlayerButtons(); updateNameStatus(); }
    } else {
      toast('⚠️ เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบว่าตั้งค่า Who has access เป็น Anyone และลิงก์ลงท้ายด้วย /exec');
    }
  };

  $('#btn-share-link').onclick = async () => {
    const val = $('#inp-cloud-url').value.trim();
    if (!val) { toast('กรุณาวาง Web App URL ก่อนครับ'); return; }
    DB.settings.cloudUrl = val; save();
    const base = location.href.split('?')[0];
    const shareUrl = `${base}?sheet=${encodeURIComponent(val)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('คัดลอกลิงก์แล้ว! ถ้านำเกมขึ้นเว็บ ส่งลิงก์นี้ให้นักเรียนเข้าเล่นได้เลย 🔗');
    } catch (e) {
      prompt('คัดลอกลิงก์นี้ส่งให้นักเรียน:', shareUrl);
    }
  };

  $('#btn-close-cloud').onclick = () => { m.hidden = true; };
}
if ($('#btn-cloud-start')) $('#btn-cloud-start').onclick = openCloudModal;
if ($('#btn-cloud-board')) $('#btn-cloud-board').onclick = openCloudModal;

/* ---------------- ตั้งค่า ---------------- */
$('#btn-settings').onclick = () => {
  const m = $('#modal'), c = $('#modal-card');
  c.innerHTML = `<h3>⚙️ ตั้งค่า</h3>
    <label>🔈 เสียงเอฟเฟกต์ <input type="checkbox" id="st-sound" ${DB.settings.sound ? 'checked' : ''}></label>
    <label>🗣️ ความเร็วเสียงอ่าน <input type="range" id="st-rate" min="0.5" max="1.2" step="0.05" value="${DB.settings.rate}"></label>
    <label>🎙️ เสียงภาษาจีน <span>${zhVoice ? esc(zhVoice.name) : '❌ ไม่พบ'}</span> <button class="btn btn-sm" id="st-test">ทดสอบ</button></label>
    <label>👩‍🏫 ปลดล็อกทุกด่าน (โหมดครู) <input type="checkbox" id="st-unlock" ${DB.settings.unlockAll ? 'checked' : ''}></label>
    <label>☁️ Google Sheet (ครู) <span>${getCloudUrl() ? '✅ เชื่อมแล้ว' : 'ยังไม่เชื่อม'}</span> <button class="btn btn-sm btn-gold" id="st-cloud">ตั้งค่า</button></label>
    <div class="res-btns"><button class="btn btn-ghost" id="st-reset">🗑️ ล้างคะแนนของฉัน</button><button class="btn btn-ok" id="st-close">ตกลง</button></div>`;
  m.hidden = false;
  $('#st-sound').onchange = e => { DB.settings.sound = e.target.checked; save(); };
  $('#st-rate').oninput = e => { DB.settings.rate = +e.target.value; save(); };
  $('#st-test').onclick = () => speak('你好！欢迎来到汉语大冒险。加油！');
  $('#st-unlock').onchange = e => {
    if (e.target.checked) {
      const pin = prompt('ใส่รหัสครูเพื่อปลดล็อก');
      if (pin !== TEACHER_PIN) { e.target.checked = false; toast('รหัสไม่ถูกต้อง'); return; }
    }
    DB.settings.unlockAll = e.target.checked; save();
  };
  $('#st-cloud').onclick = () => openCloudModal();
  $('#st-reset').onclick = async () => {
    if (confirm(`ล้างคะแนนทั้งหมดของ "${player}" ?`)) {
      DB.players[player].levels = {}; save();
      if (getCloudUrl()) await pushCloudPlayer(player, null, true);
      m.hidden = true; renderMap();
    }
  };
  $('#st-close').onclick = () => { m.hidden = true; renderMap(); };
};
$('#modal').onclick = e => { if (e.target.id === 'modal') { $('#modal').hidden = true; if (player) renderMap(); } };

/* ---------------- พลุ ---------------- */
function confetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#e63946', '#ffb703', '#2a9d8f', '#8338ec', '#fb8500', '#fcd34d'];
  const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .5, vx: (Math.random() - .5) * 4, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6 }));
  let f = 0;
  (function loop() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.a += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
    if (++f < 200) requestAnimationFrame(loop); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

/* ---------------- เริ่ม ---------------- */
renderStart();
})();
