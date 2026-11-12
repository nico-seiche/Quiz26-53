// Dateien in Dokumente umwandeln – komplett im Browser. Die Art der Datei erkennt `detect()` am Inhalt (nicht nur an der Endung):
// Word (.docx, mammoth.js), PDF (pdf.js, Text mit Überschriften/Absätzen), PowerPoint (.pptx, Text je Folie), OpenDocument (.odt),
// Text/Markdown/HTML/RTF und Bilder. Bilder in Word-Dateien werden verkleinert und als Dokument-Bilder hochgeladen.
// Das HTML wandelt der Editor mit Quill in den Dokumenttext um (`htmlToOps` für Stellen ohne Editor).
// Nicht übernommen: Kopf-/Fußzeilen, Seitenränder, Textfelder, Formen, Kommentare; bei PDF und PowerPoint nur der Text (keine Bilder, keine Texterkennung bei Scans).
const DocsImport = (() => {
  const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  const MAX_IMAGES = 60;
  let loading = null;
  const loadMammoth = () => loading || (loading = new Promise((ok, fail) => {
    if (window.mammoth) return ok(window.mammoth);
    const s = document.createElement('script');
    s.src = MAMMOTH; s.onload = () => ok(window.mammoth); s.onerror = () => { loading = null; fail(new Error('Word-Leser konnte nicht geladen werden (Internet?)')); };
    document.head.appendChild(s);
  }));

  async function shrink(blob) {
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) return blob.size <= 1450000 ? blob : null;
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const png = /png|gif/.test(blob.type);
    let out = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.88));
    if (out && out.size > 1450000) out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    if (out && out.size > 1450000) out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.6));
    return out && out.size <= 1450000 ? out : null;
  }

  async function upload(docId, blob) {
    const res = await fetch(`/api/docs/${docId}/assets`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Bild konnte nicht hochgeladen werden');
    return body.url;
  }

  // → { html, images, skipped }
  async function docxToHtml(file, docId, progress = () => {}) {
    const mammoth = await loadMammoth();
    const stats = { images: 0, skipped: 0 };
    const styleMap = [3, 4, 5, 6].flatMap((n) => [`p[style-name='Heading ${n}'] => h3:fresh`, `p[style-name='Überschrift ${n}'] => h3:fresh`])
      .concat(["p[style-name='Title'] => h1:fresh", "p[style-name='Titel'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Untertitel'] => h2:fresh", "u => u", "strike => s"]);
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
      styleMap,
      convertImage: mammoth.images.imgElement(async (img) => {
        if (stats.images >= MAX_IMAGES || !/^image\/(png|jpe?g|gif|webp)$/.test(img.contentType)) { stats.skipped += 1; return { src: '' }; }
        try {
          progress(`Bild ${stats.images + 1} …`);
          const raw = new Blob([await img.read()], { type: img.contentType });
          const blob = await shrink(raw);
          if (!blob) { stats.skipped += 1; return { src: '' }; }
          const url = await upload(docId, blob);
          stats.images += 1;
          return { src: url };
        } catch { stats.skipped += 1; return { src: '' }; }
      }),
    });
    return { html: result.value.replace(/<img[^>]*src=""[^>]*>/g, ''), images: stats.images, skipped: stats.skipped };
  }

  // ================= Weitere Dateiarten =================
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const QUILL = 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js';
  const loadScript = (src, test) => new Promise((ok, fail) => {
    if (test()) return ok();
    const el = document.createElement('script');
    el.src = src; el.onload = () => ok(); el.onerror = () => fail(new Error('Ein Hilfsprogramm konnte nicht geladen werden (Internet?)'));
    document.head.appendChild(el);
  });
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Art der Datei: 'pdf' | 'docx' | 'pptx' | 'odt' | 'image' | 'rtf' | 'html' | 'text' | 'xlsx' | 'doc' | 'ppt' | 'unknown'
  async function detect(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const str = (a, b) => String.fromCharCode(...head.slice(a, b));
    if (str(0, 5) === '%PDF-') return 'pdf';
    if (head[0] === 0x50 && head[1] === 0x4b) {            // ZIP: Inhalt entscheidet
      await loadScript(JSZIP, () => window.JSZip);
      try {
        const zip = await window.JSZip.loadAsync(file);
        if (zip.file('word/document.xml')) return 'docx';
        if (zip.file('ppt/presentation.xml')) return 'pptx';
        if (zip.file('xl/workbook.xml')) return 'xlsx';
        if (zip.file('content.xml') && zip.file('mimetype')) return 'odt';
      } catch { /* kein gültiges ZIP */ }
      return 'unknown';
    }
    if (head[0] === 0xd0 && head[1] === 0xcf) return /\.pp[ts]$/i.test(file.name) ? 'ppt' : 'doc';   // alte Office-Dateien
    if (str(0, 5) === '{\\rtf') return 'rtf';
    if (head[0] === 0x89 && str(1, 4) === 'PNG') return 'image';
    if (head[0] === 0xff && head[1] === 0xd8) return 'image';
    if (str(0, 4) === 'GIF8' || (str(0, 4) === 'RIFF' && str(8, 12) === 'WEBP')) return 'image';
    // Text: gültiges UTF-8 ohne Steuerzeichen
    const sample = new Uint8Array(await file.slice(0, 20000).arrayBuffer());
    let bad = 0;
    for (const b of sample) if (b === 0 || (b < 9) || (b > 13 && b < 32)) bad += 1;
    if (!bad) {
      const text = new TextDecoder('utf-8').decode(sample);
      if (/^\s*<(!doctype html|html|head|body|div|p|h1)/i.test(text)) return 'html';
      return 'text';
    }
    return 'unknown';
  }

  // ---------- Text, Markdown, RTF, HTML ----------
  function textToHtml(text) {
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    let para = [];
    const endPara = () => { if (para.length) { out.push(`<p>${esc(para.join(' '))}</p>`); para = []; } };
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      let m;
      if (!line) { endPara(); flush(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { endPara(); flush(); out.push(`<h${Math.min(3, m[1].length)}>${esc(m[2])}</h${Math.min(3, m[1].length)}>`); continue; }
      if ((m = /^[-*•–]\s+(.*)$/.exec(line))) { endPara(); (list = list || []).push(`<li>${esc(m[1])}</li>`); continue; }
      flush(); para.push(line);
    }
    endPara(); flush();
    return out.join('');
  }
  function rtfToText(rtf) {
    let t = rtf.replace(/\{\\\*[^{}]*\}/g, '').replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    t = t.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? Number(n) + 65536 : Number(n)));
    t = t.replace(/\\(par|line|sect)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
    return t;
  }

  // ---------- OpenDocument (.odt) ----------
  async function odtToHtml(file) {
    await loadScript(JSZIP, () => window.JSZip);
    const zip = await window.JSZip.loadAsync(file);
    const xml = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
    const body = xml.getElementsByTagName('office:text')[0];
    const out = [];
    const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const walk = (el) => {
      for (const c of el.children) {
        if (c.tagName === 'text:h') { const lvl = Math.min(3, Number(c.getAttribute('text:outline-level')) || 1); if (txt(c)) out.push(`<h${lvl}>${esc(txt(c))}</h${lvl}>`); }
        else if (c.tagName === 'text:p') { if (txt(c)) out.push(`<p>${esc(txt(c))}</p>`); }
        else if (c.tagName === 'text:list') out.push(`<ul>${[...c.querySelectorAll('text\\:p, p')].map((p) => `<li>${esc(txt(p))}</li>`).join('')}</ul>`);
        else if (c.children.length) walk(c);
      }
    };
    if (body) walk(body);
    return out.join('');
  }

  // ---------- PowerPoint (.pptx): Text je Folie ----------
  async function pptxToHtml(file, progress) {
    await loadScript(JSZIP, () => window.JSZip);
    const zip = await window.JSZip.loadAsync(file);
    const nums = Object.keys(zip.files).map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
    const out = [];
    const paras = (root) => [...root.getElementsByTagName('a:p')].map((p) => ({ text: [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('').trim(), lvl: Number((p.getElementsByTagName('a:pPr')[0] || { getAttribute: () => 0 }).getAttribute('lvl')) || 0 })).filter((p) => p.text);
    for (const n of nums) {
      progress && progress(`Folie ${n} von ${nums.length} …`);
      const doc = new DOMParser().parseFromString(await zip.file(`ppt/slides/slide${n}.xml`).async('string'), 'application/xml');
      let title = '';
      const rest = [];
      for (const sp of [...doc.getElementsByTagName('p:sp'), ...doc.getElementsByTagName('p:graphicFrame')]) {
        const ph = sp.getElementsByTagName('p:ph')[0];
        const type = ph && ph.getAttribute('type');
        const ps = paras(sp);
        if (!ps.length) continue;
        if (!title && (type === 'title' || type === 'ctrTitle')) title = ps.map((p) => p.text).join(' ');
        else rest.push(...ps);
      }
      out.push(`<h2>${esc(title || `Folie ${n}`)}</h2>`);
      if (rest.length) out.push(`<ul>${rest.map((p) => `<li${p.lvl ? ` class="ql-indent-${Math.min(p.lvl, 3)}"` : ''}>${esc(p.text)}</li>`).join('')}</ul>`);
      const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
      if (notesFile) {
        const notes = paras(new DOMParser().parseFromString(await notesFile.async('string'), 'application/xml')).map((p) => p.text).filter((t) => !/^\d+$/.test(t));
        if (notes.length) out.push(`<p><em>Notizen: ${esc(notes.join(' '))}</em></p>`);
      }
    }
    return out.join('');
  }

  // ---------- PDF: Text mit Überschriften und Absätzen ----------
  async function pdfToHtml(file, progress) {
    await loadScript(PDFJS, () => window.pdfjsLib);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      progress && progress(`Seite ${i} von ${pdf.numPages} …`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      try { await page.getOperatorList(); } catch { /* Schriftnamen sind dann nicht verfügbar */ }   // lädt die Schriften, damit „fett“ erkennbar ist
      const boldFont = (name) => { try { const f = page.commonObjs.get(name); return Boolean(f && (f.bold || /bold|black|heavy|semibold|demi/i.test(`${f.name || ''} ${f.fallbackName || ''}`))); } catch { return false; } };
      // Zeilen bilden: gleiche Höhe (y) = eine Zeile
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], size: Math.abs(it.transform[3]) || it.height || 10, w: it.width, bold: boldFont(it.fontName) }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        const ln = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.35));
        if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      pages.push({ height: vp.height, lines: lines.map((l) => {
        l.items.sort((a, b) => a.x - b.x);
        let text = '';
        let end = null;
        for (const it of l.items) { if (end !== null && it.x - end > it.size * 0.15 && !/\s$/.test(text)) text += ' '; text += it.s; end = it.x + it.w; }
        const size = l.items.reduce((m, it) => Math.max(m, it.size), 0);
        return { text: text.replace(/\s+/g, ' ').trim(), y: l.y, size, x: l.items[0].x, bold: l.items.every((it) => it.bold || !it.s.trim()) };
      }).filter((l) => l.text) });
    }
    // Normale Schriftgröße = häufigste; wiederkehrende Kopf-/Fußzeilen und Seitenzahlen entfernen
    const hist = new Map();
    pages.forEach((pg) => pg.lines.forEach((l) => { const k = Math.round(l.size); hist.set(k, (hist.get(k) || 0) + l.text.length); }));
    const body = [...hist.entries()].sort((a, b) => b[1] - a[1])[0] ? [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0] : 11;
    const seen = new Map();
    pages.forEach((pg) => pg.lines.forEach((l) => { if (l.y > pg.height * 0.9 || l.y < pg.height * 0.1) { const k = l.text.replace(/\d+/g, '#'); seen.set(k, (seen.get(k) || 0) + 1); } }));
    const repeated = (l, pg) => (l.y > pg.height * 0.9 || l.y < pg.height * 0.1) && (/^(seite\s*)?\d{1,3}(\s*\/\s*\d+)?$/i.test(l.text) || (pages.length > 3 && seen.get(l.text.replace(/\d+/g, '#')) >= Math.max(3, pages.length * 0.5)));
    const out = [];
    let chars = 0;
    let para = [];
    let list = null;
    let prev = null;
    const endPara = () => { if (para.length) { out.push(`<p>${esc(para.join(' '))}</p>`); para = []; } };
    const endList = () => { if (list) { out.push(`<ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`); list = null; } };
    for (const pg of pages) {
      prev = null;
      for (const l of pg.lines) {
        if (repeated(l, pg)) continue;
        chars += l.text.length;
        const gap = prev ? prev.y - l.y : 0;
        const big = (l.size >= body * 1.22 && l.text.length <= 140) || (l.bold && l.text.length <= 110 && !/[.;,:]$/.test(l.text));
        const bullet = /^[•▪●◦‣∙·\-–—]\s+(.+)$/.exec(l.text) || /^\(?[a-z0-9]{1,2}[.)]\s+(.+)$/.exec(l.text);
        if (big) {
          endPara(); endList();
          const lv = l.size >= body * 1.5 ? 1 : l.size >= body * 1.22 ? 2 : 3;
          out.push(`<h${lv}>${esc(l.text)}</h${lv}>`);
        } else if (bullet && /^[•▪●◦‣∙·\-–—]|^\(?\d{1,2}[.)]/.test(l.text)) {
          endPara();
          (list = list || []).push(bullet[1]);
        } else {
          if (list && gap < body * 2 && l.x > (prev ? prev.x : 0) - 1 && prev && prev.bullet) { list[list.length - 1] += ` ${l.text}`; }
          else {
            endList();
            if (para.length && (gap > body * 1.9 || (prev && prev.big))) endPara();
            const last = para[para.length - 1];
            if (last && /[a-zäöüß]-$/.test(last)) para[para.length - 1] = last.slice(0, -1) + l.text;   // Silbentrennung am Zeilenende
            else para.push(l.text);
          }
        }
        prev = { y: l.y, x: l.x, size: l.size, bold: l.bold, big, bullet: Boolean(bullet) };
      }
      endPara(); endList();
    }
    endPara(); endList();
    if (chars < 40 * Math.max(1, pages.length) * 0.25) throw new Error('In dieser PDF-Datei ist kein Text enthalten (vermutlich ein Scan). Texterkennung gibt es noch nicht.');
    return out.join('');
  }

  // ---------- Bild ----------
  async function imageToHtml(file, docId) {
    const blob = await shrink(file);
    if (!blob) throw new Error('Das Bild ist zu groß.');
    return `<p><img src="${await upload(docId, blob)}"></p>`;
  }

  const KINDS = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', odt: 'OpenDocument', image: 'Bild', rtf: 'RTF', html: 'HTML', text: 'Text' };
  // Beliebige Datei → { html, kind, images, skipped }
  async function fileToHtml(file, docId, progress = () => {}) {
    const kind = await detect(file);
    if (kind === 'docx') return { ...(await docxToHtml(file, docId, progress)), kind };
    let html;
    if (kind === 'pdf') html = await pdfToHtml(file, progress);
    else if (kind === 'pptx') html = await pptxToHtml(file, progress);
    else if (kind === 'odt') html = await odtToHtml(file);
    else if (kind === 'image') html = await imageToHtml(file, docId);
    else if (kind === 'rtf') html = textToHtml(rtfToText(await file.text()));
    else if (kind === 'html') { const d = new DOMParser().parseFromString(await file.text(), 'text/html'); d.querySelectorAll('script,style,iframe,object').forEach((n) => n.remove()); html = d.body.innerHTML; }
    else if (kind === 'text') html = textToHtml(await file.text());
    else if (kind === 'xlsx') throw new Error('Excel-Tabellen kann ich noch nicht lesen – bitte als PDF oder Word-Datei speichern.');
    else if (kind === 'doc' || kind === 'ppt') throw new Error(`Das ist eine alte Office-Datei (.${kind}). Bitte in Word/PowerPoint als ${kind === 'doc' ? '.docx' : '.pptx'} oder PDF speichern.`);
    else throw new Error('Diese Dateiart kenne ich nicht. Möglich sind Word, PDF, PowerPoint, Text, Markdown, HTML, RTF, OpenDocument und Bilder.');
    if (!String(html).replace(/<[^>]+>/g, '').trim() && kind !== 'image') throw new Error('In der Datei habe ich keinen Text gefunden.');
    return { html, kind, images: kind === 'image' ? 1 : 0, skipped: 0 };
  }

  // HTML → Quill-Delta (ohne sichtbaren Editor) für Stellen, an denen kein Dokument-Editor offen ist
  let quillReady = null;
  async function htmlToOps(html) {
    await loadScript(QUILL, () => window.Quill);
    if (!quillReady) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px';
      document.body.appendChild(host);
      quillReady = new window.Quill(host, { modules: { toolbar: false, table: true }, formats: ['bold', 'italic', 'underline', 'strike', 'header', 'blockquote', 'list', 'indent', 'link', 'image', 'table', 'script'] });
    }
    return quillReady.clipboard.convert({ html }).ops;
  }

  return { docxToHtml, fileToHtml, htmlToOps, detect, KINDS };
})();
