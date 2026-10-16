import * as gh from './gh.js';
import { schedule, previewIntervals, addDays, daysBetween } from './fsrs.js';
import * as sp from './speech.js';

// ---------- yardımcılar ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => window.DOMPurify.sanitize(window.marked.parse(s || ''), { ADD_ATTR: ['target'] });
const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const wc = (s) => (s.trim().match(/\S+/g) || []).length;

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast('Hata: ' + e.message, 4500); return undefined; }
}

const DECK_LABEL = { ai: 'AI kavram', code: 'Kod', 'en-vocab': 'Kelime', 'en-phrase': 'İş İngilizcesi', 'en-pron': 'Telaffuz', 'en-grammar': 'Dilbilgisi' };
const DECK_ORDER = ['ai', 'en-pron', 'code', 'en-vocab', 'en-phrase', 'en-grammar'];

// ---------- durum ----------
const S = {
  profile: {}, cards: [], cardMap: new Map(), srs: null, mastery: {}, english: {},
  cur: { ai: null, en: null }, dates: [], dayDate: null, plan: null, activity: null, me: null,
};
const subPath = (f, date = S.dayDate) => `days/${date}/submission/${f}`;

// ---------- giriş kapısı ----------
function renderGate(mode) {
  const app = $('#app');
  if (mode === 'pin') {
    app.innerHTML = `
      <div class="gate"><form class="card stack" id="f">
        <h1>Usta</h1>
        <p class="muted">Özel çalışma alanı. Bu cihazın PIN'ini gir.</p>
        <input type="password" id="pin" inputmode="numeric" autocomplete="current-password" placeholder="PIN" autofocus />
        <div class="err" id="err"></div>
        <button class="btn primary" type="submit">Aç</button>
        <button class="btn ghost small" type="button" id="reset">Bu cihazı sıfırla</button>
      </form></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault(); $('#err').textContent = '';
      try { const tok = await gh.openVault($('#pin').value); gh.setToken(tok); await boot(); }
      catch (err) { $('#err').textContent = err.message; if (!gh.hasVault()) renderGate('setup'); }
    };
    $('#reset').onclick = () => { if (confirm('Bu cihazdaki şifreli anahtar silinsin mi? Token ile yeniden kurman gerekecek.')) { gh.forgetDevice(); renderGate('setup'); } };
    return;
  }
  app.innerHTML = `
    <div class="gate"><form class="card stack" id="f">
      <h1>Usta</h1>
      <p class="muted">Bu alan yalnız <b>cgrtml</b> hesabı içindir. İçerik bu sitede değil, özel bir GitHub deposunda durur; erişim o depoya yetkili token ile açılır.</p>
      <details class="faint"><summary>Token nasıl alınır?</summary>
        <ol>
          <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token oluştur</a></li>
          <li>Repository access: <b>Only select repositories</b> → <b>cgrtml/usta</b></li>
          <li>Permissions → Repository → <b>Contents: Read and write</b></li>
          <li>Süre: 1 yıl. Token'ı kopyala, aşağıya yapıştır.</li>
        </ol>
      </details>
      <div><label for="tok">GitHub token</label><input type="password" id="tok" autocomplete="off" placeholder="github_pat_…" /></div>
      <div class="grid2">
        <div><label for="pin">Cihaz PIN'i (en az 6)</label><input type="password" id="pin" inputmode="numeric" autocomplete="new-password" /></div>
        <div><label for="pin2">PIN tekrar</label><input type="password" id="pin2" inputmode="numeric" autocomplete="new-password" /></div>
      </div>
      <p class="faint">Token bu tarayıcıda PIN'den türetilen anahtarla (PBKDF2 + AES-GCM) şifreli saklanır, hiçbir sunucuya gönderilmez; yalnız GitHub API'sine gider.</p>
      <div class="err" id="err"></div>
      <button class="btn primary" type="submit" id="go">Doğrula ve kur</button>
    </form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const err = $('#err'); err.textContent = '';
    const tok = $('#tok').value.trim(), pin = $('#pin').value, pin2 = $('#pin2').value;
    if (!tok) return (err.textContent = 'Token gerekli.');
    if (pin.length < 6) return (err.textContent = 'PIN en az 6 karakter olmalı.');
    if (pin !== pin2) return (err.textContent = 'PIN\'ler aynı değil.');
    $('#go').disabled = true; $('#go').textContent = 'Doğrulanıyor…';
    try { await gh.verify(tok); await gh.saveVault(tok, pin); gh.setToken(tok); await boot(); }
    catch (ex) { err.textContent = ex.message; $('#go').disabled = false; $('#go').textContent = 'Doğrula ve kur'; }
  };
}

// ---------- yükleme ----------
async function load() {
  const [profile, cards, srs, mastery, english, ai, en, days] = await Promise.all([
    gh.readJSON('state/profile.json', {}), gh.readJSON('state/cards.json', { cards: [] }),
    gh.readJSON('state/srs.json', null), gh.readJSON('state/mastery.json', {}), gh.readJSON('state/english.json', {}),
    gh.readJSON('curriculum/ai.json', null), gh.readJSON('curriculum/english.json', null), gh.listDir('days'),
  ]);
  Object.assign(S, { profile, mastery, english });
  S.cards = (cards.cards || []).filter((c) => !c.retired);
  S.cardMap = new Map(S.cards.map((c) => [c.id, c]));
  S.srs = srs || { version: 1, params: { retention: 0.92, new_per_day: 8, max_interval: 180 }, cards: {}, log: [] };
  S.srs.params = { retention: 0.92, new_per_day: 8, max_interval: 180, ...(S.srs.params || {}) };
  S.cur = { ai, en };
  S.dates = days.filter((d) => d.type === 'dir' && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map((d) => d.name).sort();
  const t = todayLA();
  S.dayDate = [...S.dates].reverse().find((d) => d <= t) || S.dates[S.dates.length - 1] || null;
  if (S.dayDate) {
    const [plan, act] = await Promise.all([gh.readJSON(`days/${S.dayDate}/plan.json`, null), gh.readJSON(subPath('activity.json'), null)]);
    S.plan = plan;
    S.activity = act || { date: S.dayDate, blocks: {} };
    S.activity.blocks = S.activity.blocks || {};
  }
}

async function saveActivity(patch = {}) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'blocks') for (const [b, bv] of Object.entries(v)) S.activity.blocks[b] = { ...(S.activity.blocks[b] || {}), ...bv };
    else S.activity[k] = v;
  }
  S.activity.started = S.activity.started || new Date().toISOString();
  S.activity.updated = new Date().toISOString();
  await gh.writeJSON(subPath('activity.json'), S.activity, `site: ${S.dayDate} activity`);
}

// ---------- kabuk ----------
const NAV = [
  ['bugun', '☀️', 'Bugün'], ['tekrar', '🔁', 'Tekrar'], ['ogren', '🎓', 'Öğren'], ['gorev', '🛠️', 'Görev'], ['ders', '📘', 'Kapanış'],
  ['ingilizce', '🗣️', 'İngilizce'], ['gelisim', '📈', 'Gelişim'], ['mufredat', '🧭', 'Müfredat'],
  ['resume', '📄', 'Resume'], ['gecmis', '🗂️', 'Geçmiş'], ['ayarlar', '⚙️', 'Ayarlar'],
];

