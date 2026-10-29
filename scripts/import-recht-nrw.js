#!/usr/bin/env node
// Liest ein Gesetz von recht.nrw.de (amtliche Fassung) und schreibt es als JSON nach src/gesetze/<slug>.json.
//   node scripts/import-recht-nrw.js <url> <slug> "<Kürzel>" "<Titel>"
// Beispiel:
//   node scripts/import-recht-nrw.js https://recht.nrw.de/lrgv/gesetz/13122025-polizeigesetz-des-landes-nordrhein-westfalen-bekanntmachung-der-neufassung/ polg-nrw "PolG NRW" "Polizeigesetz des Landes Nordrhein-Westfalen"
const fs = require('fs');
const path = require('path');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', sect: '§', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…' };
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(\w+);/g, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
const clean = (html) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

// "<p>…</p><p>…</p>" → ['…', '…']
const paragraphs = (html) => [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => clean(m[1])).filter(Boolean);

async function main() {
  const [url, slug, short, title] = process.argv.slice(2);
  if (!url || !slug || !short || !title) { console.error('Aufruf: import-recht-nrw.js <url> <slug> "<Kürzel>" "<Titel>"'); process.exit(1); }
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Gliederung aus der Inhaltsübersicht: Zeilen mit einer Zelle = Überschrift, mit zwei Zellen = Paragraph
  const toc = html.slice(html.indexOf('Inhaltsübersicht'));
  const tocTable = toc.slice(toc.indexOf('<table'), toc.indexOf('</table>'));
  const outline = [];   // { type: 'head', level, title } | { type: 'par', num }
  for (const row of tocTable.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => clean(c[1]));
    if (cells.length === 1) {
      const [label, ...rest] = cells[0].split('\n');
      const unterab = /Unterabschnitt/.test(label);
      const level = unterab ? 2 : /Abschnitt/.test(label) ? 1 : /Titel$/.test(label) ? 3 : 4;   // Abschnitt > Unterabschnitt > Titel > I., II. …
      if (level === 4) { outline.push({ type: 'head', level, label: '', title: cells[0].replace(/\n/g, ' ') }); continue; }
      const inline = rest.join(' ').match(/^(.*?)\s+([IVX]+\.\s.*)$/);   // „Datenübermittlung I. Allgemeine …“ in einer Zeile
      if (inline) rest.splice(0, rest.length, inline[1], inline[2]);
      const roman = rest.findIndex((l) => /^[IVX]+\.\s/.test(l));
      const own = roman < 0 ? rest : rest.slice(0, roman);
      outline.push({ type: 'head', level, label, title: own.join(' ') });
      if (roman >= 0) outline.push({ type: 'head', level: 4, label: '', title: rest.slice(roman).join(' ') });
    } else if (cells.length >= 2) outline.push({ type: 'par', num: cells[0].replace(/^§\s*/, '').replace(/\s+/g, ''), title: cells[1] });
  }

  // Paragraphen aus dem Haupttext
  const pars = new Map();
  for (const chunk of html.split('paragraph--type--article').slice(1)) {
    const num = chunk.match(/field--field_num">([^<]*)</);
    if (!num) continue;
    const head = chunk.match(/field--field_headline">([^<]*)</);
    const body = chunk.match(/field--name-field-text[^>]*><div class="tex2jax_process">([\s\S]*?)<\/div><\/div>/);
    const notes = [...chunk.matchAll(/field--name-field-footnote-description[^>]*><div class="tex2jax_process">([\s\S]*?)<\/div><\/div>/g)].map((m) => paragraphs(m[1]).join(' ')).filter(Boolean);
    const n = (clean(num[1]).match(/^§?\s*(\d+\s?[a-z]?)(?![a-zäöü])/) || [])[1];
    if (!n) continue;
    pars.set(n.replace(/\s+/g, ''), { num: n, title: head ? clean(head[1]) : '', text: body ? paragraphs(body[1]) : [], notes });
  }

  const items = [];
  const seen = new Set();
  for (const o of outline) {
    if (o.type === 'head') items.push(o);
    else {
      const p = pars.get(o.num);
      if (!p) { console.warn(`§ ${o.num} fehlt im Text`); continue; }
      seen.add(o.num);
      items.push({ type: 'par', ...p, title: p.title || o.title });
    }
  }
  for (const n of pars.keys()) if (!seen.has(n)) console.warn(`§ ${n} steht nicht in der Gliederung`);

  const valid = html.match(/Gültig ab[^0-9]*(\d{2}\.\d{2}\.\d{4})/);
  const cite = html.match(/Vollzitat[\s\S]{0,300}?<\/(?:div|p)>[\s\S]{0,300}?(Polizeigesetz[^<]{20,600})</);
  const law = { slug, short, title, validFrom: valid ? valid[1] : null, source: url, citation: cite ? clean(cite[1]) : null, items };
  const out = path.join(__dirname, '..', 'src', 'gesetze', `${slug}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(law));
  console.log(`${out}: ${items.filter((i) => i.type === 'par').length} Paragraphen, ${items.filter((i) => i.type === 'head').length} Überschriften, gültig ab ${law.validFrom}`);
}
main().catch((err) => { console.error(err); process.exit(1); });
