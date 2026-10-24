// Piper-Sprachsynthese (Open Source) im Browser: eSpeak-Phonemizer und ONNX-Modell laufen per WebAssembly.
// Das Modell wird einmal geladen (Cache API) und danach im Speicher gehalten; pro Textstück entsteht nur eine kleine WAV-Datei.
const Piper = (() => {
  const HF = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';
  const ORT_DIR = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
  const PHONEMIZE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
  const PATHS = {
    'de_DE-thorsten-medium': 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
    'de_DE-ramona-low': 'de/de_DE/ramona/low/de_DE-ramona-low.onnx',
    'de_DE-kerstin-low': 'de/de_DE/kerstin/low/de_DE-kerstin-low.onnx',
  };
  const CACHE = 'piper-models-v1';

  let ortPromise = null;
  let phonemizerPromise = null;
  const sessions = new Map();   // Stimmen-ID → { session, config }

  function script(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Konnte ${src} nicht laden`));
      document.head.appendChild(el);
    });
  }

  const ort = () => (ortPromise = ortPromise || script(`${ORT_DIR}ort.wasm.min.js`).then(() => {
    window.ort.env.wasm.wasmPaths = ORT_DIR;
    window.ort.env.wasm.numThreads = 1;
    return window.ort;
  }));

  function phonemizer() {
    phonemizerPromise = phonemizerPromise || script(`${PHONEMIZE}.js`).then(() => window.createPiperPhonemize);
    return phonemizerPromise;
  }

  async function cached(url) {
    const cache = await caches.open(CACHE);
    return cache.match(url);
  }

  async function ready(id) {
    const base = `${HF}/${PATHS[id]}`;
    return Boolean(await cached(base)) && Boolean(await cached(`${base}.json`));
  }

  // Modell mit Fortschritt herunterladen und im Gerät speichern
  async function load(id, progress) {
    const base = `${HF}/${PATHS[id]}`;
    const cache = await caches.open(CACHE);
    for (const url of [`${base}.json`, base]) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
      const total = Number(res.headers.get('Content-Length')) || 0;
      const reader = res.body.getReader();
      const parts = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.length;
        if (progress && url === base) progress(loaded, total);
      }
      await cache.put(url, new Response(new Blob(parts), { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
    }
    try { await navigator.storage.persist?.(); } catch {}
  }

  async function session(id) {
    if (sessions.has(id)) return sessions.get(id);
    const job = (async () => {
      const base = `${HF}/${PATHS[id]}`;
      const [modelRes, configRes] = await Promise.all([cached(base), cached(`${base}.json`)]);
      if (!modelRes || !configRes) throw new Error('Stimme ist nicht geladen');
      const o = await ort();
      const config = JSON.parse(await configRes.text());
      // Nur eine Stimme gleichzeitig im Speicher halten (Handys haben wenig Platz)
      for (const [other, s] of sessions) { if (other !== id) { sessions.delete(other); s.then((x) => x.session.release?.()).catch(() => {}); } }
      return { session: await o.InferenceSession.create(await modelRes.arrayBuffer(), { executionProviders: ['wasm'] }), config };
    })();
    sessions.set(id, job);
    job.catch(() => sessions.delete(id));
    return job;
  }

  // Text → Phonem-IDs (eSpeak, deutsche Aussprache laut Stimmen-Konfiguration)
  async function phonemize(text, config) {
    const create = await phonemizer();
    return new Promise((resolve, reject) => {
      create({
        print: (line) => { try { resolve(JSON.parse(line).phoneme_ids); } catch (e) { reject(e); } },
        printErr: (msg) => console.debug('espeak', msg),
        locateFile: (f) => (f.endsWith('.wasm') ? `${PHONEMIZE}.wasm` : f.endsWith('.data') ? `${PHONEMIZE}.data` : f),
      }).then((m) => m.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data']))
        .catch(reject);
    });
  }

  function wav(samples, rate) {
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    return new Blob([view], { type: 'audio/wav' });
  }

  async function synth(text, id) {
    const o = await ort();
    const { session: s, config } = await session(id);
    const ids = await phonemize(text, config);
    const inf = config.inference;
    const feeds = {
      input: new o.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new o.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
      scales: new o.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale, inf.noise_w])),
    };
    if (Object.keys(config.speaker_id_map || {}).length) feeds.sid = new o.Tensor('int64', BigInt64Array.from([0n]));
    const out = await s.run(feeds);
    return wav(out.output.data, config.audio.sample_rate);
  }

  return { ready, load, synth, ids: Object.keys(PATHS) };
})();
