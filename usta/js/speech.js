// Konuşma: TTS (örnek telaffuz), konuşma tanıma (ne duyuldu), ses kaydı (kendini dinle), hizalama (hangi kelime kaçtı).

export const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const hasRecognition = !!SR;
export const hasTTS = 'speechSynthesis' in window;

let voices = [];
function loadVoices() { voices = hasTTS ? speechSynthesis.getVoices() : []; }
if (hasTTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function pickVoice() {
  const en = voices.filter((v) => /^en[-_]US/i.test(v.lang));
  const pref = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Alex', 'Ava', 'Allison'];
  for (const p of pref) { const v = en.find((x) => x.name.includes(p)); if (v) return v; }
  return en[0] || voices.find((v) => /^en/i.test(v.lang)) || null;
}

export function speak(text, rate = 1) {
  if (!hasTTS) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = 'en-US';
    u.rate = rate;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// Tanıma + eşzamanlı kayıt. stop() ile bitirilir; maxSeconds dolunca kendiliğinden biter.
export function listen({ continuous = false, maxSeconds = 15, onInterim } = {}) {
  let rec, recorder, stream, timer, chunks = [];
  let finalText = '';
  let base = '';
  let stopped = false;
  let resolveFn;
  const started = performance.now();
  const done = new Promise((res) => { resolveFn = res; });

  const finish = async (audioUrl) => {
    clearTimeout(timer);
    const seconds = (performance.now() - started) / 1000;
    resolveFn({ transcript: finalText.trim(), seconds, audioUrl });
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start();
    } catch { /* kayıt olmadan da tanıma çalışır */ }
    if (!SR) { finish(null); return; }
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = continuous;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      finalText = base;
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + ' '; else interim += t;
      }
      onInterim && onInterim((finalText + interim).trim());
    };
    rec.onerror = () => {};
    rec.onend = () => {
      if (continuous && performance.now() - started < maxSeconds * 1000 && !stopped) { base = finalText; try { rec.start(); return; } catch { /* yoksay */ } }
      stopAll();
    };
    rec.start();
    timer = setTimeout(() => stop(), maxSeconds * 1000);
  })();

  function stopAll() {
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        finish(chunks.length ? URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })) : null);
      };
      recorder.stop();
    } else { stream && stream.getTracks().forEach((t) => t.stop()); finish(null); }
  }
  function stop() { stopped = true; try { rec ? rec.stop() : stopAll(); } catch { stopAll(); } }
  return { stop, done };
}

// ---------- hizalama ----------
const NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const CONTR = { "it's": 'it is', "that's": 'that is', "i'm": 'i am', "we're": 'we are', "you're": 'you are', "they're": 'they are',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "won't": 'will not', "isn't": 'is not',
  "aren't": 'are not', "we'll": 'we will', "i'll": 'i will', "i've": 'i have', "we've": 'we have', "let's": 'let us', "there's": 'there is' };

export function words(s) {
  return s.toLowerCase().replace(/[’`]/g, "'").replace(/-/g, ' ')
    .split(/\s+/).map((w) => w.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')).filter(Boolean)
    .flatMap((w) => (CONTR[w] ? CONTR[w].split(' ') : [w]))
    .map((w) => NUM[w] || w);
}

// Hedef kelimelerin her birine ok/miss etiketi; LCS tabanlı.
export function align(target, heard) {
  const a = words(target), b = words(heard);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n) {
    if (j < m && a[i] === b[j]) { out.push({ w: a[i], ok: true }); i++; j++; }
    else if (j < m && dp[i][j + 1] >= dp[i + 1][j]) j++;
    else { out.push({ w: a[i], ok: false }); i++; }
  }
  const hits = out.filter((x) => x.ok).length;
  return { tokens: out, score: n ? hits / n : 0, missed: out.filter((x) => !x.ok).map((x) => x.w) };
}

const FILLERS = ['um', 'uh', 'er', 'ah', 'like', 'you know', 'i mean', 'basically', 'actually', 'so yeah', 'kind of', 'sort of'];
export function speechMetrics(transcript, seconds) {
  const w = words(transcript);
  const low = ' ' + w.join(' ') + ' ';
  const fillers = {};
  for (const f of FILLERS) {
    const c = low.split(' ' + f + ' ').length - 1;
    if (c) fillers[f] = c;
  }
  const uniq = new Set(w).size;
  return { words: w.length, wpm: seconds > 0 ? Math.round(w.length / (seconds / 60)) : 0, fillers, lexical_variety: w.length ? +(uniq / w.length).toFixed(2) : 0 };
}