function renderShell() {
  $('#app').innerHTML = `
    <div class="topbar"><button class="iconbtn" id="menu" aria-label="Menü">☰</button><div class="brand">Usta</div></div>
    <div class="shell">
      <aside class="side" id="side">
        <div class="brand">Usta <small>çıraklık</small></div>
        <nav class="nav">${NAV.map(([id, ic, t]) => `<a href="#/${id}" data-r="${id}"><span>${ic}</span>${t}${id === 'tekrar' ? '<span class="badge" id="dueBadge"></span>' : ''}</a>`).join('')}</nav>
        <div class="spacer"></div>
        <div class="faint" style="padding:0 10px">Gün ${esc(S.plan?.day ?? '-')} · ${esc(S.plan?.phase ?? '')}</div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  updateDueBadge();
}

function updateDueBadge() {
  const b = $('#dueBadge'); if (!b) return;
  const n = buildQueue().length; b.textContent = n || '';
}

const ROUTES = {};
async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'bugun';
  const [name, arg] = hash.split('/');
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === name || (name === 'gun' && a.dataset.r === 'gecmis')));
  $('#side')?.classList.remove('open');
  sp.hasTTS && speechSynthesis.cancel();
  // Her rota yeni bir <main> alır; önceki rotanın geç biten işleri kopmuş düğüme yazar.
  const old = $('#main');
  const main = old.cloneNode(false);
  old.replaceWith(main);
  main.innerHTML = '<p class="muted">Yükleniyor…</p>';
  window.scrollTo(0, 0);
  await guard(() => (ROUTES[name] || ROUTES.bugun)(main, arg));
}

// ---------- BUGÜN ----------
ROUTES.bugun = async (main) => {
  if (!S.plan) { main.innerHTML = '<div class="card"><h2>Henüz plan yok</h2><p class="muted">Rutin ilk planı oluşturduğunda burada görünecek.</p></div>'; return; }
  const p = S.plan, a = S.activity.blocks;
  const due = buildQueue().length;
  const isToday = S.dayDate === todayLA();
  const prev = S.dates.filter((d) => d < S.dayDate).pop();
  const [fbToday, fbPrev] = await Promise.all([
    gh.readText(`days/${S.dayDate}/feedback.md`), prev ? gh.readText(`days/${prev}/feedback.md`) : null,
  ]);
  const icon = { review: '🔁', learn: '🎓', ticket: '🛠️', lesson: '📘', english: '🗣️' };
  const link = { review: '#/tekrar', learn: '#/ogren', ticket: '#/gorev', lesson: '#/ders', english: '#/ingilizce' };
  const blockDone = (b) => (b.kind === 'lesson' ? !!a.lesson?.done : !!a[b.kind]?.done);
  const total = p.blocks.filter((b) => b.minutes).length, doneN = p.blocks.filter((b) => b.minutes && blockDone(b)).length;
  main.innerHTML = `
    <div class="row between" style="margin-bottom:6px"><span class="faint">${esc(fmtDate(S.dayDate))}${isToday ? '' : ' · (son plan)'}</span><span class="pill accent">Gün ${esc(p.day)} · Hafta ${esc(p.week)} · ${esc(p.phase)}</span></div>
    <h1>${esc(p.title)}</h1>
    <p class="coach">${esc(p.coach_note || '')}</p>
    ${fbPrev ? `<div class="card" style="border-color:var(--accent)"><div class="row between"><div><b>Dünkü işinin değerlendirmesi hazır.</b><div class="faint">${esc(fmtDate(prev))}</div></div><a class="btn primary" href="#/gun/${prev}">Oku</a></div></div>` : ''}
    ${fbToday ? `<div class="card"><div class="row between"><b>Bu günün değerlendirmesi hazır.</b><a class="btn" href="#/gun/${S.dayDate}">Oku</a></div></div>` : ''}
    <div class="card">
      <div class="row between"><h2 style="margin:0">Bugünün planı</h2><span class="pill ${doneN === total ? 'ok' : ''}">${doneN}/${total} tamam</span></div>
      <div style="margin-top:6px">
      ${p.blocks.map((b) => `
        <div class="block ${blockDone(b) ? 'done' : ''}">
          <div class="ico">${blockDone(b) ? '✓' : icon[b.kind] || '•'}</div>
          <div><div class="t">${esc(b.title)}</div><div class="faint">${b.minutes ? b.minutes + ' dk' : ''}${b.unlock === 'after_ticket' && !a.ticket?.done ? `${b.minutes ? ' · ' : ''}teslimden sonra açılır` : ''}${b.kind === 'review' ? ` · ${due} kart bekliyor` : ''}${b.kind === 'learn' && !blockDone(b) ? ' · önce bunu oku' : ''}</div></div>
          <a class="btn ${blockDone(b) ? '' : 'primary'} small" href="${link[b.kind]}">${blockDone(b) ? 'Aç' : 'Başla'}</a>
        </div>`).join('')}
      </div>
    </div>
    <div class="grid3">
      <div class="card stat"><div class="v">${streak()}</div><div class="k">gün seri (tekrar)</div></div>
      <div class="card stat"><div class="v">${Object.keys(S.srs.cards).length}</div><div class="k">öğrenilen kart / ${S.cards.length}</div></div>
      <div class="card stat"><div class="v">${S.english?.wpm_history?.slice(-1)[0]?.wpm ?? '-'}</div><div class="k">son konuşma hızı (wpm)</div></div>
    </div>`;
};

function streak() {
  const days = new Set(S.srs.log.map((l) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(l.t))));
  let d = todayLA(), n = 0;
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// ---------- TEKRAR (FSRS) ----------
const REVIEW_HELP = `**Ne:** Öğrendiğin her şey bir karta dönüşür. Kart, tam unutmak üzereyken karşına tekrar gelir. Buna *aralıklı tekrar* denir.

**Neden:** Beyin bir bilgiyi okuyarak değil, **hatırlamaya çalışarak** kalıcı yapar. Zorlanarak hatırladığın her seferde unutma süresi uzar: önce 1 gün, sonra 3, sonra 10, sonra aylar. Böylece öğrendiğin hiçbir şey kaybolmaz, ama zaten çok iyi bildiğin şeylerle de vakit kaybetmezsin.

**Nasıl:**
1. Kartın ön yüzünü oku. Cevabı **açmadan önce** kafanda ya da sesli olarak tam kur. "Galiba biliyorum" yetmez.
2. *Cevabı göster*'e bas (ya da boşluk tuşu) ve kendi cevabınla karşılaştır.
3. Dürüstçe puanla:
   - **Again (1):** bilemedin ya da yanlış bildin. Kart bugün tekrar gelir.
   - **Hard (2):** bildin ama çok zorlandın.
   - **Good (3):** biraz düşünerek doğru bildin. En sık basacağın tuş bu.
   - **Easy (4):** hiç düşünmeden bildin.
   Butonların altındaki süre kartın bir sonraki gelişini gösterir.
4. Yazma kartında cevabı kutuya yaz ve Enter'a bas. Konuşma kartında mikrofona söyle.

**Dürüstlük kuralı:** Bilmediğine "Good" dersen kart aylarca gelmez ve o bilgi kaybolur. "Again" demek başarısızlık değil, sistemin çalışma şekli.`;

function buildQueue() {
  const t = todayLA();
  const st = S.srs.cards;
  const due = S.cards.filter((c) => st[c.id] && st[c.id].due <= t);
  const newToday = Object.values(st).filter((x) => x.first === t).length;
  let quota = Math.max(0, S.srs.params.new_per_day - newToday);
  const unseen = S.cards.filter((c) => !st[c.id]);
  const priority = new Set(S.plan?.new_cards || []);
  const picked = unseen.filter((c) => priority.has(c.id)).slice(0, quota);
  quota -= picked.length;
  const byDeck = {};
  unseen.filter((c) => !priority.has(c.id)).forEach((c) => (byDeck[c.deck] = byDeck[c.deck] || []).push(c));
  const decks = DECK_ORDER.filter((d) => byDeck[d]).concat(Object.keys(byDeck).filter((d) => !DECK_ORDER.includes(d)));
  for (let i = 0; quota > 0 && decks.some((d) => byDeck[d].length); i++) {
    const d = decks[i % decks.length];
    if (byDeck[d].length) { picked.push(byDeck[d].shift()); quota--; }
  }
  return [...shuffle(due.sort((a, b) => st[a.id].due.localeCompare(st[b.id].due))), ...picked];
}

function clozeFront(text, reveal) {
  return text.replace(/\{\{(.+?)\}\}/g, (_, x) => (reveal ? `<span class="cloze-ans">${esc(x)}</span>` : '<span class="cloze-gap">&nbsp;</span>'));
}
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

ROUTES.tekrar = async (main) => {
  const queue = buildQueue();
  const total = queue.length;
  let done = 0, sinceFlush = 0;
  const started = Date.now();
  if (!total) {
    main.innerHTML = `<h1>Tekrar</h1><div class="card"><h2>Bugünlük bitti ✓</h2><p class="muted">Bekleyen kart yok. Yarın yeni kartlar ve vadesi gelenler burada olacak.</p><a class="btn" href="#/bugun">Bugün'e dön</a></div>`;
    return;
  }
  const flush = async () => { sinceFlush = 0; await gh.writeJSON('state/srs.json', S.srs, `site: srs ${todayLA()}`); };
  const finish = async () => {
    const minutes = Math.round((Date.now() - started) / 60000);
    await flush();
    await saveActivity({ blocks: { review: { done: true, cards: done + (S.activity.blocks.review?.cards || 0), minutes: minutes + (S.activity.blocks.review?.minutes || 0) } } });
    updateDueBadge();
    main.innerHTML = `<h1>Tekrar</h1><div class="card"><h2>Bitti ✓</h2><p>${done} değerlendirme, ${minutes} dakika. Kaydedildi.</p><a class="btn primary" href="#/bugun">Bugün'e dön</a></div>`;
  };

  const show = () => {
    if (!queue.length) { main.innerHTML = '<h1>Tekrar</h1><div class="card"><p class="muted">Kaydediliyor…</p></div>'; return guard(finish); }
    const c = queue[0];
    const st = S.srs.cards[c.id];
    const iv = previewIntervals(st, todayLA(), S.srs.params);
    const t0 = performance.now();
    let revealed = false, graded = false, suggest = 0, auto = null;
    main.innerHTML = `
      <div class="row between"><h1 style="margin:0">Tekrar</h1><span class="faint">${done} / ${total}${queue.length > total - done ? ' (+tekrar)' : ''}</span></div>
      <div class="progress" style="margin-top:12px"><i style="width:${Math.min(100, (done / total) * 100)}%"></i></div>
      <div class="card flash">
        <div class="row between"><span class="deck">${esc(DECK_LABEL[c.deck] || c.deck)} · ${esc(c.type)}${st ? '' : ' · yeni'}</span>${c.say && c.type !== 'speak' ? '<button class="btn small" id="say">🔊</button>' : ''}</div>
        <div class="front md" id="front"></div>
        <div id="interact"></div>
        <div class="back md hidden" id="back"></div>
        <div class="grades hidden" id="grades">
          ${['Again', 'Hard', 'Good', 'Easy'].map((g, i) => `<button class="btn g${i + 1}" data-g="${i + 1}">${g}<small>${iv[i]} · <kbd>${i + 1}</kbd></small></button>`).join('')}
        </div>
        <div class="row" id="revealRow" style="margin-top:auto;padding-top:16px"><button class="btn primary" id="reveal">Cevabı göster <kbd>boşluk</kbd></button></div>
      </div>
      <p class="faint">Önce cevabı zihninde (ya da sesli) kur, sonra aç. Dürüst puan ver: sistem buna göre tekrar zamanlar.</p>
      <details class="card learnbox" ${S.srs.log.length < 40 ? 'open' : ''}><summary>🎓 Tekrar nasıl çalışır?</summary><div class="md">${md(REVIEW_HELP)}</div></details>`;
    const front = $('#front'), back = $('#back'), inter = $('#interact');
    if (c.type === 'cloze') front.innerHTML = md(clozeFront(c.front, false));
    else front.innerHTML = md(c.front);
    if ($('#say')) $('#say').onclick = () => sp.speak(c.say);

    const reveal = () => {
      if (revealed) return; revealed = true;
      if (c.type === 'cloze') front.innerHTML = md(clozeFront(c.front, true));
      back.innerHTML = md(c.back); back.classList.remove('hidden');
      $('#grades').classList.remove('hidden'); $('#revealRow').classList.add('hidden');
      if (suggest) $(`#grades [data-g="${suggest}"]`).classList.add('suggest');
    };
    $('#reveal').onclick = reveal;

    if (c.type === 'type') {
      inter.innerHTML = `<div class="row"><input type="text" id="ans" placeholder="Cevabını yaz, Enter" autocomplete="off" style="flex:1" /></div><div id="res" class="tip" style="margin-top:6px"></div>`;
      const inp = $('#ans'); inp.focus();
      inp.onkeydown = (e) => {
        if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation();
        const ok = String(c.answer).split('|').some((x) => norm(x) === norm(inp.value));
        suggest = ok ? 3 : 1;
        $('#res').innerHTML = ok ? '<span class="pill ok">Doğru</span>' : `<span class="pill bad">Beklenen: ${esc(String(c.answer).split('|')[0])}</span>`;
        reveal();
      };
    }
    if (c.type === 'speak') {
      inter.innerHTML = `
        <div class="say">${esc(c.say)}</div>${c.ipa ? `<div class="ipa">${esc(c.ipa)}</div>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn" id="l1">🔊 Dinle</button><button class="btn" id="l2">🐢 Yavaş</button><button class="btn primary" id="rec">🎙 Söyle</button></div>
        <div id="res"></div>`;
      $('#l1').onclick = () => sp.speak(c.say, 1);
      $('#l2').onclick = () => sp.speak(c.say, 0.7);
      $('#rec').onclick = () => pronounce(c.say, $('#res'), $('#rec'), (r) => {
        auto = +r.score.toFixed(2); suggest = r.score >= 0.999 ? 3 : r.score >= 0.8 ? 2 : 1; reveal();
        $$('#grades .btn').forEach((b) => b.classList.toggle('suggest', +b.dataset.g === suggest));
      });
    }

    const grade = (g) => {
      if (!revealed || graded) return;
      graded = true;
      const today = todayLA();
      const next = schedule(st, g, today, S.srs.params);
      next.first = st?.first || today;
      S.srs.cards[c.id] = next;
      S.srs.log.push({ id: c.id, t: new Date().toISOString(), g, ms: Math.round(performance.now() - t0), ...(auto != null ? { auto } : {}) });
      if (S.srs.log.length > 3000) S.srs.log = S.srs.log.slice(-3000);
      queue.shift(); done++;
      if (g === 1) queue.splice(Math.min(3, queue.length), 0, c);
      if (++sinceFlush >= 8) guard(flush);
      show();
    };
    $$('#grades .btn').forEach((b) => (b.onclick = () => grade(+b.dataset.g)));
    document.onkeydown = (e) => {
      if (!location.hash.startsWith('#/tekrar')) { document.onkeydown = null; return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); reveal(); }
      if (['1', '2', '3', '4'].includes(e.key)) grade(+e.key);
    };
  };
  window.addEventListener('hashchange', () => { if (sinceFlush) guard(flush); }, { once: true });
  show();
};

// Ortak telaffuz denemesi: dinle -> hizala -> göster
function pronounce(target, out, btn, onDone) {
  if (!sp.hasRecognition) { out.innerHTML = '<p class="tip">Bu tarayıcı konuşma tanımayı desteklemiyor. Chrome ya da Safari kullan.</p>'; return; }
  btn.disabled = true; btn.classList.add('rec'); btn.textContent = '● Dinliyorum… (bitince sus)';
  out.innerHTML = '<div class="live" id="lv"></div>';
  const words = target.split(/\s+/).length;
  const h = sp.listen({ continuous: false, maxSeconds: Math.max(6, words * 0.9 + 3), onInterim: (t) => { const lv = out.querySelector('.live'); if (lv) lv.textContent = t; } });
  h.done.then((r) => {
    btn.disabled = false; btn.classList.remove('rec'); btn.textContent = '🎙 Tekrar söyle';
    const a = sp.align(target, r.transcript);
    const pct = Math.round(a.score * 100);
    out.innerHTML = `
      <div class="tokens">${a.tokens.map((t) => `<span class="tok ${t.ok ? 'ok' : 'miss'}">${esc(t.w)}</span>`).join('')}</div>
      <div class="heard">Duyulan: “${esc(r.transcript || '(hiçbir şey)')}” · <span class="score">${pct}%</span></div>
      ${r.audioUrl ? `<audio controls src="${r.audioUrl}" style="margin-top:8px;width:100%;max-width:360px"></audio>` : ''}
      ${a.missed.length ? `<div class="tip">Kırmızı kelimeleri yavaş sürümle dinle, sadece o kelimeyi 3 kez söyle, sonra cümleyi tekrar dene.</div>` : ''}`;
    onDone && onDone({ ...a, heard: r.transcript });
  });
}

// ---------- ÖĞREN ----------
ROUTES.ogren = async (main) => {
  const lb = S.plan?.blocks?.find((b) => b.kind === 'learn');
  if (!lb) { main.innerHTML = '<div class="card">Bugün ayrı bir öğretim sayfası yok. Doğrudan <a href="#/gorev">göreve</a> geç.</div>'; return; }
  const text = await gh.readText(`days/${S.dayDate}/${lb.file}`);
  const done = !!S.activity.blocks.learn?.done;
  main.innerHTML = `
    <div class="row between"><span class="pill accent">🎓 Öğren</span><a class="btn small" href="#/gorev">Bileti yan sekmede aç ↗</a></div>
    <div class="card md" style="margin-top:10px">${md(text || '_Öğretim dosyası yok._')}</div>
    <div class="card row between"><span>Adımları yaptın ve testlerin geçiyor mu? Şimdi bilete dön, teslimi yap.</span><button class="btn primary" id="lrn">${done ? 'Göreve git →' : 'Öğrendim, göreve geç →'}</button></div>`;
  $$('a[href="#/gorev"]', main)[0].onclick = (e) => { e.preventDefault(); window.open(`${location.pathname}#/gorev`, '_blank'); };
  $('#lrn').onclick = () => guard(async () => { if (!done) await saveActivity({ blocks: { learn: { done: true, at: new Date().toISOString() } } }); location.hash = '#/gorev'; });
};

// ---------- GÖREV ----------
ROUTES.gorev = async (main) => {
  if (!S.plan?.ticket) { main.innerHTML = '<div class="card">Bugün bilet yok.</div>'; return; }
  const tk = S.plan.ticket;
  const [ticket, pr, files] = await Promise.all([
    gh.readText(`days/${S.dayDate}/ticket.md`), gh.readText(subPath('pr.md')), gh.listDir(tk.deliver?.replace(/\/$/, '') || `work/${tk.id}`),
  ]);
  const done = !!S.activity.blocks.ticket?.done;
  const needLearn = S.plan.blocks?.some((b) => b.kind === 'learn') && !S.activity.blocks.learn?.done;
  main.innerHTML = `
    ${needLearn ? '<div class="card" style="border-color:var(--accent)"><div class="row between"><span><b>Önce Öğren sayfası.</b> Bu biletteki her adım orada sıfırdan, nedenleriyle anlatılıyor.</span><a class="btn primary small" href="#/ogren">Öğren\'e git</a></div></div>' : ''}
    <div class="row between"><span class="pill accent">${esc(tk.id)}</span>${done ? '<span class="pill ok">Teslim edildi</span>' : '<span class="pill">Açık</span>'}</div>
    <div class="card md" style="margin-top:10px">${md(ticket || '_Bilet dosyası bulunamadı._')}</div>
    <div class="card stack">
      <h2>Teslim</h2>
      <div><label>Kod: <code>${esc(tk.deliver || 'work/' + tk.id)}</code></label>
        ${files.length ? `<div class="row">${files.map((f) => `<span class="pill ok">${esc(f.name)}</span>`).join('')}</div>` : '<p class="tip">Bu klasörde henüz dosya görünmüyor. Kodunu repoya push ettiğinde burada listelenir:<br><code>git clone https://github.com/cgrtml/usta && cd usta</code></p>'}
      </div>
      <div><label for="pr">PR açıklaması (İngilizce)</label><textarea id="pr" placeholder="## What&#10;## Why&#10;## How I tested it&#10;## Open questions">${esc(pr || '')}</textarea><div class="faint" id="prc"></div></div>
      <div><label for="refl">Kendine not: ne zordu, nerede takıldın? (Türkçe olabilir)</label><textarea id="refl" style="min-height:80px">${esc(S.activity.reflection || '')}</textarea></div>
      <div class="row"><button class="btn" id="save">Kaydet</button><button class="btn primary" id="submit" ${done ? 'disabled' : ''}>Teslim ettim → dersi aç</button></div>
    </div>`;
  const prc = () => ($('#prc').textContent = `${wc($('#pr').value)} kelime`);
  $('#pr').oninput = prc; prc();
  const save = async () => {
    await gh.writeText(subPath('pr.md'), $('#pr').value, `site: ${S.dayDate} pr`);
    await saveActivity({ reflection: $('#refl').value });
  };
  $('#save').onclick = () => guard(save, 'Kaydedildi');
  $('#submit').onclick = () => guard(async () => {
    if (!files.length && !confirm('work/ klasöründe kod görünmüyor. Yine de teslim edildi olarak işaretlensin mi?')) return;
    await save();
    await saveActivity({ blocks: { ticket: { done: true, at: new Date().toISOString(), files: files.map((f) => f.name) } } });
    location.hash = '#/ders';
  }, 'Teslim kaydedildi');
};

// ---------- DERS ----------
ROUTES.ders = async (main) => {
  const lb = S.plan?.blocks?.find((b) => b.kind === 'lesson');
  if (!lb) { main.innerHTML = '<div class="card">Bugün ders yok.</div>'; return; }
  const unlocked = lb.unlock !== 'after_ticket' || S.activity.blocks.ticket?.done;
  if (!unlocked) {
    main.innerHTML = `<h1>${esc(lb.title)}</h1><div class="card"><h2>🔒 Teslimden sonra açılır</h2>
      <p>Kapanış dersi kendi kodunu kontrol etmen, kararların nedenini pekiştirmen ve bu konunun mülakatta nasıl sorulduğunu görmen için. Önce Öğren sayfasındaki adımları bitir ve bileti teslim et.</p>
      <div class="row"><a class="btn" href="#/ogren">Öğren</a><a class="btn primary" href="#/gorev">Bilete git</a></div></div>`;
    return;
  }
  const text = await gh.readText(`days/${S.dayDate}/${lb.file}`);
  main.innerHTML = `<div class="card md">${md(text || '_Ders dosyası yok._')}</div>
    <div class="card row between"><span>Kontrol listesini kendi kodunda uyguladın mı?</span><button class="btn primary" id="ld" ${S.activity.blocks.lesson?.done ? 'disabled' : ''}>${S.activity.blocks.lesson?.done ? 'Okundu ✓' : 'Okudum'}</button></div>`;
  $('#ld').onclick = () => guard(async () => { await saveActivity({ blocks: { lesson: { done: true } } }); $('#ld').disabled = true; $('#ld').textContent = 'Okundu ✓'; }, 'İşaretlendi');
};

// ---------- İNGİLİZCE ----------
ROUTES.ingilizce = async (main, tab = 'telaffuz') => {
  const E = S.plan?.english;
  if (!E) { main.innerHTML = '<div class="card">Bugün İngilizce bloğu yok.</div>'; return; }
  const tabs = [['telaffuz', 'Telaffuz'], ['kelime', 'Kelimeler'], ['dikte', 'Dikte'], ['yazma', 'Yazma'], ['konusma', 'Konuşma']];
  main.innerHTML = `
    <div class="row between"><h1 style="margin:0">İngilizce</h1><span class="pill accent">Odak: ${esc(E.focus || '-')}</span></div>
    ${!sp.hasRecognition ? '<div class="card" style="border-color:var(--warn)">Bu tarayıcıda konuşma tanıma yok. Telaffuz ve konuşma için Chrome ya da Safari (macOS/iOS) kullan.</div>' : ''}
    <div id="enIntro"></div>
    <div class="tabs" style="margin-top:14px">${tabs.map(([id, t]) => `<button data-t="${id}" class="${id === tab ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="enLearn"></div>
    <div id="pane"></div>
    <div class="card row between"><span>İngilizce bloğunu bitirdin mi?</span><button class="btn primary" id="endone" ${S.activity.blocks.english?.done ? 'disabled' : ''}>${S.activity.blocks.english?.done ? 'Tamam ✓' : 'Bitirdim'}</button></div>`;
  $$('.tabs button').forEach((b) => (b.onclick = () => { location.hash = `#/ingilizce/${b.dataset.t}`; }));
  $('#endone').onclick = () => guard(async () => { await saveActivity({ blocks: { english: { done: true } } }); $('#endone').disabled = true; $('#endone').textContent = 'Tamam ✓'; }, 'Kaydedildi');
  const lf = S.plan.blocks?.find((b) => b.kind === 'english')?.learn_file;
  if (lf) {
    const sec = splitLearn(await gh.readText(`days/${S.dayDate}/${lf}`));
    const key = (id) => `usta.enl.${S.dayDate}.${id}`;
    const box = (id, title, body) => {
      let closed = false; try { closed = localStorage.getItem(key(id)) === '0'; } catch {}
      return `<details class="card learnbox" data-k="${id}" ${closed ? '' : 'open'}><summary>🎓 ${esc(title)}</summary><div class="md">${md(body)}</div></details>`;
    };
    if (sec.intro) $('#enIntro').innerHTML = box('intro', 'Bugünkü İngilizce bloğu nasıl çalışır?', sec.intro);
    const cur = sec.parts.find((x) => x.id.startsWith(tab === 'kelime' ? 'kelime' : tab));
    if (cur) $('#enLearn').innerHTML = box(tab, `Önce öğren: ${cur.title}`, cur.body);
    $$('details.learnbox', main).forEach((d) => d.addEventListener('toggle', () => { try { localStorage.setItem(key(d.dataset.k), d.open ? '1' : '0'); } catch {} }));
  }
  await (EN_TABS[tab] || EN_TABS.telaffuz)($('#pane'), E);
};

function splitLearn(text) {
  const out = { intro: '', parts: [] };
  if (!text) return out;
  const chunks = text.split(/^## /m);
  out.intro = chunks.shift().trim();
  for (const c of chunks) {
    const nl = c.indexOf('\n');
    const title = (nl < 0 ? c : c.slice(0, nl)).trim();
    const id = title.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
    out.parts.push({ id, title, body: nl < 0 ? '' : c.slice(nl + 1).trim() });
  }
  return out;
}

async function appendJSON(file, item) {
  const cur = (await gh.readJSON(subPath(file), [])) || [];
  cur.push({ ...item, t: new Date().toISOString() });
  await gh.writeJSON(subPath(file), cur, `site: ${S.dayDate} ${file}`);
}

const EN_TABS = {};
EN_TABS.telaffuz = async (pane, E) => {
  pane.innerHTML = `
    <p class="muted">Shadowing: önce dinle, sonra aynı ritim ve vurguyla söyle. Kırmızı çıkan kelime tanıyıcının duymadığı kelimedir; çoğu zaman o seste bir sorun vardır.</p>
    ${(E.shadowing || []).map((s, i) => `
      <div class="card">
        <div class="row between"><span class="pill">${esc(s.focus || '')}</span></div>
        <div class="say" style="margin-top:8px">${esc(s.text)}</div>
        ${s.tip ? `<div class="tip">${esc(s.tip)}</div>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn" data-l="${i}">🔊 Dinle</button><button class="btn" data-s="${i}">🐢 Yavaş</button><button class="btn primary" data-r="${i}">🎙 Söyle</button></div>
        <div id="sr${i}"></div>
      </div>`).join('')}
    ${(E.minimal_pairs || []).length ? `<h2 style="margin-top:22px">Minimal çiftler: kulak eğitimi</h2><p class="muted">“Çal” rastgele birini okur. Hangisini duyduğunu seç. Sonra ikisini de söyle.</p>` : ''}
    ${(E.minimal_pairs || []).map((p, i) => `
      <div class="card">
        <div class="row between"><b>${esc(p.a)} · ${esc(p.b)}</b><span class="pill">${esc(p.focus)}</span></div>
        <div class="row" style="margin-top:8px"><button class="btn" data-mp="${i}">🔊 Çal</button><button class="btn" data-ch="${i}:a">${esc(p.a)}</button><button class="btn" data-ch="${i}:b">${esc(p.b)}</button><span id="mpr${i}" class="tip"></span></div>
        <div class="row" style="margin-top:8px"><button class="btn small" data-say="${i}:a">🎙 “${esc(p.a)}” de</button><button class="btn small" data-say="${i}:b">🎙 “${esc(p.b)}” de</button></div>
        <div id="mps${i}"></div>
      </div>`).join('')}`;
  const sh = E.shadowing || [];
  $$('[data-l]', pane).forEach((b) => (b.onclick = () => sp.speak(sh[b.dataset.l].text, 1)));
  $$('[data-s]', pane).forEach((b) => (b.onclick = () => sp.speak(sh[b.dataset.s].text, 0.7)));
  $$('[data-r]', pane).forEach((b) => (b.onclick = () => {
    const s = sh[b.dataset.r];
    pronounce(s.text, $(`#sr${b.dataset.r}`), b, (r) => guard(() => appendJSON('pronunciation.json', { kind: 'shadowing', target: s.text, focus: s.focus, heard: r.heard, score: +r.score.toFixed(2), missed: r.missed })));
  }));
  const mp = E.minimal_pairs || [];
  const played = {};
  $$('[data-mp]', pane).forEach((b) => (b.onclick = () => { const i = b.dataset.mp; played[i] = Math.random() < 0.5 ? 'a' : 'b'; sp.speak(mp[i][played[i]], 0.9); $(`#mpr${i}`).textContent = 'Hangisi?'; }));
  $$('[data-ch]', pane).forEach((b) => (b.onclick = () => {
    const [i, side] = b.dataset.ch.split(':');
    if (!played[i]) { $(`#mpr${i}`).textContent = 'Önce “Çal”a bas.'; return; }
    const ok = played[i] === side;
    $(`#mpr${i}`).innerHTML = ok ? '<span class="pill ok">Doğru</span>' : `<span class="pill bad">Okunan: ${esc(mp[i][played[i]])}</span>`;
    guard(() => appendJSON('pronunciation.json', { kind: 'pair-listen', pair: [mp[i].a, mp[i].b], played: mp[i][played[i]], ok }));
    played[i] = null;
  }));
  $$('[data-say]', pane).forEach((b) => (b.onclick = () => {
    const [i, side] = b.dataset.say.split(':'); const w = mp[i][side];
    pronounce(w, $(`#mps${i}`), b, (r) => guard(() => appendJSON('pronunciation.json', { kind: 'pair-say', target: w, heard: r.heard, score: +r.score.toFixed(2), missed: r.missed })));
  }));
};

