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
  function spoken(text) {
    return SPOKEN.reduce((t, [re, to]) => t.replace(re, to), String(text)).replace(/\s+/g, ' ').trim();
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

  // Liest text vor und wartet, bis er fertig (oder abgebrochen) ist. Löst nie mit Fehler auf.
  function say(text, { rate } = {}) {
    if (!supported) return Promise.resolve();
    const mine = run;
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
  }

  // Stimmen werden in manchen Browsern erst verzögert geladen
  function onVoices(fn) {
    if (!supported) return;
    speechSynthesis.addEventListener('voiceschanged', fn);
    fn();
  }

  return { supported, say, cancel, voices, pickVoice, onVoices, spoken, chunks, store, current: () => run };
})();

if (typeof module !== 'undefined') module.exports = Speech;
