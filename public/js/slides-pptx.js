// PowerPoint (.pptx) in bearbeitbare Folien umwandeln – komplett im Browser (JSZip + DOMParser).
// Übernommen werden: Folienhintergründe, Textfelder und Platzhalter (Schrift, Größe, Farbe, Ausrichtung, Aufzählungen), Formen
// (Rechteck, abgerundet, Kreis, Dreieck, Linien), Bilder (auch zugeschnitten), Tabellen, Gruppen und Notizen.
// Nicht übernommen (an der Stelle steht ein Platzhalter): Diagramme, SmartArt, Videos, eingebettete Objekte, Animationen, Übergänge.
const PptxImport = (() => {
  const W = 1280;
  const H = 720;
  const MAX_SLIDES = 200;
  const MAX_ELEMENTS = 300;
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const uid = (p = 'e') => p + Math.random().toString(36).slice(2, 8);

  // ---------- kleine XML-Helfer (Namensräume ignorieren, nur lokale Namen) ----------
  const kids = (el, name) => (el ? [...el.childNodes].filter((n) => n.nodeType === 1 && (!name || n.localName === name)) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const path = (el, ...names) => names.reduce((cur, n) => (cur ? kid(cur, n) : null), el);
  const desc = (el, name) => (el ? [...el.getElementsByTagNameNS('*', name)] : []);
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const num = (v, dflt = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? dflt : Number(v));

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Die PowerPoint-Funktion konnte nicht geladen werden (keine Verbindung?)')); document.head.appendChild(s); });
  }

  // ---------- Farben ----------
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex([r, g, b]) { return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`; }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); let h = 0; let s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hslToRgb([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const PRESET = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080' };

  // Farbe aus einem Element lesen, das ein Farbkind hat (srgbClr, schemeClr, sysClr, prstClr) samt Änderungen (lumMod, tint …)
  function readColor(parent, ctx) {
    const c = kids(parent).find((n) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'].includes(n.localName));
    if (!c) return null;
    let hex = null;
    let scheme = null;
    if (c.localName === 'srgbClr') hex = `#${attr(c, 'val')}`;
    else if (c.localName === 'sysClr') hex = `#${attr(c, 'lastClr') || '000000'}`;
    else if (c.localName === 'prstClr') hex = PRESET[attr(c, 'val')] || '#000000';
    else if (c.localName === 'schemeClr') { scheme = attr(c, 'val'); hex = ctx.scheme(scheme); }
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    let rgb = hexToRgb(hex);
    kids(c).forEach((m) => {
      const v = num(attr(m, 'val')) / 100000;
      if (m.localName === 'lumMod' || m.localName === 'lumOff' || m.localName === 'satMod') {
        const hsl = rgbToHsl(rgb);
        if (m.localName === 'lumMod') hsl[2] = clamp01(hsl[2] * v);
        if (m.localName === 'lumOff') hsl[2] = clamp01(hsl[2] + v);
        if (m.localName === 'satMod') hsl[1] = clamp01(hsl[1] * v);
        rgb = hslToRgb(hsl);
      } else if (m.localName === 'tint') rgb = rgb.map((x) => 255 - (255 - x) * v);
      else if (m.localName === 'shade') rgb = rgb.map((x) => x * v);
    });
    return { hex: rgbToHex(rgb), scheme };
  }

  // Füllung eines spPr/bgPr: { kind: 'solid'|'none'|'grad'|'image', color, to, angle, embed, crop }
  function readFill(props, ctx) {
    if (!props) return null;
    for (const n of kids(props)) {
      if (n.localName === 'noFill') return { kind: 'none' };
      if (n.localName === 'solidFill') { const c = readColor(n, ctx); return c ? { kind: 'solid', color: c.hex, scheme: c.scheme } : null; }
      if (n.localName === 'gradFill') {
        const stops = kids(kid(n, 'gsLst'), 'gs').map((g) => readColor(g, ctx)).filter(Boolean);
        if (!stops.length) return null;
        const lin = kid(n, 'lin');
        return { kind: stops.length > 1 ? 'grad' : 'solid', color: stops[0].hex, to: stops[stops.length - 1].hex, angle: lin ? num(attr(lin, 'ang')) / 60000 : 90 };
      }
      if (n.localName === 'blipFill') { const b = kid(n, 'blip'); return b ? { kind: 'image', embed: attr(b, 'embed') || b.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed'), crop: readCrop(n) } : null; }
    }
    return null;
  }
  function readCrop(blipFill) {
    const r = kid(blipFill, 'srcRect');
    if (!r) return null;
    const v = (k) => Math.min(0.9, Math.max(0, num(attr(r, k)) / 100000));
    const crop = { l: v('l'), t: v('t'), r: v('r'), b: v('b') };
    return crop.l || crop.t || crop.r || crop.b ? crop : null;
  }

  const fontKind = (face) => {
    const f = String(face || '').toLowerCase();
    if (/courier|consolas|mono|menlo|code/.test(f)) return 'mono';
    if (/times|georgia|cambria|garamond|palatino|book|minion|baskerville|serif/.test(f) && !/sans/.test(f)) return 'serif';
    if (/trebuchet|verdana|impact|comic|century gothic|tahoma|avenir/.test(f)) return 'display';
    return 'sans';
  };
  const px = (v) => Math.round(v * 10) / 10;
  const mergeRuns = (runs) => runs.reduce((out, r) => { const last = out[out.length - 1]; if (last && ['b', 'i', 'u', 'c', 'sz', 'f'].every((k) => last[k] === r[k])) last.t += r.t; else out.push({ ...r }); return out; }, []);

  // ---------- Hauptfunktion ----------
  // file: .pptx-Datei; opts.upload(blob, { crop }) → Promise<url>; opts.onProgress(text)
  async function parse(file, opts = {}) {
    if (!window.JSZip) await loadScript(JSZIP);
    let zip;
    try { zip = await window.JSZip.loadAsync(file); } catch { throw new Error('Das ist keine gültige PowerPoint-Datei (.pptx). Ältere .ppt-Dateien bitte in PowerPoint als .pptx speichern.'); }
    const parser = new DOMParser();
    const docs = new Map();
    const xml = async (p) => {
      if (!docs.has(p)) {
        const f = zip.file(p);
        docs.set(p, f ? parser.parseFromString(await f.async('string'), 'application/xml').documentElement : null);
      }
      return docs.get(p);
    };
    const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
    const resolve = (from, target) => {
      if (target.startsWith('/')) return target.slice(1);
      const parts = (dirOf(from) + target).split('/');
      const out = [];
      parts.forEach((x) => { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); });
      return out.join('/');
    };
    const relsCache = new Map();
    async function rels(partPath) {
      if (relsCache.has(partPath)) return relsCache.get(partPath);
      const map = new Map();
      const root = await xml(`${dirOf(partPath)}_rels/${partPath.split('/').pop()}.rels`);
      kids(root, 'Relationship').forEach((r) => map.set(attr(r, 'Id'), { type: String(attr(r, 'Type')).split('/').pop(), target: attr(r, 'TargetMode') === 'External' ? null : resolve(partPath, attr(r, 'Target')) }));
      relsCache.set(partPath, map);
      return map;
    }
    const relOfType = async (partPath, type) => [...(await rels(partPath)).values()].find((r) => r.type === type);

    const pres = await xml('ppt/presentation.xml');
    if (!pres) throw new Error('Das ist keine gültige PowerPoint-Datei (.pptx).');
    const sz = path(pres, 'sldSz');
    const cx = num(attr(sz, 'cx'), 12192000);
    const cy = num(attr(sz, 'cy'), 6858000);
    const k = Math.min(W / cx, H / cy);               // EMU → Folieneinheiten
    const offX = (W - cx * k) / 2;
    const offY = (H - cy * k) / 2;
    const ptUnit = 12700 * k;                         // 1 pt in Folieneinheiten

    const presRels = await rels('ppt/presentation.xml');
    const slideIds = kids(path(pres, 'sldIdLst'), 'sldId').map((s) => presRels.get(s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || attr(s, 'r:id'))).filter((r) => r && r.target);
    if (!slideIds.length) throw new Error('Die Präsentation enthält keine Folien.');

    const report = { slides: 0, images: 0, notes: [] };
    const note = (msg) => { if (!report.notes.includes(msg)) report.notes.push(msg); };

    // Master und Theme (Farben, Schriften)
    const firstSlide = slideIds[0].target;
    const firstLayout = await relOfType(firstSlide, 'slideLayout');
    const firstMaster = firstLayout && await relOfType(firstLayout.target, 'slideMaster');
    const themeRel = firstMaster && await relOfType(firstMaster.target, 'theme');
    const theme = themeRel && await xml(themeRel.target);
    const themeColors = {};
    desc(theme, 'clrScheme')[0] && kids(desc(theme, 'clrScheme')[0]).forEach((c) => {
      const n = kid(c);
      themeColors[c.localName] = n ? (n.localName === 'sysClr' ? `#${attr(n, 'lastClr')}` : `#${attr(n, 'val')}`) : null;
    });
    const fonts = { major: null, minor: null };
    const fs = desc(theme, 'fontScheme')[0];
    if (fs) { fonts.major = attr(path(fs, 'majorFont', 'latin'), 'typeface'); fonts.minor = attr(path(fs, 'minorFont', 'latin'), 'typeface'); }
    const clrMapOf = (master) => {
      const m = master && desc(master, 'clrMap')[0];
      const base = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
      if (m) [...m.attributes].forEach((a) => { base[a.name] = a.value; });
      return base;
    };
    const masterDoc = firstMaster && await xml(firstMaster.target);
    const clrMap = clrMapOf(masterDoc);
    const ctx = {
      scheme(name) { const mapped = clrMap[name] || name; return themeColors[mapped] || themeColors[name] || null; },
    };

    // Bilder: jede Mediendatei nur einmal (je Zuschnitt) hochladen
    const imageCache = new Map();
    async function imageFor(partPath, embed, crop) {
      const rel = (await rels(partPath)).get(embed);
      if (!rel || !rel.target) return null;
      const ext = rel.target.split('.').pop().toLowerCase();
      if (!IMAGE_TYPES[ext]) { note(`Ein Bild im Format .${ext} kann nicht übernommen werden (an der Stelle steht ein Platzhalter).`); return null; }
      const key = `${rel.target}|${JSON.stringify(crop)}`;
      if (!imageCache.has(key)) {
        const f = zip.file(rel.target);
        if (!f) return null;
        const blob = new Blob([await f.async('uint8array')], { type: IMAGE_TYPES[ext] });
        imageCache.set(key, opts.upload(blob, { crop }).catch((err) => { note(`Ein Bild konnte nicht hochgeladen werden: ${err.message}`); return null; }));
        report.images += 1;
      }
      return imageCache.get(key);
    }

    // ---------- Schriftvorgaben aus Platzhalter, Layout, Master ----------
    const phOf = (sp) => path(sp, 'nvSpPr', 'nvPr', 'ph');
    function findPlaceholder(root, ph) {
      if (!root || !ph) return null;
      const list = desc(root, 'sp').filter((s) => phOf(s));
      const idx = attr(ph, 'idx'); const type = attr(ph, 'type');
      return list.find((s) => idx !== null && attr(phOf(s), 'idx') === idx) || list.find((s) => type && attr(phOf(s), 'type') === type)
        || list.find((s) => (type === 'ctrTitle' && attr(phOf(s), 'type') === 'title') || (type === 'subTitle' && attr(phOf(s), 'type') === 'body')) || null;
    }
    const lvl1 = (sp) => path(sp, 'txBody', 'lstStyle', 'lvl1pPr');
    const masterStyle = (name) => path(masterDoc, 'txStyles', name, 'lvl1pPr');

    async function layoutAndMaster(slidePath) {
      const lr = await relOfType(slidePath, 'slideLayout');
      const layout = lr && await xml(lr.target);
      const mr = lr && await relOfType(lr.target, 'slideMaster');
      const master = mr && await xml(mr.target);
      return { layout, master };
    }

    // Hintergrund: Folie → Layout → Master
    async function readBackground(root, partPath, c) {
      const bg = path(root, 'cSld', 'bg');
      if (!bg) return null;
      const props = kid(bg, 'bgPr');
      if (props) {
        const fill = readFill(props, c);
        if (!fill) return null;
        if (fill.kind === 'solid') return fill.color;
        if (fill.kind === 'grad') return { from: fill.color, to: fill.to, angle: Math.round(((fill.angle + 90) % 360)) };
        if (fill.kind === 'image' && fill.embed) { const url = await imageFor(partPath, fill.embed, fill.crop); return url ? { image: url.url, fit: 'cover', overlay: 0, color: '#ffffff' } : null; }
        return null;
      }
      const ref = kid(bg, 'bgRef');
      const col = ref && readColor(ref, c);
      return col ? col.hex : null;
    }

    // ---------- Text ----------
    function readText(sp, ph, chain, isTextBox) {
      const body = kid(sp, 'txBody');
      if (!body) return null;
      const paras = kids(body, 'p');
      const lines = [];
      let first = null;
      let listVotes = 0; let textParas = 0;
      const phType = ph ? attr(ph, 'type') : null;
      const styleName = !ph ? null : (phType === 'title' || phType === 'ctrTitle') ? 'titleStyle' : (['dt', 'ftr', 'sldNum'].includes(phType) ? 'otherStyle' : 'bodyStyle');
      const inherit = [...chain.map(lvl1), styleName ? masterStyle(styleName) : null, ph ? null : path(pres, 'defaultTextStyle', 'lvl1pPr')].filter(Boolean);
      const inheritedBullet = () => {
        for (const p of inherit) { if (kid(p, 'buNone')) return null; if (kid(p, 'buChar')) return 'bullet'; if (kid(p, 'buAutoNum')) return 'number'; }
        return null;
      };
      for (const p of paras) {
        const parts = [];
        let run = null;
        kids(p).forEach((n) => {
          if (n.localName === 'r' || n.localName === 'fld') { const t = kid(n, 't'); if (t) parts.push(t.textContent); if (!run && t && t.textContent.trim()) run = n; }
          else if (n.localName === 'br') parts.push('\n');
        });
        const text = parts.join('');
        lines.push(text);
        if (!text.trim()) continue;
        textParas += 1;
        const pPr = kid(p, 'pPr');
        const own = pPr && (kid(pPr, 'buNone') ? 'none' : kid(pPr, 'buChar') ? 'bullet' : kid(pPr, 'buAutoNum') ? 'number' : null);
        const kind = own === 'none' ? null : own || inheritedBullet();
        if (kind) listVotes += kind === 'number' ? 1.01 : 1;
        if (!first) first = { p, pPr, run, rPr: run ? kid(run, 'rPr') : null, kind };
      }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (!first || !textParas) return null;
      const bodyPr = kid(body, 'bodyPr');
      const auto = bodyPr && kid(bodyPr, 'normAutofit');
      const fontScale = auto && attr(auto, 'fontScale') ? num(attr(auto, 'fontScale')) / 100000 : 1;
      // Reihenfolge: Lauf → Absatz-Vorgabe (defRPr) → Layout/Master
      const defRPrs = [first.pPr && kid(first.pPr, 'defRPr'), ...inherit.map((p) => kid(p, 'defRPr'))].filter(Boolean);
      const styleOf = (rPr) => {
        const pick = (get) => { for (const n of [rPr, ...defRPrs]) { const v = n && get(n); if (v !== null && v !== undefined && v !== '') return v; } return null; };
        const flag = (name) => pick((n) => (attr(n, name) !== null ? attr(n, name) === '1' || attr(n, name) === 'true' || (name === 'u' && attr(n, name) !== 'none') : null));
        let color = 'auto';
        for (const n of [rPr, ...defRPrs]) {
          const f = n && kid(n, 'solidFill');
          const c = f && readColor(f, ctx);
          if (c) { color = c.scheme === 'tx1' || c.scheme === 'dk1' ? 'auto' : c.hex; break; }   // Standard-Textfarbe = automatisch passend zum Hintergrund
        }
        let face = pick((n) => attr(kid(n, 'latin'), 'typeface'));
        if (face === '+mj-lt') face = fonts.major; else if (face === '+mn-lt' || !face) face = fonts.minor;
        return {
          size: Math.min(240, Math.max(8, Math.round((pick((n) => (attr(n, 'sz') ? num(attr(n, 'sz')) / 100 : null)) || 18) * fontScale * ptUnit))),
          bold: Boolean(flag('b')), italic: Boolean(flag('i')), underline: Boolean(flag('u')), color, font: fontKind(face),
        };
      };
      const base = styleOf(first.rPr);
      const algn = (first.pPr && attr(first.pPr, 'algn')) || inherit.map((p) => attr(p, 'algn')).find(Boolean) || 'l';
      const anchor = (bodyPr && attr(bodyPr, 'anchor')) || chain.map((ch) => attr(path(ch, 'txBody', 'bodyPr'), 'anchor')).find(Boolean);
      const valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : anchor === 't' ? 'top' : (!ph && !isTextBox ? 'middle' : (phType === 'title' || phType === 'ctrTitle' || phType === 'subTitle') ? 'middle' : 'top');
      // Textabschnitte mit eigener Formatierung (nur Abweichungen vom ersten Abschnitt werden gemerkt)
      const raw = [];
      paras.forEach((p, pi) => {
        kids(p).forEach((n) => {
          if (n.localName === 'r' || n.localName === 'fld') { const t = kid(n, 't'); if (t && t.textContent) raw.push({ t: t.textContent, rPr: kid(n, 'rPr') }); }
          else if (n.localName === 'br') raw.push({ t: '\n' });
        });
        if (pi < paras.length - 1) raw.push({ t: '\n' });
      });
      while (raw.length && !raw[raw.length - 1].t.trim()) raw.pop();
      const runs = raw.map((r) => {
        const o = { t: r.t };
        if (r.rPr && r.t.trim()) {
          const st = styleOf(r.rPr);
          if (st.bold !== base.bold) o.b = st.bold;
          if (st.italic !== base.italic) o.i = st.italic;
          if (st.underline !== base.underline) o.u = st.underline;
          if (st.color !== base.color) o.c = st.color;
          if (st.size !== base.size) o.sz = st.size;
          if (st.font !== base.font) o.f = st.font;
        }
        return o;
      });
      const mixed = runs.some((r) => ['b', 'i', 'u', 'c', 'sz', 'f'].some((k) => r[k] !== undefined));
      return {
        text: runs.map((r) => r.t).join('').slice(0, 5000),
        ...(mixed ? { runs: mergeRuns(runs) } : {}),
        size: base.size, bold: base.bold, italic: base.italic, underline: base.underline, color: base.color, font: base.font,
        align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left',
        valign,
        list: listVotes > textParas / 2 ? (first.kind === 'number' ? 'number' : 'bullet') : 'none',
      };
    }

    // ---------- Formen ----------
    function boxOf(xfrm, tf) {
      const off = kid(xfrm, 'off'); const ext = kid(xfrm, 'ext');
      if (!off || !ext) return null;
      const x0 = num(attr(off, 'x')); const y0 = num(attr(off, 'y')); const w0 = num(attr(ext, 'cx')); const h0 = num(attr(ext, 'cy'));
      return {
        x: px(offX + (tf.tx + tf.sx * x0) * k), y: px(offY + (tf.ty + tf.sy * y0) * k),
        w: Math.max(4, px(w0 * tf.sx * k)), h: Math.max(4, px(h0 * tf.sy * k)),
      };
    }
    const strokeOf = (spPr, styleEl, c) => {
      const ln = kid(spPr, 'ln');
      let width = ln && attr(ln, 'w') ? num(attr(ln, 'w')) : null;
      let col = null; let none = false;
      if (ln) { if (kid(ln, 'noFill')) none = true; else { const f = kid(ln, 'solidFill'); col = f && readColor(f, c); } }
      if (!ln || (!col && !none)) {
        const ref = styleEl && kid(styleEl, 'lnRef');
        if (ref && num(attr(ref, 'idx')) > 0 && !none) { col = col || readColor(ref, c); width = width || 12700; }
      }
      if (none || !col) return { stroke: 'none', strokeWidth: 0 };
      return { stroke: col.hex, strokeWidth: Math.min(40, Math.max(1, Math.round((width || 12700) * k))) };
    };

    async function shapeToElements(sp, partPath, chain, tf, c, out) {
      const ph = phOf(sp);
      const spPr = kid(sp, 'spPr');
      let xfrm = kid(spPr, 'xfrm');
      if (!xfrm) { for (const ch of chain) { const x = ch && path(ch, 'spPr', 'xfrm'); if (x) { xfrm = x; break; } } }
      const box = xfrm && boxOf(xfrm, ph && !kid(spPr, 'xfrm') ? { sx: 1, sy: 1, tx: 0, ty: 0 } : tf);
      if (!box) return;
      const style = kid(sp, 'style');
      const isTextBox = attr(path(sp, 'nvSpPr', 'cNvSpPr'), 'txBox') === '1';
      const geom = attr(path(spPr, 'prstGeom'), 'prst') || 'rect';
      const fill = readFill(spPr, c);
      const stroke = strokeOf(spPr, style, c);

      // Bildfüllung → Bild
      if (fill && fill.kind === 'image' && fill.embed) {
        const up = await imageFor(partPath, fill.embed, fill.crop);
        out.push(up ? { type: 'image', ...box, src: up.url, fit: 'cover', radius: 0 } : { type: 'placeholder', ...box, label: 'Bild nicht übernommen', radius: 8 });
        return;
      }
      let fillColor = 'none';
      if (fill && fill.kind !== 'none') fillColor = fill.color;
      else if (!fill && style) { const ref = kid(style, 'fillRef'); if (ref && num(attr(ref, 'idx')) > 0) { const cc = readColor(ref, c); if (cc) fillColor = cc.hex; } }
      const text = readText(sp, ph, chain, isTextBox);
      const visible = fillColor !== 'none' || stroke.stroke !== 'none';
      const lineOnly = /line|Connector/i.test(geom);
      if (lineOnly) {
        const t = Math.max(2, stroke.strokeWidth || 2);
        if (stroke.stroke === 'none') return;
        if (box.h <= t * 3) out.push({ type: 'shape', kind: 'rect', ...box, h: t, y: px(box.y + box.h / 2 - t / 2), fill: stroke.stroke, stroke: 'none', strokeWidth: 0, radius: 0, text: '' });
        else if (box.w <= t * 3) out.push({ type: 'shape', kind: 'rect', ...box, w: t, x: px(box.x + box.w / 2 - t / 2), fill: stroke.stroke, stroke: 'none', strokeWidth: 0, radius: 0, text: '' });
        else note('Schräge Linien werden nicht übernommen.');
        return;
      }
      if (!visible && !text) return;
      if (!visible && text) {
        out.push({ type: 'text', ...box, ...text, fill: 'none' });
        return;
      }
      const kind = /ellipse|oval|circle/i.test(geom) ? 'ellipse' : /triangle/i.test(geom) ? 'triangle' : 'rect';
      let radius = 0;
      if (/roundRect/i.test(geom)) {
        const gd = kids(path(spPr, 'prstGeom', 'avLst'), 'gd').find((g) => attr(g, 'name') === 'adj');
        const adj = gd ? num(String(attr(gd, 'fmla')).replace(/[^0-9.-]/g, '')) : 16667;
        radius = Math.round(Math.min(box.w, box.h) * Math.min(50000, adj) / 100000);
      }
      if (!['rect', 'roundRect', 'ellipse', 'triangle', 'isosTriangle', 'rtTriangle', 'flowChartProcess'].includes(geom) && !/ellipse|oval|circle|triangle/i.test(geom)) note('Einige Spezialformen (Pfeile, Sterne …) wurden als Rechteck übernommen.');
      out.push({
        type: 'shape', kind, ...box, fill: fillColor, stroke: stroke.stroke, strokeWidth: stroke.strokeWidth, radius,
        ...(text || { text: '', size: 24, color: 'auto', font: 'sans', align: 'center', valign: 'middle', bold: false, italic: false, underline: false, list: 'none' }),
      });
    }

    async function pictureToElements(pic, partPath, tf, c, out) {
      const xfrm = path(pic, 'spPr', 'xfrm');
      const box = xfrm && boxOf(xfrm, tf);
      if (!box) return;
      const bf = kid(pic, 'blipFill');
      const blip = bf && kid(bf, 'blip');
      const embed = blip && (attr(blip, 'embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed'));
      const up = embed ? await imageFor(partPath, embed, readCrop(bf)) : null;
      out.push(up ? { type: 'image', ...box, src: up.url, fit: 'cover', radius: 0 } : { type: 'placeholder', ...box, label: 'Bild nicht übernommen', radius: 8 });
    }

    function tableToElement(frame, tf, c, out) {
      const tbl = desc(frame, 'tbl')[0];
      const xfrm = kid(frame, 'xfrm');
      const box = xfrm && boxOf(xfrm, tf);
      if (!tbl || !box) return;
      const rows = kids(tbl, 'tr').slice(0, 30).map((tr) => kids(tr, 'tc').slice(0, 10).map((tc) => kids(path(tc, 'txBody') || tc, 'p').map((p) => desc(p, 't').map((t) => t.textContent).join('')).join('\n').trim().slice(0, 500)));
      if (!rows.length) return;
      const cols = Math.max(...rows.map((r) => r.length));
      rows.forEach((r) => { while (r.length < cols) r.push(''); });
      if (kids(tbl, 'tr').length > 30 || kids(kids(tbl, 'tr')[0], 'tc').length > 10) note('Sehr große Tabellen wurden auf 30 Zeilen und 10 Spalten gekürzt.');
      const firstRun = desc(tbl, 'rPr')[0];
      const sizePt = firstRun && attr(firstRun, 'sz') ? num(attr(firstRun, 'sz')) / 100 : 18;
      const header = attr(kid(tbl, 'tblPr'), 'firstRow') === '1';
      const headFill = header && (() => { const cell = kid(kid(tbl, 'tr'), 'tc'); const f = readFill(path(cell, 'tcPr'), c); return f && f.kind === 'solid' ? f.color : null; })();
      out.push({
        type: 'table', ...box, rows, header, zebra: attr(kid(tbl, 'tblPr'), 'bandRow') === '1', size: Math.min(120, Math.max(8, Math.round(sizePt * ptUnit))),
        color: 'auto', align: 'left', font: 'sans', headFill: headFill || ctx.scheme('accent1') || '#4f6cf5', headColor: '#ffffff', border: '#cbd2ee',
      });
    }

    async function walk(tree, partPath, chainFor, tf, c, out) {
      for (const n of kids(tree)) {
        if (out.length >= MAX_ELEMENTS) { note('Pro Folie werden höchstens 300 Elemente übernommen.'); return; }
        if (n.localName === 'sp') {
          const ph = phOf(n);
          await shapeToElements(n, partPath, ph ? chainFor(ph) : [], tf, c, out);
        } else if (n.localName === 'cxnSp') {
          await shapeToElements(n, partPath, [], tf, c, out);
        } else if (n.localName === 'pic') {
          await pictureToElements(n, partPath, tf, c, out);
        } else if (n.localName === 'graphicFrame') {
          const uri = attr(desc(n, 'graphicData')[0], 'uri') || '';
          if (/table/i.test(uri)) tableToElement(n, tf, c, out);
          else {
            const box = kid(n, 'xfrm') && boxOf(kid(n, 'xfrm'), tf);
            if (box) { out.push({ type: 'placeholder', ...box, label: /chart/i.test(uri) ? 'Diagramm nicht übernommen' : /diagram/i.test(uri) ? 'SmartArt nicht übernommen' : 'Objekt nicht übernommen', radius: 8 }); note('Diagramme, SmartArt und eingebettete Objekte werden nicht übernommen (Platzhalter).'); }
          }
        } else if (n.localName === 'grpSp') {
          const x = path(n, 'grpSpPr', 'xfrm');
          const off = kid(x, 'off'); const ext = kid(x, 'ext'); const choff = kid(x, 'chOff'); const chext = kid(x, 'chExt');
          let sub = tf;
          if (off && ext && choff && chext && num(attr(chext, 'cx')) && num(attr(chext, 'cy'))) {
            const rx = num(attr(ext, 'cx')) / num(attr(chext, 'cx')); const ry = num(attr(ext, 'cy')) / num(attr(chext, 'cy'));
            sub = { sx: tf.sx * rx, sy: tf.sy * ry, tx: tf.tx + tf.sx * (num(attr(off, 'x')) - num(attr(choff, 'x')) * rx), ty: tf.ty + tf.sy * (num(attr(off, 'y')) - num(attr(choff, 'y')) * ry) };
          }
          await walk(n, partPath, chainFor, sub, c, out);
        }
      }
    }

    // ---------- Folien ----------
    const slides = [];
    let defaultBg = null;
    for (let i = 0; i < Math.min(slideIds.length, MAX_SLIDES); i++) {
      const slidePath = slideIds[i].target;
      opts.onProgress && opts.onProgress(`Folie ${i + 1} von ${slideIds.length} …`);
      const root = await xml(slidePath);
      const { layout, master } = await layoutAndMaster(slidePath);
      const lr = await relOfType(slidePath, 'slideLayout');
      const mr = lr && await relOfType(lr.target, 'slideMaster');
      const chainFor = (ph) => [findPlaceholder(layout, ph), findPlaceholder(master, ph)];
      const c = ctx;
      let bg = await readBackground(root, slidePath, c);
      if (!bg && layout && lr) bg = await readBackground(layout, lr.target, c);
      if (!bg && master && mr) bg = await readBackground(master, mr.target, c);
      const elements = [];
      const tree = path(root, 'cSld', 'spTree');
      await walk(tree, slidePath, chainFor, { sx: 1, sy: 1, tx: 0, ty: 0 }, c, elements);
      // Notizen
      let notes = '';
      const nr = await relOfType(slidePath, 'notesSlide');
      if (nr) {
        const nd = await xml(nr.target);
        const body = desc(nd, 'sp').find((s) => attr(phOf(s), 'type') === 'body');
        if (body) notes = kids(path(body, 'txBody'), 'p').map((p) => desc(p, 't').map((t) => t.textContent).join('')).join('\n').trim().slice(0, 5000);
      }
      if (!defaultBg) defaultBg = bg;
      slides.push({ id: uid('s'), bg: bg || defaultBg || '#ffffff', notes, transition: 'fade', elements: elements.map((e) => ({ id: uid(), opacity: 1, ...e })) });
    }
    if (slideIds.length > MAX_SLIDES) note(`Es werden höchstens ${MAX_SLIDES} Folien übernommen.`);
    report.slides = slides.length;

    let title = '';
    const core = await xml('docProps/core.xml');
    const t = core && desc(core, 'title')[0];
    if (t) title = t.textContent.trim();
    title = title || String(file.name || 'Importierte Präsentation').replace(/\.pptx$/i, '');
    return { title: title.slice(0, 120), slides, report };
  }

  return { parse };
})();
