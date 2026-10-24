// Vorlesen mit der Stimme des Geräts (Web Speech API). Kein Server, keine Cloud:
// Die Stimme stammt aus dem Handy bzw. Browser, die Qualität hängt davon ab.
const Speech = (() => {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let run = 0;   // wird bei cancel() erhöht, damit abgebrochene Wiedergaben sauber enden

  // Abkürzungen und Paragrafen so schreiben, wie man sie spricht (sonst liest die Stimme "Abs." oder "§" falsch vor)
  const SPOKEN = [
    [/§§/g, 'Paragrafen'], [/§/g, 'Paragraf'],
    [/\bAbs\.\s*/g, 'Absatz '], [/\bS\.\s*(?=\d)/g, 'Satz '], [/\bNr\.\s*/g, 'Nummer '], [/\bArt\.\s*/g, 'Artikel '],
    [/\bz\.\s?B\./g, 'zum Beispiel'], [/\bd\.\s?h\./g, 'das heißt'], [/\bu\.\s?a\./g, 'unter anderem'],
    [/\bi\.\s?V\.\s?m\./g, 'in Verbindung mit'], [/\bggf\./g, 'gegebenenfalls'], [/\bbzw\./g, 'beziehungsweise'],
    [/\busw\./g, 'und so weiter'], [/\bvgl\./g, 'vergleiche'], [/\bevtl\./g, 'eventuell'], [/\bca\./g, 'circa'],
    [/\(\?\)/g, ''], [/\s*\/\s*/g, ' oder '],
  ];
  // Gesetzes- und Behördenkürzel werden buchstabiert ("S T G B"), sonst sprechen die Stimmen sie als Wort
  const ACRONYM = /\b(?:StGB|StPO|StVO|StVG|PolG|BeamtStG|BeamtVG|VwGO|VwVfG|OWiG|BVerfG|BVerwG|BGB|EMRK|DSGVO|LBG|[A-ZÄÖÜ]{2,6})\b/g;
  function spoken(text) {
    return SPOKEN.reduce((t, [re, to]) => t.replace(re, to), String(text))
      .replace(ACRONYM, (m) => m.split('').join(' '))
      .replace(/\s+/g, ' ').trim();
  }

  // Lange Texte in Sätze zerlegen: manche Browser (v. a. Chrome) brechen längere Äußerungen mittendrin ab
  function chunks(text, max = 180) {
    const out = [];
    for (const sentence of spoken(text).split(/(?<=[.!?;:])\s+/)) {
      const last = out[out.length - 1];
      if (last && (last + ' ' + sentence).length <= max) out[out.length - 1] = last + ' ' + sentence;
      else out.push(sentence);
    }
    return out.flatMap((c) => (c.length <= max * 1.5 ? [c] : c.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) || [c]));
  }

  function voices() {
    if (!supported) return [];
    return speechSynthesis.getVoices().filter((v) => /^de\b|^de[-_]/i.test(v.lang))
      // Hochwertige Stimmen (Premium/Enhanced/Natural/Google) zuerst
      .sort((a, b) => quality(b) - quality(a) || a.name.localeCompare(b.name));
  }
  const quality = (v) => (/premium|enhanced|natural|neural|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 0.5);

  function pickVoice() {
    const list = voices();
    return list.find((v) => v.voiceURI === store.get('speech-voice', '')) || list[0] || null;
  }

  // --- Natürliche Stimme: Piper (Open Source) läuft per WebAssembly im Browser, ohne Server ---
  // Die Stimme (ca. 60 MB) wird einmal geladen und im Gerät gespeichert. Bibliothek und Laufzeit kommen von CDNs.
  const PIPER_LIB = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
  const PIPER_VOICES = [
    { id: 'de_DE-thorsten-medium', label: 'Thorsten (männlich, beste Qualität)' },
    { id: 'de_DE-ramona-low', label: 'Ramona (weiblich)' },
    { id: 'de_DE-kerstin-low', label: 'Kerstin (weiblich)' },
  ];
  let piperLib = null;
  let piperChain = Promise.resolve();   // Berechnungen nacheinander, das Handy würde parallel nur langsamer
  const audioMem = new Map();

  const engine = () => store.get('speech-engine', 'device');            // 'device' oder Piper-Stimmen-ID
  const setEngine = (e) => store.set('speech-engine', e);
  const usingPiper = () => engine() !== 'device' && piperSupported();
  function piperSupported() {
    return typeof window !== 'undefined' && 'WebAssembly' in window && !!navigator.storage?.getDirectory && 'Audio' in window;
  }

  async function lib() {
    piperLib = piperLib || import(PIPER_LIB);
    return piperLib;
  }
  async function piperReady(id) {
    return (await (await lib()).stored()).includes(id);
  }
  // Stimme herunterladen; progress(geladen, gesamt) in Bytes
  async function piperLoad(id, progress) {
    const l = await lib();
    try { await navigator.storage.persist?.(); } catch {}
    await l.download(id, (p) => progress && progress(p.loaded, p.total));
  }

  async function hash(text) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Erzeugt (oder holt aus dem Zwischenspeicher) die Audiodatei zu einem Textstück
  async function piperAudio(text, id) {
    const key = `${id}:${text}`;
    if (audioMem.has(key)) return audioMem.get(key);
    const prev = piperChain;   // vorherige Berechnung: erst wenn sie fertig ist, kommt diese dran
    const job = (async () => {
      const url = `/__piper/${id}/${await hash(text)}`;
      try {
        const cache = await caches.open('piper-audio-v1');
        const hit = await cache.match(url);
        if (hit) return await hit.blob();
      } catch {}
      await prev;
      const blob = await (await lib()).predict({ text, voiceId: id });
      try { (await caches.open('piper-audio-v1')).put(url, new Response(blob)); } catch {}
      return blob;
    })();
    piperChain = job.catch(() => {});
    audioMem.set(key, job);
    job.catch(() => audioMem.delete(key));
    return job;
  }

  let audioEl = null;
  function playBlob(blob, rate) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      audioEl = new Audio(url);
      audioEl.playbackRate = rate;
      const done = () => { URL.revokeObjectURL(url); resolve(); };
      audioEl.onended = audioEl.onerror = audioEl.onpause = done;
      audioEl.play().catch(done);
    });
  }

  const PIPER_CHUNK = 320;

  // Im Hintergrund vorbereiten, damit die nächste Karte ohne Wartezeit startet
  function prefetch(text) {
    if (!usingPiper()) return;
    const id = engine();
    for (const c of chunks(text, PIPER_CHUNK)) piperAudio(c, id).catch(() => {});
  }

  // Liest text vor und wartet, bis er fertig (oder abgebrochen) ist. Löst nie mit Fehler auf.
  function say(text, { rate, onWait } = {}) {
    if (!supported && !usingPiper()) return Promise.resolve();
    const mine = run;
    if (usingPiper()) {
      const id = engine();
      const r = rate || Number(store.get('speech-rate', 1));
      const parts = chunks(text, PIPER_CHUNK);
      const audios = parts.map((c) => piperAudio(c, id));   // alle Teile werden der Reihe nach berechnet
      return parts.reduce((chain, _, i) => chain.then(async () => {
        if (mine !== run) return;
        let blob;
        try {
          if (onWait) onWait(true);
          blob = await audios[i];
        } catch (err) {
          console.warn('piper', err);
          return;
        } finally {
          if (onWait) onWait(false);
        }
        if (mine === run) await playBlob(blob, r);
      }), Promise.resolve());
    }
    return chunks(text).reduce((chain, part) => chain.then(() => new Promise((resolve) => {
      if (mine !== run) return resolve();
      const u = new SpeechSynthesisUtterance(part);
      const voice = pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'de-DE';
      u.rate = rate || Number(store.get('speech-rate', 1));
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    })), Promise.resolve());
  }

  function cancel() {
    run++;
    if (supported) speechSynthesis.cancel();
    if (audioEl) { audioEl.pause(); audioEl = null; }
  }

  // Stimmen werden in manchen Browsern erst verzögert geladen
  function onVoices(fn) {
    if (!supported) return;
    speechSynthesis.addEventListener('voiceschanged', fn);
    fn();
  }

  return {
    supported, say, cancel, voices, pickVoice, onVoices, spoken, chunks, store, current: () => run, prefetch,
    engine, setEngine, piperSupported, piperReady, piperLoad, PIPER_VOICES,
    available: () => supported || piperSupported(),
  };
})();

if (typeof module !== 'undefined') module.exports = Speech;
