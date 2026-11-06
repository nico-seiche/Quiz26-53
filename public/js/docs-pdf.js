// PDF-Export für Dokumente im Browser (funktioniert auch auf iPad und in der installierten App, wo der Druckdialog fehlt):
// Das Blatt wird in Bildschirmbreite gerendert (mit Handschrift), an Absatz-/Tabellengrenzen in Seiten geschnitten, auf A4 skaliert und als Bild pro Seite in ein PDF gelegt.
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
  const MY = 40;                 // oberer/unterer Seitenrand (links/rechts kommt vom Rand des Blatts im Editor)

  // editorEl: das .ql-editor-Element; pen: Handschrift (DocsPen.attach), optional; onProgress(text)
  async function exportDoc(title, editorEl, onProgress = () => {}, pen = null) {
    await Promise.all(LIBS.map(load));
    const { jsPDF } = window.jspdf;
    const paper = editorEl.parentElement;                  // das Blatt: gleiche Breite wie auf dem Bildschirm, damit Zeilenumbrüche und Handschrift passen
    const W = Math.round(paper.clientWidth);
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-${W + 400}px;top:0;width:${W}px;background:#fff;pointer-events:none`;
    const holder = document.createElement('div');
    holder.id = 'editor';
    // Das Blatt ist immer weiß mit dunkler Schrift – auch wenn die App im Dunkelmodus läuft
    holder.style.cssText = 'position:relative;background:#fff;color:#1b1d3a;--text:#1b1d3a;--muted:#667085;--border:#e1e5f7;--link:#4338ca;--card:#fff;box-shadow:none;border:0;margin:0;padding:0;width:100%;max-width:none';
    const clone = editorEl.cloneNode(true);
    clone.removeAttribute('contenteditable');
    clone.style.cssText = 'min-height:0;overflow:visible;height:auto;width:100%;box-sizing:border-box';
    holder.appendChild(clone);
    stage.appendChild(holder);
    document.body.appendChild(stage);
    try {
      await Promise.all([...stage.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const total = Math.ceil(holder.scrollHeight);
      if (pen && pen.strokes().length) pen.paintInto(holder, W, total, 2);
      const scale = PAGE_W / W;
      const SH = (PAGE_H - 2 * MY) / scale;                // Höhe eines Seitenausschnitts in Blatt-Pixeln
      // Seitenumbrüche: an Blockgrenzen (Absatz, Liste, Tabelle …), nur zu hohe Blöcke werden mitten durchgeschnitten
      const top = holder.getBoundingClientRect().top;
      const blocks = [...clone.children].map((el) => { const r = el.getBoundingClientRect(); return { a: Math.round(r.top - top), b: Math.round(r.bottom - top) }; });
      const cuts = [0];
      let start = 0;
      while (start < total - 1) {
        const limit = start + SH;
        if (limit >= total) { cuts.push(total); break; }
        const fits = blocks.filter((x) => x.b <= limit && x.b > start + 40);
        const end = fits.length ? fits[fits.length - 1].b : limit;      // letzter Block, der noch ganz auf die Seite passt
        cuts.push(end);
        start = end;
      }
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H], compress: true, hotfixes: ['px_scaling'] });
      for (let i = 0; i < cuts.length - 1; i++) {
        onProgress(`Seite ${i + 1} von ${cuts.length - 1} …`);
        const y0 = cuts[i];
        const h = cuts[i + 1] - y0;
        const canvas = await window.html2canvas(holder, { scale: 2, x: 0, y: y0, width: W, height: h, windowWidth: W + 400, backgroundColor: '#ffffff', useCORS: true, logging: false });
        if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, MY, PAGE_W, h * scale, undefined, 'FAST');
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
