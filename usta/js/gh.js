// GitHub istemcisi + şifreli token kasası.
// İçerik bu public sitede DEĞİL, private repo cgrtml/usta içinde durur.
// Token yalnız bu tarayıcıda, PIN'den türetilen anahtarla AES-GCM şifreli saklanır.

export const OWNER = 'cgrtml';
export const REPO = 'usta';
export const BRANCH = 'main';
const API = 'https://api.github.com';
const VAULT_KEY = 'usta.vault.v1';
const SESSION_KEY = 'usta.session.v1';
const FAIL_KEY = 'usta.fails';

let token = null;

// ---------- kasa ----------
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function ls(op, key, val) {
  try {
    if (op === 'get') return localStorage.getItem(key);
    if (op === 'set') return localStorage.setItem(key, val);
    if (op === 'del') return localStorage.removeItem(key);
  } catch { return null; }
}
function ss(op, key, val) {
  try {
    if (op === 'get') return sessionStorage.getItem(key);
    if (op === 'set') return sessionStorage.setItem(key, val);
    if (op === 'del') return sessionStorage.removeItem(key);
  } catch { return null; }
}

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function hasVault() { return !!ls('get', VAULT_KEY); }

export async function saveVault(tok, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(tok));
  ls('set', VAULT_KEY, JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  ls('del', FAIL_KEY);
}

export async function openVault(pin) {
  const raw = ls('get', VAULT_KEY);
  if (!raw) throw new Error('Bu cihazda kayıtlı anahtar yok.');
  const v = JSON.parse(raw);
  try {
    const key = await deriveKey(pin, unb64(v.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct));
    ls('del', FAIL_KEY);
    return td.decode(pt);
  } catch {
    const fails = Number(ls('get', FAIL_KEY) || 0) + 1;
    ls('set', FAIL_KEY, String(fails));
    if (fails >= 6) { forgetDevice(); throw new Error('6 hatalı PIN. Kasa bu cihazdan silindi; token ile yeniden kur.'); }
    throw new Error(`PIN yanlış (${fails}/6).`);
  }
}

export function forgetDevice() { ls('del', VAULT_KEY); ls('del', FAIL_KEY); ss('del', SESSION_KEY); token = null; }
export function lock() { ss('del', SESSION_KEY); token = null; }
export function resumeSession() { const t = ss('get', SESSION_KEY); if (t) token = t; return !!t; }
export function setToken(t) { token = t; ss('set', SESSION_KEY, t); }

// ---------- API ----------
async function api(path, opts = {}) {
  if (!token) throw new Error('Kilitli.');
  const res = await fetch(API + path, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: opts.accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) { lock(); throw new Error('Token geçersiz ya da süresi dolmuş. Ayarlar > cihazı unut ile yeniden kur.'); }
  return res;
}

export async function verify(tok) {
  const prev = token; token = tok;
  try {
    const u = await api('/user');
    if (!u.ok) throw new Error('Token doğrulanamadı.');
    const me = await u.json();
    if (me.login !== OWNER) throw new Error(`Bu alan yalnız ${OWNER} içindir.`);
    const r = await api(`/repos/${OWNER}/${REPO}`);
    if (!r.ok) throw new Error(`Token ${OWNER}/${REPO} deposunu göremiyor. Repository access ayarını kontrol et.`);
    const repo = await r.json();
    if (repo.permissions && repo.permissions.push === false) throw new Error('Token yalnız okuma izinli; Contents: Read and write gerekli.');
    return me;
  } finally { token = prev; }
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

export async function readText(path) {
  const r = await api(`/repos/${OWNER}/${REPO}/contents/${enc(path)}?ref=${BRANCH}`, { accept: 'application/vnd.github.raw+json' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} okunamadı (${r.status})`);
  return r.text();
}

export async function readJSON(path, fallback = null) {
  const t = await readText(path);
  if (t == null) return fallback;
  try { return JSON.parse(t); } catch { throw new Error(`${path} geçerli JSON değil`); }
}

export async function listDir(path) {
  const r = await api(`/repos/${OWNER}/${REPO}/contents/${enc(path)}?ref=${BRANCH}`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`${path} listelenemedi (${r.status})`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function getSha(path) {
  const r = await api(`/repos/${OWNER}/${REPO}/contents/${enc(path)}?ref=${BRANCH}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} bilgisi alınamadı (${r.status})`);
  const j = await r.json();
  return j.sha;
}

function utf8b64(str) {
  const bytes = te.encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Yazmalar sıraya alınır; aynı dosyaya iki yazma çakışmasın.
let queue = Promise.resolve();
export function writeText(path, content, message) {
  const job = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = await getSha(path);
      const r = await api(`/repos/${OWNER}/${REPO}/contents/${enc(path)}`, {
        method: 'PUT',
        body: JSON.stringify({ message: message || `site: ${path}`, content: utf8b64(content), branch: BRANCH, ...(sha ? { sha } : {}) }),
      });
      if (r.ok) return true;
      if (r.status !== 409 && r.status !== 422) throw new Error(`${path} kaydedilemedi (${r.status})`);
    }
    throw new Error(`${path} kaydedilemedi (çakışma)`);
  });
  queue = job.catch(() => {});
  return job;
}

export const writeJSON = (path, obj, message) => writeText(path, JSON.stringify(obj, null, 2) + '\n', message);