EN_TABS.kelime = async (pane, E) => {
  const saved = (await gh.readJSON(subPath('vocab.json'), [])) || [];
  pane.innerHTML = (E.vocab || []).map((v, i) => `
    <div class="card">
      <div class="row between"><div><b style="font-size:1.15rem">${esc(v.word)}</b> <span class="ipa">${esc(v.ipa || '')}</span></div><div class="row"><button class="btn small" data-w="${i}">🔊 kelime</button><button class="btn small" data-e="${i}">🔊 örnek</button></div></div>
      <div class="muted">${esc(v.tr || '')}</div>
      <p style="margin:8px 0 4px"><i>${esc(v.example || '')}</i></p>
      ${v.collocations?.length ? `<div class="row">${v.collocations.map((c) => `<span class="pill">${esc(c)}</span>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn small" data-r="${i}">🎙 Örneği söyle</button></div><div id="vr${i}"></div>
      <div style="margin-top:10px"><label for="vs${i}">Kendi işinden bir cümle kur</label><div class="row"><input type="text" id="vs${i}" value="${esc(saved.filter((s) => s.word === v.word).pop()?.sentence || '')}" style="flex:1" /><button class="btn small" data-save="${i}">Kaydet</button></div></div>
    </div>`).join('');
  const V = E.vocab || [];
  $$('[data-w]', pane).forEach((b) => (b.onclick = () => sp.speak(V[b.dataset.w].word, 0.85)));
  $$('[data-e]', pane).forEach((b) => (b.onclick = () => sp.speak(V[b.dataset.e].example, 1)));
  $$('[data-r]', pane).forEach((b) => (b.onclick = () => { const v = V[b.dataset.r]; pronounce(v.example, $(`#vr${b.dataset.r}`), b, (r) => guard(() => appendJSON('pronunciation.json', { kind: 'vocab', target: v.example, heard: r.heard, score: +r.score.toFixed(2), missed: r.missed }))); }));
  $$('[data-save]', pane).forEach((b) => (b.onclick = () => guard(() => appendJSON('vocab.json', { word: V[b.dataset.save].word, sentence: $(`#vs${b.dataset.save}`).value }), 'Kaydedildi')));
};

EN_TABS.dikte = async (pane, E) => {
  const D = E.dictation || [];
  pane.innerHTML = `<p class="muted">Dinle, duyduğunu yaz. Gerekirse yavaş sürümü aç ama önce normal hızda dene.</p>` + D.map((d, i) => `
    <div class="card">
      <div class="row"><button class="btn" data-p="${i}">🔊 Çal</button><button class="btn" data-ps="${i}">🐢 Yavaş</button></div>
      <div class="row" style="margin-top:8px"><input type="text" id="dt${i}" placeholder="Duyduğunu yaz" style="flex:1" autocomplete="off" /><button class="btn primary" data-c="${i}">Kontrol</button></div>
      <div id="dr${i}"></div>
    </div>`).join('');
  $$('[data-p]', pane).forEach((b) => (b.onclick = () => sp.speak(D[b.dataset.p], 1)));
  $$('[data-ps]', pane).forEach((b) => (b.onclick = () => sp.speak(D[b.dataset.ps], 0.7)));
  $$('[data-c]', pane).forEach((b) => (b.onclick = () => {
    const i = b.dataset.c, typed = $(`#dt${i}`).value; const a = sp.align(D[i], typed);
    $(`#dr${i}`).innerHTML = `<div class="tokens">${a.tokens.map((t) => `<span class="tok ${t.ok ? 'ok' : 'miss'}">${esc(t.w)}</span>`).join('')}</div><div class="heard">${a.missed.length} hata · doğru cümle: “${esc(D[i])}”</div>`;
    guard(() => appendJSON('dictation.json', { target: D[i], typed, errors: a.missed.length }));
  }));
};

EN_TABS.yazma = async (pane, E) => {
  const W = E.writing; if (!W) { pane.innerHTML = '<div class="card">Bugün yazma yok.</div>'; return; }
  const prev = (await gh.readText(subPath('writing.md'))) || '';
  const body = prev.replace(/^<!--[\s\S]*?-->\n?/, '');
  pane.innerHTML = `
    <div class="card">
      <div class="row between"><h2 style="margin:0">Yazma</h2><span class="pill">${esc(W.genre || '')} · ${W.min_words}-${W.max_words} kelime</span></div>
      <p style="margin-top:8px">${esc(W.prompt)}</p>
      ${W.rubric?.length ? `<div class="faint">Değerlendirme: ${W.rubric.map(esc).join(' · ')}</div>` : ''}
      <textarea id="wr" style="min-height:240px;margin-top:10px" spellcheck="false">${esc(body)}</textarea>
      <div class="row between"><span class="faint" id="wcount"></span><button class="btn primary" id="wsave">Kaydet</button></div>
      <p class="faint">Yazım denetimini kapattım: hataları sen bul. Değerlendirme yarın sabah gelir.</p>
    </div>`;
  let t0 = null;
  const upd = () => { const n = wc($('#wr').value); $('#wcount').textContent = `${n} kelime${n < W.min_words ? ` · en az ${W.min_words}` : n > W.max_words ? ' · fazla uzun' : ' ✓'}`; };
  $('#wr').oninput = () => { t0 = t0 || Date.now(); upd(); }; upd();
  $('#wsave').onclick = () => guard(async () => {
    const txt = $('#wr').value; const mins = t0 ? Math.round((Date.now() - t0) / 60000) : 0;
    await gh.writeText(subPath('writing.md'), `<!-- words: ${wc(txt)}, minutes: ${mins} -->\n${txt}`, `site: ${S.dayDate} writing`);
  }, 'Kaydedildi');
};

EN_TABS.konusma = async (pane, E) => {
  const K = E.speaking; if (!K) { pane.innerHTML = '<div class="card">Bugün konuşma yok.</div>'; return; }
  const prev = await gh.readJSON(subPath('speaking.json'), null);
  pane.innerHTML = `
    <div class="card">
      <div class="row between"><h2 style="margin:0">Konuşma</h2><span class="pill">${esc(K.type || '')} · ${K.seconds} sn</span></div>
      <p style="margin-top:8px">${esc(K.prompt)}</p>
      <p class="faint">10 saniye düşün, not alma. Sonra kaydı başlat ve hedef süre boyunca durmadan konuş. Hata yapınca düzelt ve devam et, baştan başlama.</p>
      <div class="row"><button class="btn primary" id="go">🎙 Başlat</button><span id="clock" class="faint"></span></div>
      <div class="live" id="live" style="margin-top:10px"></div>
      <div id="out"></div>
      ${prev ? `<p class="faint" style="margin-top:10px">Kayıtlı deneme sayısı: ${prev.attempts || 1}. Son: ${prev.wpm} wpm, ${prev.seconds} sn.</p>` : ''}
    </div>`;
  let handle = null, tick;
  $('#go').onclick = () => {
    const btn = $('#go');
    if (handle) { handle.stop(); return; }
    if (!sp.hasRecognition) { toast('Konuşma tanıma yok (Chrome/Safari).'); return; }
    const t0 = Date.now();
    btn.textContent = '■ Bitir'; btn.classList.add('rec');
    tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $('#clock').textContent = `${s} / ${K.seconds} sn`; }, 250);
    handle = sp.listen({ continuous: true, maxSeconds: K.seconds + 30, onInterim: (t) => ($('#live').textContent = t) });
    handle.done.then((r) => {
      clearInterval(tick); handle = null; btn.textContent = '🎙 Yeniden dene'; btn.classList.remove('rec');
      const m = sp.speechMetrics(r.transcript, r.seconds);
      const fill = Object.entries(m.fillers).map(([k, v]) => `${k} ×${v}`).join(', ') || 'yok';
      $('#out').innerHTML = `
        <div class="grid4" style="margin-top:12px">
          <div class="card stat"><div class="v">${Math.round(r.seconds)}</div><div class="k">saniye</div></div>
          <div class="card stat"><div class="v">${m.wpm}</div><div class="k">kelime/dk</div></div>
          <div class="card stat"><div class="v">${m.words}</div><div class="k">kelime</div></div>
          <div class="card stat"><div class="v">${m.lexical_variety}</div><div class="k">çeşitlilik</div></div>
        </div>
        <p class="tip">Dolgu sözcükleri: ${esc(fill)}. Akıcı profesyonel konuşma genelde 120-160 wpm aralığında.</p>
        ${r.audioUrl ? `<audio controls src="${r.audioUrl}" style="width:100%"></audio>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn primary" id="ssave">Bu denemeyi gönder</button></div>`;
      $('#ssave').onclick = () => guard(async () => {
        const cur = (await gh.readJSON(subPath('speaking.json'), null)) || { history: [] };
        const rec = { prompt: K.prompt, transcript: r.transcript, seconds: Math.round(r.seconds), ...m, t: new Date().toISOString() };
        const next = { ...rec, attempts: (cur.attempts || 0) + 1, history: [...(cur.history || []), rec].slice(-5) };
        await gh.writeJSON(subPath('speaking.json'), next, `site: ${S.dayDate} speaking`);
        $('#ssave').disabled = true;
      }, 'Gönderildi; yarın değerlendirilecek');
    });
  };
};

