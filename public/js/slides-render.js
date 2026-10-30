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

  function bgCss(slide) {
    const bg = slide.bg;
    if (bg && typeof bg === 'object' && bg.image) {
      const a = Math.abs(Number(bg.overlay) || 0);
      const veil = a > 0.001 ? `linear-gradient(${bg.overlay > 0 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`}, ${bg.overlay > 0 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`}), ` : '';
      return `${veil}url(${/^\/api\/slides\/assets\/\d+$/.test(bg.image) ? bg.image : ''}) center / ${bg.fit === 'contain' ? 'contain' : 'cover'} no-repeat, ${HEX.test(bg.color) ? bg.color : '#ffffff'}`;
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

  function textLines(box, e) {
    const lines = String(e.text || '').split('\n');
    let n = 0;
    lines.forEach((line) => {
      const d = document.createElement('div');
      d.className = 'sl-line';
      if (e.list && e.list !== 'none' && line.trim()) {
        n += 1;
        d.style.paddingLeft = '1.2em';
        d.style.textIndent = '-1.2em';
        d.textContent = `${e.list === 'bullet' ? '•' : `${n}.`} ${line}`;
      } else d.textContent = line || '​';
      box.appendChild(d);
    });
  }

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
    textLines(box, e);
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
      img.src = e.src;
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

  return { W, H, FONTS, mount, slideEl, elementEl, bgCss, isDark, autoColor, resolve, luminance };
})();
if (typeof module !== 'undefined') module.exports = SlideRender;
