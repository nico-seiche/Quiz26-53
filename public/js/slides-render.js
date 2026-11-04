// Zeichnet Folien (1280 × 720 Einheiten) als DOM: gemeinsam genutzt von Editor, Vorschaubildern, Präsentation und PDF-Druck.
const SlideRender = (() => {
  const W = 1280;
  const H = 720;
  const FONTS = {
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    display: '"Trebuchet MS", "Avenir Next", system-ui, sans-serif',
  };
  const DARK_TEXT = '#1b1d3a';
  const LIGHT_TEXT = '#ffffff';
  const HEX = /^#[0-9a-f]{3,8}$/i;

  function luminance(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return 1;
    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  }

  // Beim Ansehen per Link müssen Bilder mit dem Link-Schlüssel geladen werden (?t=…)
  let assetQuery = '';
  const setAssetQuery = (q) => { assetQuery = q || ''; };

  function bgCss(slide) {
    const bg = slide.bg;
    if (bg && typeof bg === 'object' && bg.image) {
      const a = Math.abs(Number(bg.overlay) || 0);
      const veil = a > 0.001 ? `linear-gradient(${bg.overlay > 0 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`}, ${bg.overlay > 0 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`}), ` : '';
      return `${veil}url(${/^\/api\/slides\/assets\/\d+$/.test(bg.image) ? bg.image + assetQuery : ''}) center / ${bg.fit === 'contain' ? 'contain' : 'cover'} no-repeat, ${HEX.test(bg.color) ? bg.color : '#ffffff'}`;
    }
    if (bg && typeof bg === 'object') return `linear-gradient(${Number(bg.angle) || 0}deg, ${HEX.test(bg.from) ? bg.from : '#fff'}, ${HEX.test(bg.to) ? bg.to : '#fff'})`;
    return HEX.test(bg) ? bg : '#ffffff';
  }
  const bgBase = (slide) => (slide.bg && typeof slide.bg === 'object' ? (slide.bg.image ? slide.bg.color : slide.bg.from) : slide.bg);
  // Bild mit starker Abdunkelung/Aufhellung entscheidet über die automatische Textfarbe, sonst die Farbe dahinter
  const isDark = (slide) => {
    const bg = slide.bg;
    if (bg && typeof bg === 'object' && bg.image) { if (bg.overlay >= 0.35) return true; if (bg.overlay <= -0.35) return false; }
    return luminance(bgBase(slide) || '#ffffff') < 0.35;
  };
  const autoColor = (slide) => (isDark(slide) ? LIGHT_TEXT : DARK_TEXT);
  // „auto“ = Kontrastfarbe zum Folienhintergrund, „none“ = keine Farbe
  function resolve(c, slide, dflt) {
    if (c === 'auto') return autoColor(slide);
    if (c === 'none') return 'transparent';
    return HEX.test(c) ? c : dflt;
  }

  // ---------- Formatierter Text: Läufe { t, b, i, u, c, sz, f } (nur die Abweichungen vom Textfeld sind gesetzt) ----------
  const Rich = (() => {
    const PROPS = ['b', 'i', 'u', 'c', 'sz', 'f'];
    const sameStyle = (a, b) => PROPS.every((k) => a[k] === b[k]);
    const hasOverrides = (runs) => runs.some((r) => PROPS.some((k) => r[k] !== undefined));
    const plain = (runs) => runs.map((r) => r.t).join('');
    // Läufe eines Textfelds (auch wenn es nur reinen Text hat)
    const runsOf = (e) => (Array.isArray(e.runs) && e.runs.length ? e.runs : [{ t: String(e.text || '') }]);
    function normalize(runs) {
      const out = [];
      runs.forEach((r) => {
        if (!r.t) return;
        const last = out[out.length - 1];
        if (last && sameStyle(last, r)) last.t += r.t; else out.push({ ...r });
      });
      return out;
    }
    // Lauf-Grenze an der Zeichenposition `at` sicherstellen
    function splitAt(runs, at) {
      const out = [];
      let pos = 0;
      runs.forEach((r) => {
        if (at > pos && at < pos + r.t.length) { out.push({ ...r, t: r.t.slice(0, at - pos) }, { ...r, t: r.t.slice(at - pos) }); } else out.push({ ...r });
        pos += r.t.length;
      });
      return out;
    }
    // Bereich [start, end) formatieren; patch: { b: true, c: '#ff0000', sz: undefined (= zurück zum Standard) … }
    function applyStyle(runs, start, end, patch) {
      const parts = splitAt(splitAt(runs, start), end);
      let pos = 0;
      parts.forEach((r) => {
        if (pos >= start && pos + r.t.length <= end) PROPS.forEach((k) => { if (k in patch) { if (patch[k] === undefined) delete r[k]; else r[k] = patch[k]; } });
        pos += r.t.length;
      });
      return normalize(parts);
    }
    // Eigenschaft eines Laufs inkl. Vorgabe des Textfelds
    const effective = (r, e, k) => {
      if (r[k] !== undefined) return r[k];
      return { b: e.bold, i: e.italic, u: e.underline, c: e.color, sz: e.size, f: e.font }[k];
    };
    // Gilt die Eigenschaft im ganzen Bereich? (für Fett/Kursiv/Unterstrichen: true, false oder null = gemischt)
    function stateOf(runs, start, end, e, k) {
      let pos = 0; let all = null; let seen = false;
      runs.forEach((r) => {
        const rs = pos; const re = pos + r.t.length; pos = re;
        if (re <= start || rs >= end) return;
        const v = Boolean(effective(r, e, k));
        all = seen ? (all === v ? v : null) : v;
        seen = true;
      });
      return seen ? all : Boolean(effective({}, e, k));
    }
    // Überflüssige Abweichungen (gleich wie die Vorgabe des Textfelds) entfernen
    function tidy(runs, e) {
      return normalize(runs.map((r) => {
        const o = { t: r.t };
        if (r.b !== undefined && Boolean(r.b) !== Boolean(e.bold)) o.b = r.b;
        if (r.i !== undefined && Boolean(r.i) !== Boolean(e.italic)) o.i = r.i;
        if (r.u !== undefined && Boolean(r.u) !== Boolean(e.underline)) o.u = r.u;
        if (r.c !== undefined && r.c !== e.color) o.c = r.c;
        if (r.sz !== undefined && r.sz !== e.size) o.sz = r.sz;
        if (r.f !== undefined && r.f !== e.font) o.f = r.f;
        return o;
      }));
    }
    // Eigenschaft für das ganze Feld ändern: Abweichungen dieser Eigenschaft in den Läufen entfallen
    function stripProp(e, k) {
      if (!Array.isArray(e.runs)) return;
      const runs = normalize(e.runs.map((r) => { const o = { ...r }; delete o[k]; return o; }));
      if (hasOverrides(runs)) e.runs = runs; else delete e.runs;
    }

    // ----- DOM: Läufe zeichnen und aus dem bearbeiteten DOM wieder auslesen -----
    function style(span, r, e, slide) {
      const st = span.style;
      if (r.b !== undefined || e.bold) st.fontWeight = effective(r, e, 'b') ? '800' : '400';
      if (r.i !== undefined || e.italic) st.fontStyle = effective(r, e, 'i') ? 'italic' : 'normal';
      if (r.u !== undefined || e.underline) st.textDecoration = effective(r, e, 'u') ? 'underline' : 'none';
      if (r.c !== undefined) st.color = resolve(r.c, slide, DARK_TEXT);
      if (r.sz !== undefined) st.fontSize = `${r.sz}px`;
      if (r.f !== undefined) st.fontFamily = FONTS[r.f] || FONTS.sans;
    }
    function mark(span, r) {
      span.dataset.r = '1';
      PROPS.forEach((k) => { if (r[k] !== undefined) span.dataset[k] = typeof r[k] === 'boolean' ? (r[k] ? '1' : '0') : String(r[k]); });
    }
    // Anzeige: Text in Zeilen, jede Zeile mit ihren Abschnitten
    function lines(runs) {
      const out = [[]];
      runs.forEach((r) => {
        r.t.split('\n').forEach((part, i) => { if (i) out.push([]); if (part) out[out.length - 1].push({ ...r, t: part }); });
      });
      return out;
    }
    // Bearbeiten: ein durchgehender Text mit <br> für Zeilenumbrüche
    function fill(box, e, slide) {
      box.replaceChildren();
      runsOf(e).forEach((r) => {
        const span = document.createElement('span');
        mark(span, r);
        style(span, r, e, slide);
        r.t.split('\n').forEach((part, i) => {
          if (i) span.appendChild(document.createElement('br'));
          if (part) span.appendChild(document.createTextNode(part));
        });
        box.appendChild(span);
      });
    }
    const rgbHex = (c) => { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : null; };
    // Aus dem bearbeiteten DOM lesen. Eigene Abschnitte (data-r) gelten genau; fremdes Markup (z. B. das Fett/Kursiv-Menü von iOS) wird mit übersetzt.
    function fromDom(root) {
      const runs = [];
      const push = (t, st) => { if (t) runs.push({ t, ...st }); };
      const walk = (node, st) => {
        if (node.nodeType === 3) { push(node.nodeValue.replace(/​/g, ''), st); return; }
        if (node.nodeType !== 1) return;
        const tag = node.localName;
        if (tag === 'br') { push('\n', st); return; }
        let s2 = { ...st };
        if (node.dataset && node.dataset.r) {
          s2 = {};
          PROPS.forEach((k) => {
            const v = node.dataset[k];
            if (v === undefined) return;
            s2[k] = k === 'sz' ? Number(v) : (k === 'b' || k === 'i' || k === 'u') ? v === '1' : v;
          });
        } else {
          if (tag === 'b' || tag === 'strong') s2.b = true;
          if (tag === 'i' || tag === 'em') s2.i = true;
          if (tag === 'u') s2.u = true;
          const cs = node.style;
          if (cs) {
            if (cs.fontWeight) s2.b = cs.fontWeight === 'bold' || Number(cs.fontWeight) >= 600;
            if (cs.fontStyle) s2.i = cs.fontStyle === 'italic';
            if (cs.textDecorationLine && cs.textDecorationLine.includes('underline')) s2.u = true;
            if (cs.color) { const h = rgbHex(cs.color); if (h) s2.c = h; }
          }
        }
        const block = tag === 'div' || tag === 'p';
        if (block && runs.length && !runs[runs.length - 1].t.endsWith('\n')) push('\n', st);
        node.childNodes.forEach((ch) => walk(ch, s2));
      };
      root.childNodes.forEach((ch) => walk(ch, {}));
      // ein einzelner Zeilenumbruch am Ende ist nur ein Platzhalter des Browsers
      const last = runs[runs.length - 1];
      if (last && last.t === '\n') runs.pop();
      return normalize(runs);
    }
    // Zeichenposition (Text + <br> als 1 Zeichen) einer Auswahl-Grenze im Feld
    function offsetOf(root, node, off) {
      const r = document.createRange();
      r.selectNodeContents(root);
      try { r.setEnd(node, off); } catch { return 0; }
      return plain(fromDomFragment(r.cloneContents())).length;
    }
    function fromDomFragment(frag) { const holder = document.createElement('div'); holder.appendChild(frag); return fromDomKeep(holder); }
    // wie fromDom, aber ohne das letzte <br> zu verwerfen (für Positionsberechnung)
    function fromDomKeep(root) {
      const runs = [];
      const walk = (n) => { if (n.nodeType === 3) runs.push({ t: n.nodeValue.replace(/​/g, '') }); else if (n.nodeType === 1) { if (n.localName === 'br') runs.push({ t: '\n' }); else { const block = (n.localName === 'div' || n.localName === 'p') && runs.length && !runs[runs.length - 1].t.endsWith('\n'); if (block) runs.push({ t: '\n' }); n.childNodes.forEach(walk); } } };
      root.childNodes.forEach(walk);
      return runs;
    }
    // Auswahl wieder auf Zeichenpositionen setzen
    function select(root, start, end) {
      const find = (target) => {
        let pos = 0;
        let hit = null;
        const walk = (n) => {
          if (hit) return;
          if (n.nodeType === 3) { const len = n.nodeValue.length; if (target <= pos + len) hit = [n, target - pos]; else pos += len; }
          else if (n.localName === 'br') { if (target <= pos) { hit = [n.parentNode, [...n.parentNode.childNodes].indexOf(n)]; } else pos += 1; }
          else n.childNodes.forEach(walk);
        };
        root.childNodes.forEach(walk);
        return hit || [root, root.childNodes.length];
      };
      const [sn, so] = find(start); const [en, eo] = find(end);
      const range = document.createRange();
      range.setStart(sn, so); range.setEnd(en, eo);
      const sel = getSelection();
      sel.removeAllRanges(); sel.addRange(range);
    }

    // Anzeige in der Folie (Präsentation, Vorschau, PDF)
    function render(box, e, slide) {
      let n = 0;
      lines(runsOf(e)).forEach((segments) => {
        const d = document.createElement('div');
        d.className = 'sl-line';
        const text = segments.map((x) => x.t).join('');
        if (e.list && e.list !== 'none' && text.trim()) {
          n += 1;
          d.style.paddingLeft = '1.2em';
          d.style.textIndent = '-1.2em';
          d.appendChild(document.createTextNode(`${e.list === 'bullet' ? '•' : `${n}.`} `));
        }
        if (!segments.length) d.textContent = '​';
        segments.forEach((r) => {
          if (PROPS.every((k) => r[k] === undefined)) { d.appendChild(document.createTextNode(r.t)); return; }
          const span = document.createElement('span');
          style(span, r, e, slide);
          span.textContent = r.t;
          d.appendChild(span);
        });
        box.appendChild(d);
      });
    }
    return { PROPS, plain, runsOf, normalize, applyStyle, stateOf, tidy, stripProp, hasOverrides, effective, fill, fromDom, offsetOf, select, render };
  })();

  function textLines(box, e, slide) { Rich.render(box, e, slide); }

  function textBox(e, slide, extra) {
    const box = document.createElement('div');
    box.className = 'sl-text';
    const s = box.style;
    s.fontSize = `${e.size || 32}px`;
    s.fontFamily = FONTS[e.font] || FONTS.sans;
    s.fontWeight = e.bold ? '800' : '400';
    s.fontStyle = e.italic ? 'italic' : 'normal';
    s.textDecoration = e.underline ? 'underline' : 'none';
    s.textAlign = e.align || 'left';
    s.color = resolve(e.color, slide, DARK_TEXT);
    s.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign] || 'flex-start';
    if (extra) Object.assign(s, extra);
    textLines(box, e, slide);
    return box;
  }

  function shapeSvg(e, slide) {
    const sw = Number(e.strokeWidth) || 0;
    const fill = resolve(e.fill, slide, 'transparent');
    const stroke = e.stroke === 'none' || !sw ? 'none' : resolve(e.stroke, slide, 'none');
    const w = e.w;
    const h = e.h;
    const i = sw / 2;
    let shape;
    if (e.kind === 'ellipse') shape = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - i)}" ry="${Math.max(0, h / 2 - i)}"/>`;
    else if (e.kind === 'triangle') shape = `<polygon points="${w / 2},${i} ${w - i},${h - i} ${i},${h - i}"/>`;
    else {
      const r = Math.min(Number(e.radius) || 0, w / 2, h / 2);
      shape = `<rect x="${i}" y="${i}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" rx="${r}"/>`;
    }
    return `<svg class="sl-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round">${shape}</svg>`;
  }

  function tableEl(e, slide) {
    const t = document.createElement('table');
    t.className = 'sl-table';
    const color = resolve(e.color, slide, DARK_TEXT);
    const border = resolve(e.border, slide, '#cbd2ee');
    t.style.cssText = `width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-size:${e.size || 24}px;font-family:${FONTS[e.font] || FONTS.sans};color:${color}`;
    (e.rows || [['']]).forEach((row, r) => {
      const tr = document.createElement('tr');
      const head = e.header !== false && r === 0;
      row.forEach((cell, c) => {
        const td = document.createElement(head ? 'th' : 'td');
        td.dataset.r = r; td.dataset.c = c;
        td.textContent = cell;
        const zebra = e.zebra && !head && r % 2 === 0 ? 'background:rgba(128,128,128,.12);' : '';
        td.style.cssText = `border:2px solid ${border};padding:6px 12px;text-align:${e.align || 'left'};vertical-align:middle;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.25;${zebra}` +
          (head ? `background:${resolve(e.headFill, slide, '#4f6cf5')};color:${resolve(e.headColor, slide, '#ffffff')};font-weight:800;` : '');
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    return t;
  }

  function elementEl(e, slide, opts) {
    const el = document.createElement('div');
    el.className = `sl-el sl-${e.type}`;
    el.dataset.id = e.id;
    const s = el.style;
    s.left = `${e.x}px`; s.top = `${e.y}px`; s.width = `${e.w}px`; s.height = `${e.h}px`;
    s.opacity = String(e.opacity ?? 1);
    if (e.type === 'text') {
      if (e.fill && e.fill !== 'none') s.background = resolve(e.fill, slide, 'transparent');
      el.appendChild(textBox(e, slide, { padding: '4px 8px' }));
    } else if (e.type === 'shape') {
      el.innerHTML = shapeSvg(e, slide);
      el.appendChild(textBox(e, slide, { padding: '10px 16px', position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign || 'middle'] }));
    } else if (e.type === 'table') {
      el.appendChild(tableEl(e, slide));
    } else if (e.type === 'placeholder') {
      el.className += ' sl-placeholder';
      const s2 = Math.min(e.w, e.h);
      el.style.cssText += `;border:3px dashed rgba(128,128,128,.55);background:rgba(128,128,128,.1);border-radius:${Number(e.radius) || 0}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${s2 * 0.04}px;color:rgba(110,110,130,.9);`;
      const icon = document.createElement('div');
      icon.textContent = '🖼️';
      icon.style.fontSize = `${Math.max(16, s2 * 0.3)}px`;
      const label = document.createElement('div');
      label.textContent = e.label || 'Bild einfügen';
      label.style.cssText = `font-size:${Math.max(12, Math.min(28, s2 * 0.1))}px;font-weight:700;text-align:center;padding:0 12px`;
      el.append(icon, label);
    } else if (e.type === 'image') {
      const img = document.createElement('img');
      img.src = e.src + assetQuery;
      img.alt = '';
      img.draggable = false;
      img.style.objectFit = e.fit === 'cover' ? 'cover' : 'contain';
      img.style.borderRadius = `${Number(e.radius) || 0}px`;
      el.appendChild(img);
    }
    if (opts && opts.present && e.goto > 0) { el.dataset.goto = e.goto; el.style.cursor = 'pointer'; }
    return el;
  }

  // Die Folie in Originalgröße (1280 × 720) als Element
  // opts.present: Bildplatzhalter werden nicht gezeigt, Schaltflächen mit Ziel sind klickbar
  function slideEl(slide, opts) {
    const root = document.createElement('div');
    root.className = 'sl';
    root.style.background = bgCss(slide);
    (slide.elements || []).forEach((e) => { if (!(opts && opts.present && e.type === 'placeholder')) root.appendChild(elementEl(e, slide, opts)); });
    return root;
  }

  // Folie skaliert in einen Container setzen (Breite in Pixeln); gibt { wrap, slide, scale } zurück
  function mount(container, slide, width, opts) {
    const scale = width / W;
    const wrap = document.createElement('div');
    wrap.className = 'sl-wrap';
    wrap.style.width = `${width}px`;
    wrap.style.height = `${H * scale}px`;
    const sl = slideEl(slide, opts);
    sl.style.transform = `scale(${scale})`;
    wrap.appendChild(sl);
    container.replaceChildren(wrap);
    return { wrap, slide: sl, scale };
  }

  const css = `
    .sl-wrap { position: relative; overflow: hidden; flex: none; }
    .sl { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; transform-origin: 0 0; font-family: ${FONTS.sans}; }
    .sl-el { position: absolute; box-sizing: border-box; }
    .sl-svg { position: absolute; left: 0; top: 0; overflow: visible; }
    .sl-text { box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; line-height: 1.25; overflow: hidden; }
    .sl-line { overflow-wrap: anywhere; white-space: pre-wrap; }
    .sl-image img { width: 100%; height: 100%; display: block; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  return { W, H, FONTS, Rich, setAssetQuery, mount, slideEl, elementEl, bgCss, isDark, autoColor, resolve, luminance };
})();
if (typeof module !== 'undefined') module.exports = SlideRender;
