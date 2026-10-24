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
  // Die Stimme (ca. 60 MB) wird einmal geladen und im Gerät gespeichert. Der Code liegt in piper.js, Laufzeit und Phonemizer kommen von CDNs.
  const PIPER_VOICES = [
    { id: 'de_DE-thorsten-medium', label: 'Thorsten (männlich, beste Qualität)' },
    { id: 'de_DE-ramona-low', label: 'Ramona (weiblich)' },
    { id: 'de_DE-kerstin-low', label: 'Kerstin (weiblich)' },
  ];
  let piperChain = Promise.resolve();   // Berechnungen nacheinander, das Handy würde parallel nur langsamer
  const audioMem = new Map();

  const engine = () => store.get('speech-engine', 'device');            // 'device' oder Piper-Stimmen-ID
  const setEngine = (e) => store.set('speech-engine', e);
  const usingPiper = () => engine() !== 'device' && piperSupported();
  function piperSupported() {
    return typeof window !== 'undefined' && typeof Piper !== 'undefined' && 'WebAssembly' in window && 'caches' in window && 'Audio' in window;
  }
  const piperReady = (id) => Piper.ready(id);
  const piperLoad = (id, progress) => Piper.load(id, progress);

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
      const blob = await Piper.synth(text, id);
      try { (await caches.open('piper-audio-v1')).put(url, new Response(blob)); } catch {}
      return blob;
    })();
    piperChain = job.catch(() => {});
    audioMem.set(key, job);
    job.catch(() => audioMem.delete(key));
    return job;
  }

  // Ein einziges <audio>-Element für alles: Handys erlauben Wiedergabe nur, wenn es per Fingertipp "freigeschaltet" wurde.
  // Würde man pro Stück ein neues Element anlegen, wird es nach dem Rechnen (ohne Tipp) blockiert und die Wiedergabe bricht ab.
  const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  let audioEl = null;
  let endPlayback = null;   // beendet die laufende Wiedergabe (für cancel)
  function audio() {
    if (!audioEl) { audioEl = new Audio(); audioEl.preload = 'auto'; }
    return audioEl;
  }
  // Aus einem Klick-/Tipp-Handler aufrufen, bevor etwas Asynchrones passiert
  function unlock() {
    if (!piperSupported()) return;
    const a = audio();
    if (a.dataset.unlocked) return;
    a.src = SILENCE;
    a.play().then(() => { a.dataset.unlocked = '1'; a.pause(); }).catch(() => {});
  }

  // Spielt eine Audiodatei ab. Ergebnis: 'ok', 'cancelled' oder 'blocked' (Browser verweigert die Wiedergabe)
  function playBlob(blob, rate) {
    return new Promise((resolve) => {
      const a = audio();
      const url = URL.createObjectURL(blob);
      let timer = null;
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        a.onended = a.onerror = a.onloadedmetadata = null;
        endPlayback = null;
        URL.revokeObjectURL(url);
        resolve(result);
      };
      endPlayback = () => { a.pause(); finish('cancelled'); };
      a.onended = () => finish('ok');
      a.onerror = () => finish('error');
      // Sicherheitsnetz: bleibt das Ende-Ereignis aus, geht es nach der erwarteten Dauer trotzdem weiter
      a.onloadedmetadata = () => { if (a.duration) timer = setTimeout(() => finish('ok'), (a.duration / rate) * 1000 + 4000); };
      a.src = url;
      a.playbackRate = rate;
      a.play().catch((err) => finish(err && err.name === 'NotAllowedError' ? 'blocked' : 'error'));
    });
  }

  const PIPER_CHUNK = 320;

  // Im Hintergrund vorbereiten, damit die nächste Karte ohne Wartezeit startet
  function prefetch(text) {
    if (!usingPiper()) return;
    const id = engine();
    for (const c of chunks(text, PIPER_CHUNK)) piperAudio(c, id).catch(() => {});
  }

  // Liest text vor und wartet, bis er fertig ist. Ergebnis: 'ok', 'cancelled', 'blocked' oder 'error' (löst nie mit Fehler auf).
  const utterances = [];   // Referenzen halten: Chrome verwirft sonst laufende Äußerungen und "onend" kommt nie an
  function say(text, { rate, onWait } = {}) {
    if (!supported && !usingPiper()) return Promise.resolve('error');
    const mine = run;
    const r = rate || Number(store.get('speech-rate', 1));
    if (usingPiper()) {
      const id = engine();
      const parts = chunks(text, PIPER_CHUNK);
      const audios = parts.map((c) => piperAudio(c, id));   // alle Teile werden der Reihe nach berechnet
      audios.forEach((p) => p.catch(() => {}));
      return parts.reduce((chain, _, i) => chain.then(async (state) => {
        if (state !== 'ok' || mine !== run) return mine !== run ? 'cancelled' : state;
        let blob;
        try {
          if (onWait) onWait(true);
          blob = await audios[i];
        } catch (err) {
          console.warn('piper', err);
          return 'error';
        } finally {
          if (onWait) onWait(false);
        }
        return mine === run ? playBlob(blob, r) : 'cancelled';
      }), Promise.resolve('ok'));
    }
    return chunks(text, 140).reduce((chain, part) => chain.then((state) => new Promise((resolve) => {
      if (state !== 'ok' || mine !== run) return resolve(mine !== run ? 'cancelled' : state);
      const u = new SpeechSynthesisUtterance(part);
      utterances.push(u);
      if (utterances.length > 20) utterances.shift();
      const voice = pickVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'de-DE';
      u.rate = r;
      u.onend = () => resolve('ok');
      u.onerror = (e) => resolve(mine !== run || (e && (e.error === 'interrupted' || e.error === 'canceled')) ? 'cancelled' : 'error');
      speechSynthesis.speak(u);
    })), Promise.resolve('ok'));
  }

  function cancel() {
    run++;
    if (supported) speechSynthesis.cancel();
    if (endPlayback) endPlayback();
  }

  // Stimmen werden in manchen Browsern erst verzögert geladen
  function onVoices(fn) {
    if (!supported) return;
    speechSynthesis.addEventListener('voiceschanged', fn);
    fn();
  }

  return {
    supported, say, cancel, voices, pickVoice, onVoices, spoken, chunks, store, current: () => run, prefetch,
    engine, setEngine, piperSupported, piperReady, piperLoad, PIPER_VOICES, unlock,
    available: () => supported || piperSupported(),
  };
})();

if (typeof module !== 'undefined') module.exports = Speech;
