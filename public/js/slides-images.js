// Bilder für Folien: im Browser verkleinern (und optional zuschneiden) und zur Präsentation hochladen.
const SlidesImages = (() => {
  // file: Blob/File mit Bildtyp; crop: { l, t, r, b } als Anteile 0–1 (optional). Gibt { url, w, h } zurück.
  async function upload(deckId, file, { maxSide = 1600, crop = null } = {}) {
    const bmp = await createImageBitmap(file).catch(() => null);
    let blob = file;
    let w; let h;
    if (bmp) {
      const c0 = crop || { l: 0, t: 0, r: 0, b: 0 };
      const sx = Math.round(bmp.width * c0.l); const sy = Math.round(bmp.height * c0.t);
      const sw = Math.max(1, Math.round(bmp.width * (1 - c0.l - c0.r))); const sh = Math.max(1, Math.round(bmp.height * (1 - c0.t - c0.b)));
      const k = Math.min(1, maxSide / Math.max(sw, sh));
      w = Math.max(1, Math.round(sw * k)); h = Math.max(1, Math.round(sh * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
      const keepPng = /png|gif|webp/.test(file.type);
      blob = await new Promise((r) => c.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.88));
      if (keepPng && blob.size > 1400000) blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (blob.size > 1450000) blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
    } else { w = 800; h = 450; }
    const res = await fetch(`/api/slides/${deckId}/assets`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Hochladen fehlgeschlagen');
    return { url: body.url, w, h };
  }
  return { upload };
})();