// ---------- GELİŞİM ----------
ROUTES.gelisim = async (main) => {
  const log = S.srs.log;
  const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso));
  const counts = {}; log.forEach((l) => { const d = dayOf(l.t); counts[d] = (counts[d] || 0) + 1; });
  const t = todayLA(); const since30 = addDays(t, -30);
  const recent = log.filter((l) => dayOf(l.t) >= since30);
  const retention = recent.length ? Math.round((recent.filter((l) => l.g > 1).length / recent.length) * 100) : null;
  const tomorrow = Object.values(S.srs.cards).filter((c) => c.due <= addDays(t, 1)).length;
  // ısı haritası: son 16 hafta
  let start = addDays(t, -16 * 7 + 1); const dow = new Date(start + 'T12:00:00Z').getUTCDay(); start = addDays(start, -((dow + 6) % 7));
  const cells = []; for (let d = start; d <= t; d = addDays(d, 1)) { const n = counts[d] || 0; cells.push(`<i title="${d}: ${n}" class="${n ? (n < 15 ? 'l1' : n < 40 ? 'l2' : 'l3') : ''}"></i>`); }
  const comp = S.mastery.competencies || {};
  const cefr = S.mastery.english?.cefr || {};
  const phases = S.cur.ai?.phases || [];
  const deckStats = DECK_ORDER.map((d) => { const all = S.cards.filter((c) => c.deck === d); const seen = all.filter((c) => S.srs.cards[c.id]); const strong = seen.filter((c) => S.srs.cards[c.id].s >= 21); return { d, all: all.length, seen: seen.length, strong: strong.length }; });
  main.innerHTML = `
    <h1>Gelişim</h1>
    <div class="grid4">
      <div class="card stat"><div class="v">${streak()}</div><div class="k">gün seri</div></div>
      <div class="card stat"><div class="v">${log.length}</div><div class="k">toplam değerlendirme</div></div>
      <div class="card stat"><div class="v">${retention == null ? '-' : retention + '%'}</div><div class="k">hatırlama (30 gün)</div></div>
      <div class="card stat"><div class="v">${tomorrow}</div><div class="k">yarına kadar vadesi gelen</div></div>
    </div>
    <div class="card"><h2>Çalışma ısı haritası</h2><div class="heat">${cells.join('')}</div><p class="faint" style="margin-top:6px">Son 16 hafta, günlük tekrar sayısı.</p></div>
    <div class="grid2">
      <div class="card"><h2>Desteler</h2>${deckStats.map((s) => `<div class="comp"><span>${esc(DECK_LABEL[s.d])}<br><span class="faint">${s.seen}/${s.all} görüldü · ${s.strong} kalıcı (≥3 hafta)</span></span><span style="width:120px;align-self:center"><div class="bar"><i style="width:${s.all ? (s.seen / s.all) * 100 : 0}%"></i></div></span></div>`).join('')}</div>
      <div class="card"><h2>İngilizce (CEFR tahmini)</h2>${['speaking', 'writing', 'pronunciation', 'vocabulary', 'listening'].map((k) => `<div class="comp"><span>${({ speaking: 'Konuşma', writing: 'Yazma', pronunciation: 'Telaffuz', vocabulary: 'Kelime', listening: 'Dinleme' })[k]}</span><b>${esc(cefr[k] || 'ölçülüyor')}</b></div>`).join('')}
        ${S.english?.weak_sounds?.length ? `<p class="tip" style="margin-top:8px">Zayıf sesler: ${S.english.weak_sounds.map(esc).join(', ')}</p>` : ''}</div>
    </div>
    <div class="card"><h2>Yetkinlik haritası</h2>
      ${phases.map((p) => { const ids = p.modules.flatMap((m) => m.competencies.map((c) => c.id)); const sum = ids.reduce((a, id) => a + (comp[id]?.level || 0), 0); const pct = ids.length ? (sum / (ids.length * 4)) * 100 : 0; return `<div class="comp"><span><b>${esc(p.id)}</b> ${esc(p.title)} ${p.id === S.profile.current_phase ? '<span class="pill accent">şu an</span>' : ''}</span><span style="width:160px;align-self:center"><div class="bar"><i style="width:${pct}%"></i></div></span></div>`; }).join('')}
      <p class="faint" style="margin-top:8px">Seviye yalnız kanıtla (çalışan kod, geçen test, doğru açıklama) artar. Ayrıntı: Müfredat.</p>
    </div>`;
};

