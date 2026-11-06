// Flyout-Menü am rechten Rand des Dokument-Editors: Werkzeuge, die Inhalte ins Dokument bringen.
// Erste Funktion: Gesetz einfügen – Paragraph aus den eigenen Gesetzen wählen, mit zwei Schiebereglern die Passage eingrenzen
// (nach Sätzen), dann als Zitat mit Quellenangabe in den Text setzen. Weitere Funktionen können als Eintrag in FEATURES dazukommen.
const DocsFlyout = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ----- Hilfen für Gesetzestext -----
  const ABBR = /(?:Abs|Nr|Nrn|Satz|Sätze|S|Buchst|Alt|vgl|bzw|ggf|Art|Anl|usw|ca|insb|Ziff|lit|Hs|u|d|z|i|v|m|f|ff|B|a|O|ä)$/;
  // Zeile in Sätze teilen, ohne bei Abkürzungen wie „Abs.“ oder „Nr.“ zu trennen
  function sentences(text) {
    const out = [];
    let start = 0;
    const re = /[.!?;:]\s+(?=[A-ZÄÖÜ(„"])/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(start, m.index);
      if (m[0][0] === '.' && (ABBR.test(before) || /\d$/.test(before) && /(?:Abs|Nr|S|Art|§)\.?\s*\d+[a-z]?$/.test(before))) continue;
      out.push(text.slice(start, m.index + 1));
      start = m.index + m[0].length;
    }
    if (start < text.length) out.push(text.slice(start));
    return out.filter((x) => x.trim());
  }
  // Absatz-Zeilen eines Paragraphen → Einheiten (Sätze) mit Zeile und Einrückung
  function unitsOf(par) {
    const units = [];
    par.text.forEach((raw, line) => {
      const depth = raw.length - raw.replace(/^\t+/, '').length;
      sentences(raw.slice(depth)).forEach((t, i) => units.push({ line, depth, text: t.trim(), first: i === 0 }));
    });
    return units;
  }
  // Auswahl a..b → Zeilen { text, depth }
  function pick(units, a, b, gaps) {
    const lines = [];
    for (let i = a; i <= b; i += 1) {
      const u = units[i];
      const last = lines[lines.length - 1];
      if (last && last.line === u.line) last.text += ` ${u.text}`;
      else lines.push({ line: u.line, depth: u.depth, text: u.text });
    }
    if (gaps && lines.length) {
      if (a > 0) lines[0].text = `[…] ${lines[0].text}`;
      if (b < units.length - 1) lines[lines.length - 1].text += ' […]';
    }
    return lines;
  }

  function mount(quill, { getRange }) {
    const Delta = Quill.import('delta');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flyout-btn';
    btn.setAttribute('aria-label', 'Werkzeuge öffnen');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Werkzeuge';
    btn.textContent = '‹';
    const panel = document.createElement('aside');
    panel.className = 'flyout';
    panel.setAttribute('aria-label', 'Werkzeuge');
    panel.innerHTML = '<div class="fly-head"><button type="button" class="fly-back" hidden aria-label="Zurück">←</button><strong id="fly-title">Werkzeuge</strong><button type="button" class="fly-close" aria-label="Schließen">✕</button></div><div class="fly-body" id="fly-body"></div>';
    document.body.append(btn, panel);
    const body = panel.querySelector('#fly-body');
    const title = panel.querySelector('#fly-title');
    const back = panel.querySelector('.fly-back');

    const FEATURES = [
      { id: 'law', icon: '⚖️', name: 'Gesetz einfügen', desc: 'Paragraph aus deinen Gesetzen als Zitat in den Text setzen', open: lawPicker },
    ];
    function menu() {
      title.textContent = 'Werkzeuge'; back.hidden = true;
      body.innerHTML = FEATURES.map((f) => `<button type="button" class="fly-item" data-f="${f.id}"><span class="fi">${f.icon}</span><span><strong>${f.name}</strong><small>${f.desc}</small></span></button>`).join('')
        + '<p class="muted" style="margin:.8rem .2rem 0;font-size:.88rem">Weitere Funktionen folgen.</p>';
    }
    body.addEventListener('click', (e) => { const it = e.target.closest('[data-f]'); if (it) FEATURES.find((f) => f.id === it.dataset.f).open(); });
    back.onclick = menu;
    const setOpen = (on) => { panel.classList.toggle('open', on); btn.classList.toggle('open', on); btn.textContent = on ? '›' : '‹'; btn.setAttribute('aria-expanded', String(on)); if (on) menu(); };
    btn.onclick = () => setOpen(!panel.classList.contains('open'));
    panel.querySelector('.fly-close').onclick = () => setOpen(false);
    // Knöpfe nehmen dem Text nicht den Fokus (Cursorstelle bleibt erhalten)
    btn.addEventListener('pointerdown', (e) => e.preventDefault());

    // ===== Gesetz einfügen =====
    const cache = {};
    let laws = [];
    async function loadLaws() {
      if (laws.length) return laws;
      const [all, prefs] = await Promise.all([api('/api/gesetze'), api('/api/gesetze/prefs/me').catch(() => ({ hidden: [], order: [] }))]);
      const rank = (l) => { const i = prefs.order.indexOf(l.slug); return i < 0 ? 1000 + all.indexOf(l) : i; };
      laws = all.filter((l) => !prefs.hidden.includes(l.slug)).sort((a, b) => rank(a) - rank(b));
      return laws;
    }
    async function lawData(slug) { if (!cache[slug]) cache[slug] = await api(`/api/gesetze/${slug}`); return cache[slug]; }

    // Schritt 1: Gesetz und Paragraph wählen (die Liste füllt den Rest des Menüs)
    async function lawPicker() {
      title.textContent = '⚖️ Gesetz einfügen'; back.hidden = false;
      back.onclick = menu;
      body.innerHTML = '<p class="muted">Lädt …</p>';
      let list;
      try { list = await loadLaws(); } catch (err) { body.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
      if (!list.length) { body.innerHTML = '<p class="muted">Du hast alle Gesetze ausgeblendet. Unter Gesetze → „⚙️ Bibliothek“ kannst du sie wieder einblenden.</p>'; return; }
      body.innerHTML = `<select id="fl-law" aria-label="Gesetz">${list.map((l) => `<option value="${l.slug}">${esc(l.short)} – ${esc(l.title)}</option>`).join('')}</select>
        <input type="text" id="fl-q" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paragraph suchen: Nummer oder Stichwort" aria-label="Paragraph suchen" style="margin-top:.5rem">
        <div id="fl-list" class="fl-list"></div>`;
      const sel = body.querySelector('#fl-law');
      const q = body.querySelector('#fl-q');
      let law = null;
      async function setLaw() {
        body.querySelector('#fl-list').innerHTML = '<p class="muted" style="padding:.6rem">Lädt …</p>';
        try { law = await lawData(sel.value); } catch (err) { body.querySelector('#fl-list').innerHTML = `<p class="error" style="padding:.6rem">${esc(err.message)}</p>`; return; }
        showList();
      }
      function showList() {
        const term = q.value.trim().toLowerCase().replace(/^(§|art\.?)\s*/, '');
        const pars = law.items.filter((i) => i.type === 'par');
        const unit = law.unit || '§';
        const hits = (term ? pars.filter((p) => p.num.toLowerCase().startsWith(term) || (p.title || '').toLowerCase().includes(term) || (p.text[0] || '').toLowerCase().includes(term)) : pars).slice(0, 80);
        body.querySelector('#fl-list').innerHTML = hits.length ? hits.map((p) => `<button type="button" class="fl-row" data-num="${esc(p.num)}"><b>${esc(unit)} ${esc(p.num)}</b> ${esc(p.title || (p.text[0] || '').slice(0, 50))}</button>`).join('') + (hits.length === 80 ? '<p class="muted" style="margin:.4rem .7rem">Weitere Treffer – Suche eingrenzen.</p>' : '') : '<p class="muted" style="padding:.6rem">Nichts gefunden.</p>';
      }
      sel.onchange = setLaw;
      q.oninput = () => law && showList();
      body.querySelector('#fl-list').onclick = (e) => { const r = e.target.closest('[data-num]'); if (r) passage(law, law.items.find((i) => i.type === 'par' && i.num === r.dataset.num)); };
      setLaw();
    }

    // Schritt 2: Passage mit zwei Reglern wählen (eigener Regler: zwei Griffe, die man auf dem iPad auch wirklich ziehen kann)
    function passage(law, par) {
      const unit = law.unit || '§';
      const units = unitsOf(par);
      const n = units.length;
      let a = 0; let b = n - 1;
      title.textContent = `${unit} ${par.num} ${law.short}`;
      back.hidden = false;
      back.onclick = lawPicker;
      body.innerHTML = `<div class="fl-sel-head">${esc(par.title || law.title)}</div>
        ${n > 1 ? `<div class="fl-range"><div class="fl-rail" id="fl-rail"><div class="fl-track"><span id="fl-fill"></span></div><button type="button" class="fl-h" id="fl-ha" aria-label="Von Satz"></button><button type="button" class="fl-h" id="fl-hb" aria-label="Bis Satz"></button></div></div>
        <div class="muted" id="fl-count" style="font-size:.85rem;margin:0 0 .4rem"></div>` : ''}
        <div id="fl-prev" class="fl-prev"></div>
        <div class="fl-opts">
          <label class="inline-check"><input type="checkbox" id="fl-head" checked> Überschrift</label>
          <label class="inline-check"><input type="checkbox" id="fl-quote" checked> Als Zitat</label>
          <label class="inline-check"><input type="checkbox" id="fl-src" checked> Quelle</label>
          <label class="inline-check"><input type="checkbox" id="fl-gaps" checked> […] Auslassung</label>
        </div>
        <button type="button" class="primary" id="fl-ins" style="margin-top:.5rem;width:100%">In das Dokument einfügen</button>`;
      const $$ = (id) => body.querySelector(id);
      const pct = (i) => (n > 1 ? (i / (n - 1)) * 100 : 0);
      function render() {
        const lines = pick(units, a, b, $$('#fl-gaps').checked);
        let html = '';
        units.forEach((u, i) => {
          if (u.first) html += `${html ? '</div>' : ''}<div style="margin-left:${Math.min(u.depth, 3) * 1.1}rem">`;
          html += `<span class="${i >= a && i <= b ? 'fl-on' : 'fl-off'}" data-u="${i}">${esc(u.text)}</span> `;
        });
        $$('#fl-prev').innerHTML = html + (html ? '</div>' : '');
        if (n > 1) {
          $$('#fl-count').textContent = `Sätze ${a + 1} bis ${b + 1} von ${n} · ${lines.reduce((t, l) => t + l.text.length, 0)} Zeichen`;
          $$('#fl-ha').style.left = `${pct(a)}%`; $$('#fl-hb').style.left = `${pct(b)}%`;
          $$('#fl-fill').style.left = `${pct(a)}%`; $$('#fl-fill').style.right = `${100 - pct(b)}%`;
        }
      }
      if (n > 1) {
        const rail = $$('#fl-rail');
        const idxAt = (clientX) => { const r = rail.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))); };
        const setA = (i) => { a = Math.min(i, b); render(); };
        const setB = (i) => { b = Math.max(i, a); render(); };
        for (const [el, set, cur] of [[$$('#fl-ha'), setA, () => a], [$$('#fl-hb'), setB, () => b]]) {
          el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); });
          el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(idxAt(e.clientX)); });
          const end = (e) => { el.classList.remove('drag'); try { el.releasePointerCapture(e.pointerId); } catch { /* egal */ } };
          el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
          el.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0; if (d) { e.preventDefault(); set(cur() + d); el.focus(); } });
        }
        // Tipp auf die Schiene: der nähere Griff springt dorthin
        rail.addEventListener('pointerdown', (e) => { if (e.target.closest('.fl-h')) return; const i = idxAt(e.clientX); if (Math.abs(i - a) <= Math.abs(i - b)) setA(i); else setB(i); });
        // Tipp auf einen Satz in der Vorschau: außerhalb → Auswahl erweitern, innerhalb → Anfang/Ende dorthin
        $$('#fl-prev').addEventListener('click', (e) => { const sp = e.target.closest('[data-u]'); if (!sp) return; const i = Number(sp.dataset.u); if (i < a) a = i; else if (i > b) b = i; else if (i - a <= b - i) a = i; else b = i; render(); });
      }
      $$('#fl-gaps').onchange = render;
      render();
      $$('#fl-ins').onclick = () => {
        insert({ law, par, unit, lines: pick(units, a, b, $$('#fl-gaps').checked), head: $$('#fl-head').checked, quote: $$('#fl-quote').checked, src: $$('#fl-src').checked });
        back.onclick = menu;
        setOpen(false);
      };
    }

    function insert({ law, par, unit, lines, head, quote, src }) {
      const r = getRange();
      let at = r ? r.index + r.length : Math.max(0, quill.getLength() - 1);
      const label = `${unit} ${par.num} ${law.short}`;
      const d = new Delta().retain(at);
      const [line, off] = quill.getLine(at);
      if (line && off > 0) d.insert('\n');                      // mitten in einer Zeile: neuer Absatz
      if (head) d.insert(`${label}${par.title ? ` – ${par.title}` : ''}`, { bold: true }).insert('\n');
      for (const l of lines) {
        for (const part of l.text.split('\n').map((x) => x.trim()).filter(Boolean)) {     // Zeilenumbrüche im Gesetzestext (Aufzählungen) bleiben eigene Zeilen
          d.insert(part).insert('\n', { ...(quote ? { blockquote: true } : {}), ...(l.depth ? { indent: Math.min(l.depth, 4) } : {}) });
        }
      }
      if (src) d.insert(`Quelle: ${label}${law.version ? ` (${law.version.replace(/ – .*/, '')})` : law.validFrom ? ` (gültig ab ${law.validFrom})` : ''}`, { italic: true, color: '#667085', size: '14px' }).insert('\n');
      quill.updateContents(d, 'user');
      const added = d.length() - at;
      quill.setSelection(at + added, 0, 'silent');
    }
    return { open: () => setOpen(true), close: () => setOpen(false) };
  }
  return { mount };
})();
