// Zusätzliche Header für alle API-Aufrufe (z. B. X-Guest-Id auf der Spielerseite)
const apiHeaders = {};

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: options.method || 'GET',
      headers: { ...apiHeaders, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // Keine Verbindung: Schreibzugriffe, die warten dürfen (z. B. Lernergebnisse), kommen in die Warteschlange und gehen später raus
    if (options.offlineQueue && typeof Outbox !== 'undefined') { await Outbox.add({ path, method: options.method || 'POST', body: options.body || null, user: window.__me && window.__me.username }); return { queued: true }; }
    const err = new Error('Keine Verbindung');
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.data = data;
    err.offline = Boolean(data.offline);
    throw err;
  }
  return data;
}

// Warteschlange für Schreibzugriffe ohne Verbindung (IndexedDB)
const Outbox = (() => {
  const open = () => new Promise((ok, fail) => {
    const r = indexedDB.open('quiz-outbox', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  const run = async (mode, fn) => { const db = await open(); return new Promise((ok, fail) => { const t = db.transaction('q', mode); const out = fn(t.objectStore('q')); t.oncomplete = () => ok(out && out.result); t.onerror = () => fail(t.error); }); };
  return {
    add: (item) => run('readwrite', (st) => st.add({ ...item, at: Date.now() })),
    all: () => run('readonly', (st) => st.getAll()),
    remove: (id) => run('readwrite', (st) => st.delete(id)),
    clear: () => run('readwrite', (st) => st.clear()),
    // Sendet wartende Einträge des angemeldeten Nutzers; stoppt bei fehlender Verbindung
    async flush() {
      if (!navigator.onLine || !window.__me) return 0;
      let sent = 0;
      for (const it of (await this.all().catch(() => [])) || []) {
        if (it.user && it.user !== window.__me.username) continue;
        try {
          const res = await fetch(it.path, { method: it.method, headers: { ...apiHeaders, ...(it.body ? { 'Content-Type': 'application/json' } : {}) }, body: it.body ? JSON.stringify(it.body) : undefined });
          if (res.status >= 500) break;          // Server-Problem: später noch einmal
          await this.remove(it.id);              // gesendet (oder dauerhaft abgelehnt, z. B. Karte gelöscht)
          sent += 1;
        } catch { break; }
      }
      return sent;
    },
  };
})();

// Leitet zur Anmeldung um, wenn niemand eingeloggt ist
async function requireLogin() {
  try {
    const me = await api('/api/auth/me');
    window.__me = me;   // für avatarHtml: eigenes Bild sofort nach dem Ändern anzeigen
    try { localStorage.setItem('me', JSON.stringify(me)); } catch { /* egal */ }
    Outbox.flush().catch(() => {});
    return me;
  } catch (err) {
    if (err.offline) {   // ohne Verbindung nicht zur Anmeldung schicken: mit dem zuletzt bekannten Konto weitermachen
      try { const saved = JSON.parse(localStorage.getItem('me') || 'null'); if (saved) { window.__me = saved; return saved; } } catch { /* egal */ }
    }
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/?next=${next}`;
    return new Promise(() => {});
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  // gespeicherte persönliche Daten (Offline-Speicher) entfernen
  try { for (const k of await caches.keys()) if (/^quiz-data-/.test(k)) await caches.delete(k); localStorage.removeItem('me'); localStorage.removeItem('offline:pins'); await Outbox.clear(); } catch { /* egal */ }
  location.href = '/';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function $(sel) { return document.querySelector(sel); }

// Hält einen Spielstand aktuell. load() holt den Stand von der API und gibt ihn zurück.
// Auslöser: Supabase-Realtime-Signal, Ablauf des Fragen-Timers und Polling als Rückfall.
function liveGame(pin, load, render) {
  let realtime = false;
  let running = false;
  let again = false;
  let timer = null;
  let offset = 0; // Uhrzeit-Differenz Server − Browser

  async function refresh() {
    if (running) { again = true; return; }
    running = true;
    try {
      const state = await load();
      if (state) apply(state);
    } catch (err) {
      console.warn(err);
    } finally {
      running = false;
      if (again) { again = false; refresh(); }
    }
  }

  // Neuen Stand anzeigen (auch für Antworten auf eigene Aktionen)
  function apply(state) {
    offset = state.serverNow - Date.now();
    clearTimeout(timer);
    // Kurz nach Ablauf der Frage neu laden, damit sie aufgelöst wird
    if (state.state === 'question') timer = setTimeout(refresh, remaining(state) * 1000 + 600);
    // Automatik: kurz nach dem nächsten automatischen Schritt neu laden
    else if (state.autoAt) timer = setTimeout(refresh, Math.max(0, state.autoAt - (Date.now() + offset)) + 500);
    render(state);
  }

  // Verbleibende Sekunden einer Frage, bereinigt um die Uhrzeit-Differenz
  function remaining(state) {
    return Math.max(0, (state.endsAt - (Date.now() + offset)) / 1000);
  }

  api('/api/config').then((cfg) => {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return;
    window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey)
      .channel(`game:${pin}`)
      .on('broadcast', { event: 'update' }, refresh)
      .subscribe((status) => {
        realtime = status === 'SUBSCRIBED';
        if (realtime) refresh();
      });
  }).catch(() => {});

  // Ohne Realtime alle 2 s nachsehen, mit Realtime nur alle 15 s zur Sicherheit
  let lastPoll = Date.now();
  setInterval(() => {
    if (Date.now() - lastPoll >= (realtime ? 15000 : 2000)) {
      lastPoll = Date.now();
      refresh();
    }
  }, 1000);

  refresh();
  return { refresh, apply, remaining };
}

// Runder Avatar mit dem Anfangsbuchstaben; die Farbe ergibt sich aus dem Namen
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#10b981,#06b6d4)', 'linear-gradient(135deg,#6366f1,#ec4899)',
  'linear-gradient(135deg,#3b82f6,#8b5cf6)', 'linear-gradient(135deg,#f43f5e,#fb923c)', 'linear-gradient(135deg,#14b8a6,#84cc16)',
];
function avatarHtml(name, size = '2rem') {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  // Foto liegt über dem Buchstaben; gibt es keins (404), verschwindet das <img> und der Buchstabe bleibt
  const mine = window.__me && String(window.__me.username).toLowerCase() === String(name).toLowerCase();
  const ver = mine && window.__me.avatarVer ? `?v=${window.__me.avatarVer}` : '';
  return `<span class="avatar" style="--size:${size};--avatar:${AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]}" aria-hidden="true">${escapeHtml(String(name).charAt(0).toUpperCase())}<img class="avatar-img" src="/api/avatar/${encodeURIComponent(name)}${ver}" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

// Schwebende Navigation am unteren Rand (Home, Quiz, Bestenliste, Profil) und Level-Anzeige in der Kopfzeile.
// me: Antwort von /api/auth/me (Name, Level)
// Name/Avatar als Link zum Spielerprofil (nur für registrierte Spieler, nicht für Gäste)
function profileLink(name, inner) {
  return `<a class="profile-link" href="/user?name=${encodeURIComponent(name)}">${inner}</a>`;
}

function mountNav(active, me) {
  document.body.classList.add('has-nav');
  const items = [
    { id: 'home', href: '/dashboard', label: 'Home', icon: '🏠' },
    { id: 'quizzes', href: '/quizzes', label: 'Quiz', icon: '❓' },
    { id: 'study', href: '/study', label: 'Lernen', icon: '📚' },
    { id: 'leaderboard', href: '/leaderboard', label: 'Bestenliste', icon: '🏅' },
    { id: 'profile', href: '/profile', label: 'Profil', icon: me ? avatarHtml(me.username, '1.7rem') : '👤' },
  ];
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Hauptnavigation');
  nav.innerHTML = items.map((item) => `
    <a href="${item.href}" ${item.id === active ? 'aria-current="page"' : ''}>
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span>${item.label}</span>
      ${item.id === 'study' && me && me.battleInvites ? `<span class="nav-dot" aria-label="${me.battleInvites} Herausforderungen">⚔️</span>` : ''}
      ${item.id === 'profile' && me && me.friendRequests ? `<span class="nav-dot" aria-label="${me.friendRequests} Freundschaftsanfragen">${me.friendRequests}</span>` : ''}
    </a>`).join('');
  document.body.appendChild(nav);

  if (typeof showChangelog === 'function') showChangelog();

  const box = document.getElementById('me');
  if (box && me) {
    box.innerHTML = `<span class="level-badge" title="${(me.xp ?? me.points).toLocaleString('de-DE')} Level-Punkte (Quiz ${me.points.toLocaleString('de-DE')} + Lernen ${(me.learnPoints || 0).toLocaleString('de-DE')})">🏅 Level ${me.level}</span>
      <span class="hide-small">${escapeHtml(me.username)}</span>`;
  }
  mountTheme();
}

// Verhindert, dass ein Eingabefeld von selbst den Fokus bekommt (und die Handy-Tastatur aufgeht):
// Das Feld ist schreibgeschützt, bis man es wirklich antippt oder per Tastatur dorthin springt.
function noAutoFocus(input) {
  if (!input) return;
  input.readOnly = true;
  const unlock = () => { input.readOnly = false; };
  input.addEventListener('pointerdown', unlock, { once: true });
  input.addEventListener('keydown', unlock, { once: true });
  input.addEventListener('focus', () => { if (input.readOnly && !input.matches(':focus-visible')) input.blur(); });
  window.addEventListener('pageshow', () => { if (document.activeElement === input && input.readOnly) input.blur(); });
}

// --- Hell/Dunkel-Schalter ---
// Standard: dem Gerät folgen. Wer den Schalter benutzt, legt sein Thema fest (gespeichert in localStorage).
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : themeQuery.matches;
}
// Statusleiste/Browserleiste bekommt die Farbe der Kopfleiste, damit dort kein Übergang (Verlauf) zu sehen ist
function applyThemeColor() {
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = isDark() ? '#1b1e38' : '#ffffff';
}
applyThemeColor();
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch {}
  applyThemeColor();
  document.querySelectorAll('.theme-switch').forEach(syncSwitch);
}
function syncSwitch(btn) {
  const dark = isDark();
  btn.setAttribute('aria-checked', String(dark));
  btn.title = dark ? 'Dunkel – tippen für hell' : 'Hell – tippen für dunkel';
  btn.querySelector('.knob').textContent = dark ? '🌙' : '☀️';
}
function mountTheme() {
  if (document.querySelector('.theme-switch')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-switch';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-label', 'Dunkler Modus');
  btn.innerHTML = '<span class="knob" aria-hidden="true"></span>';
  syncSwitch(btn);
  btn.onclick = () => setTheme(isDark() ? 'light' : 'dark');
  const me = document.getElementById('me');
  const header = document.querySelector('header.top');
  if (me) me.appendChild(btn);
  else if (header && header.lastElementChild) {
    // Rechts neben das vorhandene Element (z. B. „Abmelden“) setzen
    const last = header.lastElementChild;
    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.style.flexWrap = 'nowrap';
    last.replaceWith(wrap);
    wrap.append(last, btn);
  }
  themeQuery.addEventListener('change', () => document.querySelectorAll('.theme-switch').forEach(syncSwitch));
}

// Kein Zoomen per Zwei-Finger-Geste (auch in der installierten App): iOS ignoriert user-scalable=no teilweise, deshalb zusätzlich die
// Gesten abfangen. Doppeltippen-Zoom ist über touch-action (CSS) abgeschaltet; Tippen und Scrollen bleiben unberührt.
(() => {
  const stop = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
})();

// Passwortfelder bekommen ein Auge zum Ein-/Ausblenden (wird beim Absenden und beim Verlassen der Seite wieder verdeckt)
function addPasswordToggles(root = document) {
  const eye = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a17 17 0 0 1-3.2 4M6.4 6.6A17 17 0 0 0 1.5 12S5.5 19.5 12 19.5a10.6 10.6 0 0 0 4.2-.9"/><path d="M9.9 9.9a3.2 3.2 0 0 0 4.2 4.2"/></svg>';
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.closest('.pw-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Passwort anzeigen');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = eye;
    const set = (show) => {
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
      btn.innerHTML = show ? eyeOff : eye;
    };
    btn.addEventListener('click', () => { set(input.type === 'password'); input.focus({ preventScroll: true }); });
    if (input.form) input.form.addEventListener('submit', () => set(false));
    addEventListener('pagehide', () => set(false));
    wrap.appendChild(btn);
    // Feststelltaste (nur am PC): Hinweis unter dem Feld
    const hint = document.createElement('div');
    hint.className = 'caps-hint';
    hint.hidden = true;
    hint.textContent = '⇪ Feststelltaste ist aktiv';
    wrap.after(hint);
    const caps = (e) => { if (e.getModifierState) hint.hidden = !e.getModifierState('CapsLock'); };
    input.addEventListener('keydown', caps);
    input.addEventListener('keyup', caps);
    input.addEventListener('blur', () => { hint.hidden = true; });
  });
}
addPasswordToggles();


// --- Offline: Service Worker, Hinweisleiste, Vorladen ---
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(() => {
  let bar = null;
  const sync = () => {
    if (navigator.onLine) { if (bar) { bar.remove(); bar = null; } Outbox.flush().catch(() => {}); return; }
    if (bar || !document.body) return;
    bar = document.createElement('a');
    bar.href = '/offline';
    bar.textContent = '📴 Offline – nur Gespeichertes verfügbar';
    bar.style.cssText = 'position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 5.6rem);left:50%;transform:translateX(-50%);z-index:90;white-space:nowrap;background:#1b1d3a;color:#fff;padding:.3rem .8rem;border-radius:999px;font-size:.85rem;font-weight:700;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    document.body.appendChild(bar);
  };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  addEventListener('DOMContentLoaded', sync);
  // Vorgeladene Gesetze/Lernsets im Hintergrund aktuell halten (höchstens alle 6 Stunden)
  addEventListener('load', () => setTimeout(async () => {
    try {
      if (!navigator.onLine || !window.__me) return;
      const last = Number(localStorage.getItem('offline:refreshed')) || 0;
      if (Date.now() - last < 6 * 3600 * 1000) return;
      const pins = JSON.parse(localStorage.getItem('offline:pins') || '[]');
      for (const url of pins) await fetch(url, { cache: 'no-cache' }).catch(() => {});
      localStorage.setItem('offline:refreshed', String(Date.now()));
    } catch { /* egal */ }
  }, 4000));
})();
