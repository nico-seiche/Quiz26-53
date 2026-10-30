// PDF-Export im Browser: jede Folie wird mit dem gleichen Renderer wie die Präsentation gezeichnet, als Bild abgelegt und
// zu einem PDF zusammengesetzt (eine Folie pro Seite, 16:9). Die Bibliotheken werden erst beim ersten Export geladen.
const SlidesPdf = (() => {
  const LIBS = [
    ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
    ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
  ];
  const loaded = {};
  function load(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Der PDF-Export konnte nicht geladen werden (keine Verbindung?)'));
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  const safeName = (t) => (String(t || 'Praesentation').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Praesentation').slice(0, 80);

  // deck: { title, data: { slides } }; onProgress(done, total)
  async function exportDeck(deck, onProgress) {
    await Promise.all(LIBS.map(([, src]) => load(src)));
    const slides = deck.data.slides;
    const { jsPDF } = window.jspdf;
    const W = SlideRender.W;
    const H = SlideRender.H;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H], compress: true, hotfixes: ['px_scaling'] });
    // Die Folie liegt unsichtbar außerhalb des Bildschirms, in Originalgröße
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-${W + 200}px;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none`;
    document.body.appendChild(stage);
    try {
      for (let i = 0; i < slides.length; i++) {
        onProgress && onProgress(i, slides.length);
        const el = SlideRender.slideEl(slides[i], { present: true });
        stage.replaceChildren(el);
        await Promise.all([...el.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const canvas = await window.html2canvas(el, { scale: 1.5, width: W, height: H, backgroundColor: '#ffffff', useCORS: true, logging: false });
        if (i > 0) pdf.addPage([W, H], 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H, undefined, 'FAST');
        canvas.width = 0; canvas.height = 0;     // Speicher freigeben (iPad)
      }
      onProgress && onProgress(slides.length, slides.length);
      const url = URL.createObjectURL(pdf.output('blob'));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(deck.title)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      stage.remove();
    }
  }
  return { exportDeck };
})();
