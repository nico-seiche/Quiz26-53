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

// Schwebende Navigation am unteren Rand (Home, Quizze, Bestenliste, Profil)
const NAV_ITEMS = [
  { id: 'home', href: '/dashboard', label: 'Home',
    icon: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  { id: 'quizzes', href: '/quizzes', label: 'Quizze',
    icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
  { id: 'leaderboard', href: '/leaderboard', label: 'Bestenliste',
    icon: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>' },
  { id: 'profile', href: '/profile', label: 'Profil',
    icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>' },
];

function mountNav(active) {
  document.body.classList.add('has-nav');
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Hauptnavigation');
  nav.innerHTML = NAV_ITEMS.map((item) => `
    <a href="${item.href}" ${item.id === active ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg>
      <span>${item.label}</span>
    </a>`).join('');
  document.body.appendChild(nav);
}
