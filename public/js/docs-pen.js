// Freie Handschrift über dem ganzen Dokument (Apple Pencil): Mit dem Stift schreibt und zeichnet man überall auf dem Blatt,
// der Finger scrollt weiter ganz normal – oder, im „Schreibmodus“, gar nicht (Handballen-Schutz).
//
// Unterscheidung Stift/Finger: Pointer-Events (pointerType "pen" / "touch"); auf dem iPad kommt dazu Touch.touchType
// ("stylus" / "direct"): Nur so lässt sich das Scrollen für den Stift abstellen, ohne es dem Finger zu nehmen
// (touchstart.preventDefault für Stift-Berührungen).
//
// Verankerung: Jeder Strich hängt an einer Zeile des Textes (a = Zeichenposition ihres Anfangs, wird bei jeder Textänderung
// mitgerechnet; y ab Oberkante dieser Zeile). Schreibt man oben Text dazu, wandert die Handschrift mit. x ist in Tausendstel der Blattbreite.
const DocsPen = (() => {
  const UNITS = 1000;
  const TILE = 1000;                                  // Höhe einer Zeichenfläche in px (iPad-Canvas sind in der Größe begrenzt)
  const COLORS = ['#1b1d3a', '#2563eb', '#e11d48', '#16a34a', '#f59e0b'];
  const WIDTHS = [1.2, 2.4, 5];                       // Einheiten (Tausendstel der Blattbreite)
  const MARKER_ALPHA = 0.35;

  // Gemeinsamer Zustand aller Blätter einer Seite (Werkzeug, Farbe …) und die eine Stiftleiste
  const ui = { tool: 'text', color: COLORS[0], widthIdx: 1, lock: false, visible: true, open: false, bar: null, active: null };

  function ensureBar() {
    if (ui.bar) return ui.bar;
    const bar = document.createElement('div');
    bar.className = 'pen-bar';
    bar.hidden = true;
    bar.innerHTML = `
      <div class="pen-row">
        <button type="button" data-tool="text" title="Text schreiben und markieren (Stift wie Finger)">🔤 Text</button>
        <button type="button" data-tool="pen" title="Stift">✏️ Stift</button>
        <button type="button" data-tool="marker" title="Textmarker">🖍️ Marker</button>
        <button type="button" data-tool="eraser" title="Radierer: wischt ganze Striche weg">⌫ Radierer</button>
        <span class="pen-sep"></span>
        ${COLORS.map((c) => `<button type="button" class="pen-color" data-color="${c}" style="background:${c}" aria-label="Farbe"></button>`).join('')}
        <span class="pen-sep"></span>
        ${WIDTHS.map((w, i) => `<button type="button" class="pen-width" data-width="${i}" aria-label="Strichstärke ${i + 1}"><i style="width:${6 + i * 4}px;height:${6 + i * 4}px"></i></button>`).join('')}
        <span class="pen-sep"></span>
        <button type="button" data-act="undo" title="Rückgängig (Handschrift)">↶</button>
        <button type="button" data-act="redo" title="Wiederholen (Handschrift)">↷</button>
        <button type="button" data-act="lock" title="Schreibmodus: der Finger scrollt und tippt nicht mehr – nur der Stift wirkt">🔒 Schreibmodus</button>
        <button type="button" data-act="visible" title="Handschrift ein-/ausblenden">👁</button>
        <button type="button" data-act="clear" title="Alle Handschrift löschen">🗑</button>
      </div>`;
    document.body.appendChild(bar);
    bar.addEventListener('pointerdown', (e) => e.preventDefault());       // Auswahl im Text bleibt
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = ui.active;
      if (b.dataset.tool) setTool(b.dataset.tool);
      else if (b.dataset.color) { ui.color = b.dataset.color; if (ui.tool === 'text' || ui.tool === 'eraser') setTool('pen'); }
      else if (b.dataset.width) ui.widthIdx = Number(b.dataset.width);
      else if (b.dataset.act === 'undo') act && act.undo();
      else if (b.dataset.act === 'redo') act && act.redo();
      else if (b.dataset.act === 'lock') { ui.lock = !ui.lock; if (ui.lock && ui.tool === 'text') ui.tool = 'pen'; }
      else if (b.dataset.act === 'visible') { ui.visible = !ui.visible; act && act.applyVisible(); }
      else if (b.dataset.act === 'clear') { if (act && confirm('Die gesamte Handschrift hier löschen?')) act.clearAll(); }
      refreshUi();
    });
    ui.bar = bar;
    return bar;
  }
  function setTool(t) { ui.tool = t; if (t === 'text') ui.lock = false; refreshUi(); }
  function refreshUi() {
    const bar = ensureBar();
    bar.hidden = !ui.open;
    bar.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === ui.tool)));
    bar.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === ui.color && ui.tool !== 'text' && ui.tool !== 'eraser')));
    bar.querySelectorAll('[data-width]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.width) === ui.widthIdx)));
    bar.querySelector('[data-act="lock"]').setAttribute('aria-pressed', String(ui.lock));
    bar.querySelector('[data-act="visible"]').setAttribute('aria-pressed', String(!ui.visible));
    const a = ui.active;
    bar.querySelector('[data-act="undo"]').disabled = !(a && a.canUndo());
    bar.querySelector('[data-act="redo"]').disabled = !(a && a.canRedo());
    if (a) { const on = ui.open && ui.tool !== 'text'; a.paper.classList.toggle('pen-active', on); a.paper.classList.toggle('pen-lock', on && ui.lock); }
  }
  function openBar(on) { ui.open = on; if (on && ui.tool === 'text') ui.tool = 'pen'; if (!on) { ui.tool = 'text'; ui.lock = false; } refreshUi(); }

  // adapter: { paper, measure() → { idx: [Anker …], top: [px …] }, subscribe(fn) – fn(delta | null) bei Textänderung, observe: [Elemente] }
  function create(adapter, { initial = [], onChange = () => {} } = {}) {
    const { paper } = adapter;
    if (getComputedStyle(paper).position === 'static') paper.style.position = 'relative';
    const layer = document.createElement('div');
    layer.className = 'pen-layer';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;pointer-events:none;z-index:3;overflow:hidden';
    paper.appendChild(layer);
    const ctl = new AbortController();
    const sig = { signal: ctl.signal };

    let strokes = Array.isArray(initial) ? initial.map((s) => ({ ...s })) : [];
    const undoStack = [];
    const redoStack = [];
    let lines = { idx: [], top: [] };                 // Zeilenanfänge (Anker) und ihre Höhe im Blatt
    let current = null;                               // laufender Strich { s, id, top }
    let erasing = null;
    let raf = 0;
    const tool = () => ui.tool;
    const lock = () => ui.lock;

    // ---------- Geometrie ----------
    const width = () => paper.clientWidth || 1;
    const k = () => width() / UNITS;
    function measureLines() { lines = adapter.measure(); }
    function topOfAnchor(a) {                         // Höhe der Zeile, die zur Textposition a gehört
      const { idx, top } = lines;
      if (!idx.length) return 0;
      let lo = 0; let hi = idx.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= a) lo = mid; else hi = mid - 1; }
      return top[lo];
    }
    function anchorAt(yPx) {                          // Zeile direkt über/an der Höhe yPx
      const { idx, top } = lines;
      if (!idx.length) return { a: 0, top: 0 };
      let lo = 0; let hi = top.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (top[mid] <= yPx) lo = mid; else hi = mid - 1; }
      return { a: idx[lo], top: top[lo] };
    }

    // ---------- Zeichnen ----------
    const tiles = [];
    function ensureTiles(host, hostTiles, height, dpr, w) {
      const n = Math.max(1, Math.ceil(height / TILE));
      while (hostTiles.length < n) {
        const c = document.createElement('canvas');
        c.style.cssText = 'position:absolute;left:0;display:block';
        host.appendChild(c);
        hostTiles.push(c);
      }
      while (hostTiles.length > n) hostTiles.pop().remove();
      hostTiles.forEach((c, i) => {
        const h = Math.min(TILE, height - i * TILE);
        const cw = Math.round(w * dpr); const ch = Math.max(1, Math.round(h * dpr));
        if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
        c.style.top = `${i * TILE}px`; c.style.width = `${w}px`; c.style.height = `${h}px`;
      });
    }
    // Absolute Pixelpunkte eines Strichs (Blatt-Koordinaten)
    function absPoints(s, kk) {
      const t = topOfAnchor(s.a);
      return s.p.map(([x, y, pr]) => [x * kk, t + y * kk, pr]);
    }
    function strokeSpan(s, kk) {
      if (!s._span || s._spanK !== kk || s._spanA !== s.a) {
        let lo = Infinity; let hi = -Infinity;
        for (const pt of s.p) { if (pt[1] < lo) lo = pt[1]; if (pt[1] > hi) hi = pt[1]; }
        const t = topOfAnchor(s.a);
        const pad = s.w * kk * 1.5 + 4;
        s._span = [t + lo * kk - pad, t + hi * kk + pad]; s._spanK = kk; s._spanA = s.a;
      }
      return s._span;
    }
    const widthAt = (s, kk, pr) => (s.k === 'h' ? s.w * kk * 3.5 : s.w * kk * (0.35 + 1.3 * pr));
    function paintStroke(ctx, s, kk) {
      const pts = absPoints(s, kk);
      ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
      ctx.lineCap = s.k === 'h' ? 'butt' : 'round'; ctx.lineJoin = 'round';
      if (s.k === 'h') {                              // Marker: ein Pfad, einheitlich durchscheinend
        ctx.globalAlpha = MARKER_ALPHA; ctx.lineWidth = widthAt(s, kk, 1);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
        ctx.stroke(); ctx.globalAlpha = 1;
        return;
      }
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], widthAt(s, kk, pts[0][2]) / 2, 0, Math.PI * 2); ctx.fill(); return; }
      for (let i = 1; i < pts.length; i += 1) paintSegment(ctx, pts, i, s, kk);
    }
    function paintSegment(ctx, pts, i, s, kk) {       // weiche Kurve über Mittelpunkte, Breite nach Druck
      const prev = pts[i - 1]; const cur = pts[i];
      const a = i === 1 ? prev : [(pts[i - 2][0] + prev[0]) / 2, (pts[i - 2][1] + prev[1]) / 2];
      const b = i === pts.length - 1 ? cur : [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2];
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(prev[0], prev[1], b[0], b[1]);
      ctx.lineWidth = widthAt(s, kk, (prev[2] + cur[2]) / 2); ctx.stroke();
    }
    // Alle Striche in die Zeichenflächen eines Containers malen (Blattbreite w, Höhe h)
    function paintAll(host, hostTiles, w, h, dpr, only) {
      ensureTiles(host, hostTiles, h, dpr, w);
      const kk = w / UNITS;
      hostTiles.forEach((c, i) => {
        if (only && !only.has(i)) return;
        const ctx = c.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, -i * TILE * dpr);
        const y0 = i * TILE; const y1 = y0 + TILE;
        for (const s of strokes) { const [lo, hi] = strokeSpan(s, kk); if (hi >= y0 && lo <= y1) paintStroke(ctx, s, kk); }
      });
    }
    function redraw(only) {
      measureLines();
      const h = Math.max(paper.scrollHeight, paper.clientHeight);
      layer.style.height = `${h}px`;
      strokes.forEach((s) => { s._span = null; });
      paintAll(layer, tiles, width(), h, Math.min(window.devicePixelRatio || 1, 2), only);
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); }
    function tilesOf(s) {
      const set = new Set(); const [lo, hi] = strokeSpan(s, k());
      for (let i = Math.max(0, Math.floor(lo / TILE)); i <= Math.floor(hi / TILE) && i < tiles.length; i += 1) set.add(i);
      return set;
    }

    // ---------- Eingabe ----------
    const drawing = () => ui.open && ui.tool !== 'text' && ui.active === inst;
    function point(e) {
      const r = paper.getBoundingClientRect();
      return { x: (e.clientX - r.left) / k(), y: e.clientY - r.top };
    }
    function pressure(e) { return e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5; }
    function down(e) {
      if (!drawing()) return;
      if (e.pointerType === 'touch') { if (ui.lock) e.preventDefault(); return; }   // Finger: scrollt/tippt normal – außer im Schreibmodus
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { paper.setPointerCapture(e.pointerId); } catch { /* egal */ }
      measureLines();
      const p = point(e);
      if (ui.tool === 'eraser') { erasing = { id: e.pointerId, removed: [] }; erase(p); return; }
      const an = anchorAt(p.y);
      const s = { c: ui.color, w: ui.tool === 'marker' ? WIDTHS[ui.widthIdx] * 1.6 : WIDTHS[ui.widthIdx], k: ui.tool === 'marker' ? 'h' : 'p', a: an.a, p: [[p.x, (p.y - an.top) / k(), pressure(e)]] };
      strokes.push(s);
      current = { s, id: e.pointerId, top: an.top, last: 0 };
      liveDraw(s);
    }
    function move(e) {
      if (erasing && e.pointerId === erasing.id) { e.preventDefault(); for (const ev of coalesced(e)) erase(point(ev)); return; }
      if (!current || e.pointerId !== current.id) return;
      e.preventDefault();
      const s = current.s;
      for (const ev of coalesced(e)) {
        const p = point(ev);
        const last = s.p[s.p.length - 1];
        const ny = (p.y - current.top) / k();
        if (Math.hypot(last[0] - p.x, last[1] - ny) < 0.5) continue;
        s.p.push([p.x, ny, pressure(ev)]);
      }
      liveDraw(s);
    }
    const coalesced = (e) => { const list = e.getCoalescedEvents ? e.getCoalescedEvents() : []; return list.length ? list : [e]; };
    function up(e) {
      if (erasing && e.pointerId === erasing.id) {
        if (erasing.removed.length) { pushUndo({ del: erasing.removed }); emit(); }
        erasing = null; return;
      }
      if (!current || e.pointerId !== current.id) return;
      const s = current.s;
      current = null;
      if (s.p.length > 700) s.p = s.p.filter((_, i, a) => i % 2 === 0 || i === a.length - 1);   // sehr lange Striche ausdünnen
      pushUndo({ add: s });
      redraw(tilesOf(s));
      emit();
    }
    // Während des Schreibens nur das neueste Stück malen (Marker: die betroffenen Flächen neu)
    function liveDraw(s) {
      const kk = k();
      s._span = null;
      if (s.k === 'h' || s.p.length < 3) { redrawTiles(tilesOf(s)); return; }
      const pts = absPoints(s, kk);
      const i = pts.length - 1;
      for (let t = 0; t < tiles.length; t += 1) {
        const y0 = t * TILE;
        const ys = pts.slice(Math.max(0, i - 2)).map((q) => q[1]);
        if (Math.max(...ys) + s.w * kk * 2 < y0 || Math.min(...ys) - s.w * kk * 2 > y0 + TILE) continue;
        const ctx = tiles[t].getContext('2d');
        const dpr = tiles[t].width / width();
        ctx.setTransform(dpr, 0, 0, dpr, 0, -y0 * dpr);
        ctx.strokeStyle = s.c;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        paintSegment(ctx, pts, i, s, kk);
      }
    }
    function redrawTiles(only) {
      const h = Math.max(paper.scrollHeight, paper.clientHeight);
      paintAll(layer, tiles, width(), h, Math.min(window.devicePixelRatio || 1, 2), only);
    }
    function erase(p) {
      const kk = k();
      const R = 9 + 2;
      const hit = strokes.filter((s) => {
        const [lo, hi] = strokeSpan(s, kk);
        if (p.y < lo - R || p.y > hi + R) return false;
        const pts = absPoints(s, kk);
        return pts.some((q) => Math.hypot(q[0] - p.x * kk, q[1] - p.y) < R + s.w * kk);
      });
      if (!hit.length) return;
      const set = new Set();
      for (const s of hit) { tilesOf(s).forEach((i) => set.add(i)); strokes.splice(strokes.indexOf(s), 1); erasing.removed.push(s); }
      redraw(set);
    }

    // ---------- Rückgängig ----------
    function pushUndo(op) { undoStack.push(op); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; if (ui.active === inst) refreshUi(); }
    function apply(op, inverse) {
      const add = (list) => { strokes.push(...list); };
      const del = (list) => { list.forEach((s) => { const i = strokes.indexOf(s); if (i >= 0) strokes.splice(i, 1); }); };
      if (op.add) (inverse ? del : add)([op.add]);
      if (op.del) (inverse ? add : del)(op.del);
    }
    function undo() { const op = undoStack.pop(); if (!op) return; apply(op, true); redoStack.push(op); redraw(); emit(); if (ui.active === inst) refreshUi(); }
    function redo() { const op = redoStack.pop(); if (!op) return; apply(op, false); undoStack.push(op); redraw(); emit(); if (ui.active === inst) refreshUi(); }
    function clearAll() { if (!strokes.length) return; pushUndo({ del: [...strokes] }); strokes = []; redraw(); emit(); }

    // ---------- Texteditor: Anker mitrechnen ----------
    adapter.subscribe((delta) => {
      if (delta && strokes.length) {
        let moved = false;
        for (const s of strokes) { const a = delta.transformPosition(s.a); if (a !== s.a) { s.a = a; moved = true; } }
        if (moved) emit();      // Anker haben sich verschoben → auch die Handschrift neu speichern
      }
      schedule();
    });
    if (window.ResizeObserver) { const ro = new ResizeObserver(schedule); (adapter.observe || [paper]).forEach((el) => ro.observe(el)); ctl.signal.addEventListener('abort', () => ro.disconnect()); }
    window.addEventListener('resize', schedule, sig);

    // ---------- Ereignisse am Blatt ----------
    paper.addEventListener('pointerdown', down, { capture: true, ...sig });
    paper.addEventListener('pointermove', move, { capture: true, ...sig });
    paper.addEventListener('pointerup', up, { capture: true, ...sig });
    paper.addEventListener('pointercancel', up, { capture: true, ...sig });
    // iPad: Stift-Berührungen dürfen die Seite nicht scrollen; Finger-Berührungen nur im Schreibmodus nicht
    const touchGuard = (e) => {
      if (!drawing()) return;
      for (const t of e.changedTouches) {
        if (t.touchType === 'stylus' || (ui.lock && t.touchType !== 'stylus')) { e.preventDefault(); return; }
      }
    };
    paper.addEventListener('touchstart', touchGuard, { passive: false, capture: true, ...sig });
    paper.addEventListener('touchmove', touchGuard, { passive: false, capture: true, ...sig });
    paper.addEventListener('selectstart', (e) => { if (current || erasing) e.preventDefault(); }, sig);
    paper.addEventListener('contextmenu', (e) => { if (drawing() && e.pointerType !== 'touch') e.preventDefault(); }, sig);

    function emit() { onChange(strokes); }
    function applyVisible() { layer.style.display = ui.visible ? '' : 'none'; }
    const inst = {
      paper,
      canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
      undo, redo, clearAll, applyVisible,
      open(on) { ui.active = inst; if (on !== ui.open) openBar(on); else refreshUi(); applyVisible(); },
      isOpen: () => ui.open,
      strokes: () => strokes.map(({ c, w, k: kind, a, p }) => ({ c, w, k: kind, a, p })),
      redraw: schedule,
      // Für den PDF-Export: Handschrift in einen Container malen (gleiche Blattbreite wie auf dem Bildschirm)
      paintInto(host, w, h, dpr) { const hostTiles = []; measureLines(); paintAll(host, hostTiles, w, h, dpr); return hostTiles; },
      destroy() { ctl.abort(); layer.remove(); cancelAnimationFrame(raf); if (ui.active === inst) { ui.active = null; refreshUi(); } paper.classList.remove('pen-active', 'pen-lock'); },
    };
    ui.active = inst;
    ensureBar();
    refreshUi();
    applyVisible();
    requestAnimationFrame(() => redraw());
    return inst;
  }

  // Für den Texteditor (Quill): Zeilen = Textzeilen, Anker = Zeichenposition
  function attach(quill, opts) {
    const paper = quill.root.parentElement;
    return create({
      paper,
      measure() {
        const base = paper.getBoundingClientRect().top;
        const idx = []; const top = [];
        for (const line of quill.getLines(0, quill.getLength())) { idx.push(quill.getIndex(line)); top.push(line.domNode.getBoundingClientRect().top - base); }
        return { idx, top };
      },
      subscribe(fn) { quill.on('text-change', (delta) => fn(delta)); },
      observe: [paper, quill.root],
    }, opts);
  }

  // Für beliebigen Text in einem Element: Zeilen = Elemente (selector), Anker = laufende Nummer
  function attachTo(paper, selector, opts) {
    return create({
      paper,
      measure() {
        const base = paper.getBoundingClientRect().top;
        const els = [...paper.querySelectorAll(selector)];
        return { idx: els.map((_, i) => i), top: els.map((el) => el.getBoundingClientRect().top - base) };
      },
      subscribe() {},
      observe: [paper],
    }, opts);
  }

  return { attach, attachTo, setTool, openBar, ui };
})();
