#!/usr/bin/env node
// Wortschatz aus den Gesetzestexten (src/gesetze/*.json) → public/data/wortschatz.json
// Die Rechtschreibprüfung der Lernsets kennt damit Fachwörter („Gefahrenabwehr“, „Ordnungsbehörde“ …), die in normalen Wörterbüchern fehlen.
//   node scripts/build-wordlist.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'gesetze');
const counts = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  const law = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const item of law.items) {
    const text = [item.title, ...(item.text || [])].join(' ');
    for (const m of text.matchAll(/[\p{L}]{3,}/gu)) counts.set(m[0].toLowerCase(), (counts.get(m[0].toLowerCase()) || 0) + 1);
  }
}
// Wörter, die nur einmal in den Gesetzen stehen, sind häufiger Tippfehler/Sonderfälle als Wortschatz: nur ab 2 Vorkommen aufnehmen
const words = [...counts].filter(([w, n]) => n >= 2 && w.length <= 40).map(([w]) => w).sort((a, b) => a.localeCompare(b, 'de'));
fs.mkdirSync(path.join(__dirname, '..', 'public', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'wortschatz.json'), JSON.stringify(words));
console.log(`${words.length} Wörter (von ${counts.size} verschiedenen)`);