// ---------- MÜFREDAT ----------
ROUTES.mufredat = async (main) => {
  const comp = S.mastery.competencies || {};
  const lvl = (n) => `<span class="lvl" title="seviye ${n}/4">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'f' : ''}"></i>`).join('')}</span>`;
  const phases = S.cur.ai?.phases || [];
  const strands = S.cur.en?.strands || [];
  main.innerHTML = `
    <h1>Müfredat</h1>
    <p class="muted">Hedef: ${esc(S.cur.ai?.target_role || '')}. Kareler yetkinlik seviyesi: 1 tanır · 2 yardımla uygular · 3 bağımsız uygular · 4 tasarlar ve öğretir.</p>
    ${phases.map((p) => `
      <details class="card" ${p.id === S.profile.current_phase ? 'open' : ''}>
        <summary><b>${esc(p.id)} · ${esc(p.title)}</b> <span class="faint">${esc(p.weeks)} hafta${p.continuous ? ' · sürekli kol' : ''}</span> ${p.id === S.profile.current_phase ? '<span class="pill accent">şu an</span>' : ''}</summary>
        <p class="muted" style="margin-top:8px">${esc(p.goal || '')}</p>
        ${p.exit_criteria?.length ? `<div class="faint">Çıkış ölçütü: ${p.exit_criteria.map(esc).join(' · ')}</div>` : ''}
        ${p.modules.map((m) => `
          <div style="margin-top:14px"><h3>${esc(m.title)}</h3>
          ${m.why ? `<p class="tip">${esc(m.why)}</p>` : ''}
          ${m.competencies.map((c) => `<div class="comp"><span>${esc(c.title)}<br><span class="faint">${esc(c.can_do || '')}</span></span>${lvl(comp[c.id]?.level || 0)}</div>`).join('')}
          ${m.capstone ? `<p class="tip" style="margin-top:6px"><b>Modül sonu ürünü:</b> ${esc(m.capstone)}</p>` : ''}
          ${m.resources?.length ? `<div class="faint">Kaynak: ${m.resources.map((r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title))).join(' · ')}</div>` : ''}
          </div>`).join('')}
      </details>`).join('')}
    <h2 style="margin-top:24px">İngilizce kolları</h2>
    ${strands.map((s) => `<details class="card"><summary><b>${esc(s.title)}</b></summary>${s.competencies.map((c) => `<div class="comp"><span>${esc(c.title)}<br><span class="faint">${esc(c.can_do || '')}</span></span>${lvl(comp[c.id]?.level || 0)}</div>`).join('')}</details>`).join('')}`;
};

// ---------- RESUME ----------
ROUTES.resume = async (main, tab = 'resume') => {
  const tabs = [['resume', 'Resume'], ['acik', 'Açıklar'], ['kanit', 'Kanıtlar']];
  main.innerHTML = `<h1>Resume</h1><div class="tabs">${tabs.map(([id, t]) => `<button data-t="${id}" class="${id === tab ? 'on' : ''}">${t}</button>`).join('')}</div><div id="pane"><p class="muted">Yükleniyor…</p></div>`;
  $$('.tabs button').forEach((b) => (b.onclick = () => { location.hash = `#/resume/${b.dataset.t}`; }));
  const pane = $('#pane');
  if (tab === 'kanit') {
    const ev = (await gh.readJSON('resume/evidence.json', { items: [] })).items || [];
    pane.innerHTML = `<div class="card">${ev.slice().reverse().map((e) => `<div class="comp"><span>${esc(e.claim)}<br><span class="faint">${esc(e.date || '')} · ${(e.competencies || []).map(esc).join(', ')} · ${esc(e.source || '')}</span></span>${e.link ? `<a class="btn small" href="${esc(e.link)}" target="_blank" rel="noopener">Bağlantı</a>` : ''}</div>`).join('') || 'Henüz kanıt yok.'}</div>`;
    return;
  }
  const text = await gh.readText(tab === 'acik' ? 'resume/gap.md' : 'resume/resume.md');
  pane.innerHTML = `<div class="card md">${md(text || '_Dosya yok._')}</div>${tab === 'resume' ? '<p class="faint">Rutin her ayın ilk günü bu belgeyi yalnız yeni kanıtlarla günceller. <code>[[TODO]]</code> işaretleri senin doldurman gereken gerçek bilgileri gösterir.</p>' : ''}`;
};

