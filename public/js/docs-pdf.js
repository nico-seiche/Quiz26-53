// PDF-Export für Dokumente im Browser (funktioniert auch auf iPad und in der installierten App, wo der Druckdialog fehlt):
// Der Dokumenttext wird in A4-Breite gerendert, an Absatz-/Tabellengrenzen in Seiten geschnitten und als Bild pro Seite in ein PDF gelegt.
// Der Text ist im PDF kein auswählbarer Text, sondern ein Bild (scharf, 2-fache Auflösung).
const DocsPdf = (() => {
  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  ];
  const loaded = {};
  const load = (src) => loaded[src] || (loaded[src] = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; fail(new Error('Der PDF-Export konnte nicht geladen werden (keine Verbindung?)')); };
    document.head.appendChild(s);
  }));
  const safeName = (t) => (String(t || 'Dokument').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Dokument').slice(0, 80);

  const PAGE_W = 794;            // A4 bei 96 dpi
  const PAGE_H = 1123;
  const MX = 64;                 // Seitenränder
  const MY = 56;
  const BODY_W = PAGE_W - 2 * MX;
  const BODY_H = PAGE_H - 2 * MY;

  // editorEl: das .ql-editor-Element; onProgress(text)
  async function exportDoc(title, editorEl, onProgress = () => {}) {
    await Promise.all(LIBS.map(load));
    const { jsPDF } = window.jspdf;
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-${BODY_W + 400}px;top:0;width:${BODY_W}px;background:#fff;pointer-events:none`;
    const holder = document.createElement('div');
    holder.id = 'editor';
    holder.style.cssText = 'background:#fff;box-shadow:none;border:0;margin:0;padding:0;width:100%;max-width:none';
    const clone = editorEl.cloneNode(true);
    clone.removeAttribute('contenteditable');
    clone.style.cssText = 'padding:0;min-height:0;overflow:visible;height:auto;width:100%';
    clone.querySelectorAll('.ql-ink').forEach((n) => n.remove());
    holder.appendChild(clone);
    stage.appendChild(holder);
    document.body.appendChild(stage);
    try {
      await Promise.all([...stage.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Seitenumbrüche: an Blockgrenzen (Absatz, Liste, Tabelle …), nur zu hohe Blöcke werden mitten durchgeschnitten
      const top = stage.getBoundingClientRect().top;
      const total = Math.ceil(stage.scrollHeight);
      const blocks = [...clone.children].map((el) => { const r = el.getBoundingClientRect(); return { a: Math.round(r.top - top), b: Math.round(r.bottom - top) }; });
      const cuts = [0];
      let start = 0;
      while (start < total - 1) {
        const limit = start + BODY_H;
        if (limit >= total) { cuts.push(total); break; }
        const fits = blocks.filter((x) => x.b <= limit && x.b > start + 40);
        let end = fits.length ? fits[fits.length - 1].b : limit;      // letzter Block, der noch ganz auf die Seite passt
        if (!fits.length) end = limit;
        cuts.push(end);
        start = end;
      }
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H], compress: true, hotfixes: ['px_scaling'] });
      for (let i = 0; i < cuts.length - 1; i++) {
        onProgress(`Seite ${i + 1} von ${cuts.length - 1} …`);
        const y0 = cuts[i];
        const h = cuts[i + 1] - y0;
        const canvas = await window.html2canvas(stage, { scale: 2, x: 0, y: y0, width: BODY_W, height: h, windowWidth: BODY_W + 400, backgroundColor: '#ffffff', useCORS: true, logging: false });
        if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', MX, MY, BODY_W, h, undefined, 'FAST');
        canvas.width = 0; canvas.height = 0;       // Speicher freigeben (iPad)
      }
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(title)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return cuts.length - 1;
    } finally {
      stage.remove();
    }
  }
  return { exportDoc };
})();
