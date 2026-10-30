#!/usr/bin/env node
// Schreibt src/gesetze/index.json (Kurzinfos zu allen Gesetzen in der Reihenfolge von ORDER), damit die Liste ohne das Laden der großen Texte auskommt.
//   node scripts/build-gesetze-index.js
const fs = require('fs');
const path = require('path');

const ORDER = ['polg-nrw', 'obg-nrw', 'stgb', 'stpo', 'owig_1968', 'stvo_2013', 'stvzo_2012', 'gg', 'bgb'];
const dir = path.join(__dirname, '..', 'src', 'gesetze');
const slugs = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5));
const rest = slugs.filter((s) => !ORDER.includes(s)).sort();
const index = [...ORDER.filter((s) => slugs.includes(s)), ...rest].map((slug) => {
  const l = JSON.parse(fs.readFileSync(path.join(dir, `${slug}.json`), 'utf8'));
  return { slug, short: l.short, title: l.title, unit: l.unit || '§', validFrom: l.validFrom, count: l.items.filter((i) => i.type === 'par').length };
});
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
console.log(index.map((l) => `${l.short} (${l.count})`).join(', '));