// ---------- GEÇMİŞ ve GÜN GÖRÜNÜMÜ ----------
ROUTES.gecmis = async (main) => {
  const dates = [...S.dates].reverse().slice(0, 60);
  const plans = await Promise.all(dates.map((d) => gh.readJSON(`days/${d}/plan.json`, null).catch(() => null)));
  main.innerHTML = `<h1>Geçmiş</h1><div class="card">${dates.map((d, i) => `<div class="comp"><span><b>Gün ${esc(plans[i]?.day ?? '?')}</b> · ${esc(plans[i]?.title || '')}<br><span class="faint">${esc(fmtDate(d))} · ${esc(plans[i]?.ticket?.id || '')}</span></span><a class="btn small" href="#/gun/${d}">Aç</a></div>`).join('') || 'Henüz gün yok.'}</div>`;
};

ROUTES.gun = async (main, date, tab = 'geri') => {
  if (!date) { location.hash = '#/gecmis'; return; }
  const [plan, ticket, lesson, feedback, writing, pr, speaking, learn] = await Promise.all([
    gh.readJSON(`days/${date}/plan.json`, null), gh.readText(`days/${date}/ticket.md`), gh.readText(`days/${date}/lesson.md`),
    gh.readText(`days/${date}/feedback.md`), gh.readText(`days/${date}/submission/writing.md`), gh.readText(`days/${date}/submission/pr.md`),
    gh.readJSON(`days/${date}/submission/speaking.json`, null), gh.readText(`days/${date}/learn.md`),
  ]);
  const act = date === S.dayDate ? S.activity : await gh.readJSON(`days/${date}/submission/activity.json`, {});
  const lessonOpen = !(plan?.blocks || []).some((b) => b.kind === 'lesson' && b.unlock === 'after_ticket') || act?.blocks?.ticket?.done || date < S.dayDate;
  const panes = {
    geri: feedback ? md(feedback) : '<p class="muted">Değerlendirme bir sonraki sabah 07:00 (Pacific) rutininde yazılır.</p>',
    ogren: md(learn || '_yok_'),
    bilet: md(ticket || '_yok_'),
    ders: lessonOpen ? md(lesson || '_yok_') : '<p class="muted">🔒 Bilet teslim edilmeden açılmaz.</p>',
    teslim: `<h3>PR açıklaması</h3>${pr ? md(pr) : '<p class="muted">yok</p>'}<h3>Yazı</h3>${writing ? `<pre style="white-space:pre-wrap">${esc(writing.replace(/^<!--[\s\S]*?-->\n?/, ''))}</pre>` : '<p class="muted">yok</p>'}<h3>Konuşma dökümü</h3>${speaking ? `<p>${esc(speaking.transcript)}</p><p class="faint">${speaking.seconds} sn · ${speaking.wpm} wpm</p>` : '<p class="muted">yok</p>'}`,
  };
  main.innerHTML = `
    <div class="faint">${esc(fmtDate(date))}</div><h1>Gün ${esc(plan?.day ?? '?')} · ${esc(plan?.title || '')}</h1>
    <div class="tabs">${[['geri', 'Değerlendirme'], ['ogren', 'Öğren'], ['bilet', 'Bilet'], ['ders', 'Kapanış'], ['teslim', 'Teslimlerin']].map(([id, t]) => `<button data-t="${id}" class="${id === tab ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="card md" id="pane">${panes[tab] || panes.geri}</div>`;
  $$('.tabs button').forEach((b) => (b.onclick = () => { $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); $('#pane').innerHTML = panes[b.dataset.t]; }));
};

