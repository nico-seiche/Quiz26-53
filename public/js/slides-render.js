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
    if (bg && typeof bg === 'object') return `linear-gradient(${Number(bg.angle) || 0}deg, ${HEX.test(bg.from) ? bg.from : '#fff'}, ${HEX.test(bg.to) ? bg.to : '#fff'})`;
    return HEX.test(bg) ? bg : '#ffffff';
  }
  const bgBase = (slide) => (slide.bg && typeof slide.bg === 'object' ? slide.bg.from : slide.bg);
  const isDark = (slide) => luminance(bgBase(slide) || '#ffffff') < 0.35;
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

  function elementEl(e, slide) {
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
      el.appendChild(textBox(e, slide, { padding: '10px 16px', position: 'absolute', inset: '0', justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign || 'middle'] }));
    } else if (e.type === 'image') {
      const img = document.createElement('img');
      img.src = e.src;
      img.alt = '';
      img.draggable = false;
      img.style.objectFit = e.fit === 'cover' ? 'cover' : 'contain';
      img.style.borderRadius = `${Number(e.radius) || 0}px`;
      el.appendChild(img);
    }
    return el;
  }

  // Die Folie in Originalgröße (1280 × 720) als Element
  function slideEl(slide) {
    const root = document.createElement('div');
    root.className = 'sl';
    root.style.background = bgCss(slide);
    (slide.elements || []).forEach((e) => root.appendChild(elementEl(e, slide)));
    return root;
  }

  // Folie skaliert in einen Container setzen (Breite in Pixeln); gibt { wrap, slide, scale } zurück
  function mount(container, slide, width) {
    const scale = width / W;
    const wrap = document.createElement('div');
    wrap.className = 'sl-wrap';
    wrap.style.width = `${width}px`;
    wrap.style.height = `${H * scale}px`;
    const sl = slideEl(slide);
    sl.style.transform = `scale(${scale})`;
    wrap.appendChild(sl);
    container.replaceChildren(wrap);
    return { wrap, slide: sl, scale };
  }

  const css = `
    .sl-wrap { position: relative; overflow: hidden; flex: none; }
    .sl { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; transform-origin: 0 0; font-family: ${FONTS.sans}; }
    .sl-el { position: absolute; box-sizing: border-box; }
    .sl-svg { position: absolute; inset: 0; overflow: visible; }
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
