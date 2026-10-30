#!/usr/bin/env node
// Liest ein Bundesgesetz von gesetze-im-internet.de (amtliche XML-Fassung) und schreibt es nach src/gesetze/<slug>.json.
//   node scripts/import-gii.js <kurzname-in-der-url> "<Kürzel>"
// Beispiel:
//   node scripts/import-gii.js stpo StPO
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' };
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(\w+);/g, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));

// Kleiner XML-Parser (die Dateien sind wohlgeformt): Baum aus { tag, children } und Textknoten (Strings)
function parse(xml) {
  const root = { tag: '#root', children: [] };
  const stack = [root];
  for (const m of xml.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>|<[?!][^>]*>|([^<]+)/g)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.children.push(decode(m[5])); continue; }
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const node = { tag: m[2], children: [] };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
const find = (node, tag) => (node.children || []).find((c) => c.tag === tag);
const findAll = (node, tag) => (node.children || []).filter((c) => c.tag === tag);
const tidy = (s) => s.replace(/[ \t\r\n]*\n[ \t\r\n]*/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();

function plain(node) {
  if (typeof node === 'string') return node;
  if (node.tag === 'BR') return '\n';
  return node.children.map(plain).join('');
}

// Aufzählungen (<DL>) → Zeilen; Einrückung über führende Tabs
function listLines(dl, depth, out) {
  const kids = dl.children.filter((c) => typeof c !== 'string');
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].tag !== 'DT') continue;
    const dd = kids[i + 1] && kids[i + 1].tag === 'DD' ? kids[i + 1] : null;
    const marker = tidy(plain(kids[i]));
    const parts = [];
    const nested = [];
    const collect = (node) => {      // Unterlisten stehen teils tief im <LA>
      if (typeof node === 'string') { parts.push(node); return; }
      if (node.tag === 'DL') { nested.push(node); return; }
      if (node.tag === 'BR') { parts.push('\n'); return; }
      node.children.forEach(collect);
    };
    (dd ? dd.children : []).forEach(collect);
    out.push(`${'\t'.repeat(depth)}${marker} ${tidy(parts.join(' '))}`.trimEnd());
    for (const n of nested) listLines(n, depth + 1, out);
  }
}

function contentLines(content) {
  const out = [];
  const flush = (buf) => { const t = tidy(buf.join('')); if (t) out.push(t); buf.length = 0; };
  for (const p of findAll(content, 'P')) {
    const buf = [];
    for (const c of p.children) {
      if (typeof c !== 'string' && c.tag === 'DL') { flush(buf); listLines(c, 1, out); }
      else buf.push(plain(c));
    }
    flush(buf);
  }
  return out;
}

async function main() {
  const [name, short] = process.argv.slice(2);
  if (!name || !short) { console.error('Aufruf: import-gii.js <kurzname> "<Kürzel>"'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gii-'));
  // curl statt fetch: läuft zuverlässig auch hinter einem Proxy; der Server antwortet gelegentlich mit 503
  const zip = path.join(dir, 'x.zip');
  execFileSync('curl', ['-sSL', '--fail', '--retry', '6', '--retry-delay', '3', '--retry-all-errors', '-m', '120', '-A', 'Mozilla/5.0', '-o', zip, `https://www.gesetze-im-internet.de/${name}/xml.zip`]);
  execFileSync('unzip', ['-o', '-q', path.join(dir, 'x.zip'), '-d', dir]);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.xml'));
  const tree = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const norms = findAll(find(tree, 'dokumente'), 'norm');

  const meta = find(norms[0], 'metadaten');
  const stand = findAll(meta, 'standangabe').map((s) => ({ typ: plain(find(s, 'standtyp')), text: tidy(plain(find(s, 'standkommentar'))) }));
  const build = norms[0].children.length && (tree.children.find((c) => c.tag === 'dokumente') || {}).children;
  const title = tidy(plain(find(meta, 'langue')));

  const items = [];
  let unit = '§';
  for (const norm of norms) {
    const m = find(norm, 'metadaten');
    const gl = find(m, 'gliederungseinheit');
    if (gl) {
      const kz = plain(find(gl, 'gliederungskennzahl')).trim();
      items.push({ type: 'head', level: Math.min(kz.length / 3, 4), label: tidy(plain(find(gl, 'gliederungsbez') || '')), title: tidy(plain(find(gl, 'gliederungstitel') || '')) });
      continue;
    }
    const enbez = find(m, 'enbez') && tidy(plain(find(m, 'enbez')));
    const mm = enbez && enbez.match(/^(?:§|Art)\s*(\d+\s?[a-z]?)$/);
    if (enbez && /^Art\s/.test(enbez)) unit = 'Art.';
    if (!mm) continue;
    const ttl = find(m, 'titel') ? tidy(plain(find(m, 'titel'))) : '';
    if (/^\(weggefallen\)$/.test(ttl)) continue;
    const td = find(norm, 'textdaten');
    const content = find(find(td, 'text') || { children: [] }, 'Content');
    const notes = [];
    const fn = find(td, 'fussnoten');
    for (const c of fn ? findAll(fn, 'Content') : []) notes.push(...findAll(c, 'P').map((p) => tidy(plain(p))).filter(Boolean));
    items.push({ type: 'par', num: mm[1].replace(/\s+/g, ''), title: ttl, text: content ? contentLines(content) : [], notes });
  }

  // Überschriften ohne folgende Paragraphen (z. B. ganz aufgehobene Abschnitte) weglassen
  const kept = items.filter((it, i) => {
    if (it.type === 'par') return true;
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].type === 'par') return true;
      if (items[j].level <= it.level) return false;
    }
    return false;
  });

  const version = stand.filter((s) => s.typ === 'Stand').map((s) => s.text).join('; ');
  const hints = stand.filter((s) => s.typ === 'Hinweis').map((s) => s.text);
  const bd = (fs.readFileSync(path.join(dir, file), 'utf8').match(/builddate="(\d{4})(\d{2})(\d{2})/) || []);
  const law = {
    slug: name, short, title, unit, validFrom: bd.length ? `${bd[3]}.${bd[2]}.${bd[1]}` : null,
    version: `Stand ${bd.length ? `${bd[3]}.${bd[2]}.${bd[1]}` : ''}${version ? ` – ${version}` : ''}`,
    hints, source: `https://www.gesetze-im-internet.de/${name}/`, citation: null, items: kept,
  };
  void build;
  const out = path.join(__dirname, '..', 'src', 'gesetze', `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(law));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${out}: ${kept.filter((i) => i.type === 'par').length} Paragraphen, ${kept.filter((i) => i.type === 'head').length} Überschriften — ${law.version}`);
}
main().catch((err) => { console.error(err); process.exit(1); });
