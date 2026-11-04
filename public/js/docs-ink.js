// Handschrift-Block für Dokumente: eine Zeichenfläche im Text, in die man mit dem Apple Pencil (oder Maus) schreibt und zeichnet.
// Druckstärke des Pencils wird als Strichstärke übernommen. Die Striche liegen als Zahlen im Dokument (kein Bild),
// bleiben also jederzeit änderbar. Die Fläche hat eine logische Breite von 1000 Einheiten und passt sich der Bildschirmbreite an.
const DocsInk = (() => {
  const LW = 1000;                                  // logische Breite
  const COLORS = ['#1b1d3a', '#2563eb', '#e11d48', '#16a34a'];
  const WIDTHS = [2, 4, 9];
  let penSeen = false;                              // sobald ein Stift benutzt wurde, zeichnen Finger nicht mehr (Handballen-Schutz)

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const ICON = {
    undo: '↶', taller: '⇕＋', shorter: '⇕－', eraser: '⌫', finger: '☝️', del: '🗑',
  };

  function strokeWidth(base, pressure) { return base * (0.35 + 1.3 * pressure); }

  // Alle Striche zeichnen (oder nur einen Teil, ab Strich/Punkt `from`)
  function redraw(node) {
    const canvas = node.querySelector('canvas');
    const ink = node.__ink;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || node.clientWidth || 600;
    const k = cssW / LW;
    const w = Math.round(cssW * dpr);
    const h = Math.round(ink.h * k * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ink.strokes.forEach((s) => drawStroke(ctx, s));
  }

  function drawStroke(ctx, s) {
    const p = s.p;
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], strokeWidth(s.w, p[0][2]) / 2, 0, Math.PI * 2); ctx.fill(); return; }
    // Linienzug mit weichen Kurven (Mittelpunkte als Stützstellen), Breite je nach Druck
    for (let i = 1; i < p.length; i++) {
      const prev = p[i - 1]; const cur = p[i];
      const a = i === 1 ? prev : [(p[i - 2][0] + prev[0]) / 2, (p[i - 2][1] + prev[1]) / 2];
      const b = i === p.length - 1 ? cur : [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(prev[0], prev[1], b[0], b[1]);
      ctx.lineWidth = strokeWidth(s.w, (prev[2] + cur[2]) / 2);
      ctx.stroke();
    }
  }

  const changed = (node) => node.dispatchEvent(new CustomEvent('ink-change', { bubbles: true }));

  function build(node) {
    const ink = node.__ink;
    const state = { tool: 'pen', color: COLORS[0], width: WIDTHS[1], finger: false };
    node.innerHTML = `
      <div class="ink-bar" role="toolbar" aria-label="Handschrift">
        ${COLORS.map((c, i) => `<button type="button" class="ink-color" data-color="${c}" style="background:${c}" aria-label="Farbe ${i + 1}" aria-pressed="${i === 0}"></button>`).join('')}
        <span class="ink-sep"></span>
        ${WIDTHS.map((w, i) => `<button type="button" class="ink-width" data-width="${w}" aria-label="Strichstärke ${i + 1}" aria-pressed="${w === WIDTHS[1]}"><i style="width:${6 + i * 4}px;height:${6 + i * 4}px"></i></button>`).join('')}
        <span class="ink-sep"></span>
        <button type="button" data-tool="eraser" title="Radierer: wischt ganze Striche weg" aria-pressed="false">${ICON.eraser}</button>
        <button type="button" data-act="undo" title="Letzten Strich zurücknehmen">${ICON.undo}</button>
        <button type="button" data-act="finger" title="Auch mit dem Finger zeichnen" aria-pressed="false">${ICON.finger}</button>
        <span class="ink-sep"></span>
        <button type="button" data-act="taller" title="Fläche höher">${ICON.taller}</button>
        <button type="button" data-act="shorter" title="Fläche niedriger">${ICON.shorter}</button>
        <button type="button" data-act="del" class="danger" title="Handschrift-Feld entfernen">${ICON.del}</button>
      </div>
      <canvas class="ink-canvas" aria-label="Zeichenfläche"></canvas>`.replace(/>\s+</g, '><').trim();
    const canvas = node.querySelector('canvas');
    const bar = node.querySelector('.ink-bar');
    const fit = () => { canvas.style.aspectRatio = `${LW} / ${ink.h}`; canvas.style.touchAction = state.finger ? 'none' : 'pan-y'; redraw(node); };
    fit();
    if (window.ResizeObserver) new ResizeObserver(() => redraw(node)).observe(canvas);

    // ----- Werkzeugleiste -----
    bar.addEventListener('pointerdown', (e) => e.preventDefault());      // Fokus und Auswahl im Text bleiben
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.color) { state.color = b.dataset.color; state.tool = 'pen'; }
      else if (b.dataset.width) { state.width = Number(b.dataset.width); state.tool = 'pen'; }
      else if (b.dataset.tool === 'eraser') state.tool = state.tool === 'eraser' ? 'pen' : 'eraser';
      else if (b.dataset.act === 'finger') { state.finger = !state.finger; fit(); }
      else if (b.dataset.act === 'undo') { ink.strokes.pop(); redraw(node); changed(node); }
      else if (b.dataset.act === 'taller') { ink.h = Math.min(2000, ink.h + 160); fit(); changed(node); }
      else if (b.dataset.act === 'shorter') { ink.h = Math.max(160, ink.h - 160); fit(); changed(node); }
      else if (b.dataset.act === 'del') { node.dispatchEvent(new CustomEvent('ink-delete', { bubbles: true })); return; }
      bar.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.color === state.color && state.tool === 'pen')));
      bar.querySelectorAll('[data-width]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.width) === state.width && state.tool === 'pen')));
      bar.querySelector('[data-tool="eraser"]').setAttribute('aria-pressed', String(state.tool === 'eraser'));
      bar.querySelector('[data-act="finger"]').setAttribute('aria-pressed', String(state.finger));
    });

    // ----- Zeichnen -----
    let current = null;       // { stroke, id } oder Radierer-Zustand
    const toLogical = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * LW, (e.clientY - r.top) / r.height * ink.h]; };
    const accepts = (e) => {
      if (e.pointerType === 'pen') { penSeen = true; return true; }
      if (e.pointerType === 'touch') return state.finger;        // mit Finger nur auf Wunsch; sonst scrollt die Seite
      return e.button === 0;                                       // Maus
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = toLogical(e);
      if (state.tool === 'eraser') { current = { erase: true, removed: false }; erase(x, y); return; }
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
      current = { id: e.pointerId, stroke: { c: state.color, w: state.width, p: [[x, y, pressure]] } };
      ink.strokes.push(current.stroke);
      redraw(node);
    });
    function erase(x, y) {
      const R = 18;
      const before = ink.strokes.length;
      ink.strokes = ink.strokes.filter((s) => !s.p.some((pt) => Math.hypot(pt[0] - x, pt[1] - y) < R + s.w));
      if (ink.strokes.length !== before) { current.removed = true; redraw(node); }
    }
    canvas.addEventListener('pointermove', (e) => {
      if (!current || (current.id !== undefined && e.pointerId !== current.id)) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = toLogical(ev);
        if (current.erase) { erase(x, y); continue; }
        const last = current.stroke.p[current.stroke.p.length - 1];
        if (Math.hypot(last[0] - x, last[1] - y) < 0.8) continue;
        current.stroke.p.push([x, y, e.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5]);
      }
      if (!current.erase) redraw(node);
    });
    const end = (e) => {
      if (!current) return;
      const c = current;
      current = null;
      if (c.erase) { if (c.removed) changed(node); return; }
      if (c.stroke.p.length > 600) { /* sehr lange Striche glätten: jeder zweite Punkt */ c.stroke.p = c.stroke.p.filter((_, i, a) => i % 2 === 0 || i === a.length - 1); }
      redraw(node);
      changed(node);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function register(Quill) {
    const BlockEmbed = Quill.import('blots/block/embed');
    class InkBlot extends BlockEmbed {
      static create(value) {
        const node = super.create();
        node.setAttribute('contenteditable', 'false');
        const v = value && typeof value === 'object' ? value : {};
        node.__ink = { h: Number(v.h) || 360, strokes: Array.isArray(v.strokes) ? clone(v.strokes) : [] };
        build(node);
        return node;
      }
      static value(node) { return node.__ink; }
    }
    InkBlot.blotName = 'ink';
    InkBlot.tagName = 'div';
    InkBlot.className = 'ql-ink';
    Quill.register(InkBlot);
  }

  return { register, redraw };
})();
