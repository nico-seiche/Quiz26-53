// Zusätzliche Header für alle API-Aufrufe (z. B. X-Guest-Id auf der Spielerseite)
const apiHeaders = {};

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { ...apiHeaders, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

// Leitet zur Anmeldung um, wenn niemand eingeloggt ist
async function requireLogin() {
  try {
    return await api('/api/auth/me');
  } catch {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/?next=${next}`;
    return new Promise(() => {});
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
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
  return `<span class="avatar" style="--size:${size};--avatar:${AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]}" aria-hidden="true">${escapeHtml(String(name).charAt(0).toUpperCase())}</span>`;
}

// Schwebende Navigation am unteren Rand (Home, Quiz, Bestenliste, Profil) und Level-Anzeige in der Kopfzeile.
// me: Antwort von /api/auth/me (Name, Level)
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
    box.innerHTML = `<span class="level-badge" title="${me.points.toLocaleString('de-DE')} Punkte">🏅 Level ${me.level}</span>
      <span class="hide-small">${escapeHtml(me.username)}</span>`;
  }
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