// ---------- AYARLAR ----------
ROUTES.ayarlar = async (main) => {
  const theme = (() => { try { return localStorage.getItem('usta.theme') || 'auto'; } catch { return 'auto'; } })();
  main.innerHTML = `
    <h1>Ayarlar</h1>
    <div class="card stack">
      <h2>Tekrar</h2>
      <div class="grid2">
        <div><label for="npd">Günlük yeni kart</label><input type="text" id="npd" inputmode="numeric" value="${S.srs.params.new_per_day}" /></div>
        <div><label for="ret">Hedef hatırlama (0.80-0.97)</label><input type="text" id="ret" inputmode="decimal" value="${S.srs.params.retention}" /></div>
      </div>
      <p class="faint">Hedef hatırlamayı yükseltmek unutmayı azaltır ama günlük tekrar yükünü artırır. 0.92 günde 1 saat için dengeli.</p>
      <div><button class="btn primary" id="sp">Kaydet</button></div>
    </div>
    <div class="card stack">
      <h2>Görünüm</h2>
      <div class="row">${['auto', 'light', 'dark'].map((t) => `<button class="btn ${t === theme ? 'primary' : ''}" data-theme="${t}">${({ auto: 'Sistem', light: 'Açık', dark: 'Koyu' })[t]}</button>`).join('')}</div>
    </div>
    <div class="card stack">
      <h2>Güvenlik</h2>
      <p class="muted">İçerik private <code>cgrtml/usta</code> deposunda. Bu sayfanın kaynağı herkese açık ama içinde veri yok; token olmadan hiçbir şey okunamaz.</p>
      <div class="row"><button class="btn" id="lock">Kilitle</button><button class="btn" id="forget">Bu cihazı unut</button><a class="btn ghost" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">Token'ları yönet ↗</a></div>
    </div>`;
  $('#sp').onclick = () => guard(async () => {
    const n = Math.max(0, Math.min(40, parseInt($('#npd').value, 10) || 8));
    const r = Math.max(0.8, Math.min(0.97, parseFloat($('#ret').value) || 0.92));
    S.srs.params.new_per_day = n; S.srs.params.retention = r;
    await gh.writeJSON('state/srs.json', S.srs, 'site: srs params');
  }, 'Kaydedildi');
  $$('[data-theme]').forEach((b) => (b.onclick = () => {
    const t = b.dataset.theme;
    try { t === 'auto' ? localStorage.removeItem('usta.theme') : localStorage.setItem('usta.theme', t); } catch { /* yoksay */ }
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    route();
  }));
  $('#lock').onclick = () => { gh.lock(); renderGate('pin'); };
  $('#forget').onclick = () => { if (confirm('Şifreli token bu cihazdan silinsin mi?')) { gh.forgetDevice(); renderGate('setup'); } };
};

// ---------- açılış ----------
async function boot() {
  $('#app').innerHTML = '<div class="gate"><p class="muted">Depodan yükleniyor…</p></div>';
  try { await load(); }
  catch (e) {
    $('#app').innerHTML = `<div class="gate"><div class="card stack"><h2>Yüklenemedi</h2><p class="err">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Yeniden dene</button></div></div>`;
    return;
  }
  renderShell();
  window.onhashchange = route;
  route();
}

if (gh.resumeSession()) boot();
else renderGate(gh.hasVault() ? 'pin' : 'setup');
