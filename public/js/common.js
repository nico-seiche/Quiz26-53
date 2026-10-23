async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
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
