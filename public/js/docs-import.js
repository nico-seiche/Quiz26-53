// Word-Dateien (.docx) einlesen: mammoth.js (cdnjs) macht daraus HTML, Bilder werden verkleinert und als Dokument-Bilder hochgeladen.
// Das HTML wandelt der Editor mit Quill in den Dokumenttext um. Nicht übernommen: Kopf-/Fußzeilen, Seitenränder, Textfelder, Formen, Kommentare.
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

  return { docxToHtml };
})();
