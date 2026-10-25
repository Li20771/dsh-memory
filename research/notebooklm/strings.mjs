// Dump every long string from the response (thoughts / tool arguments) for inspection.
import { readFileSync, writeFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const [file, capIdx, outName] = process.argv.slice(2);
const cap = JSON.parse(readFileSync(file, 'utf8')).caps[Number(capIdx)];
const chunks = splitChunks(cap.body).map(c => ({ ...c, size: JSON.stringify(c.json).length }))
  .sort((a, b) => b.size - a.size);
let inner = chunks[0].json;
if (Array.isArray(inner) && inner[0] && typeof inner[0][2] === 'string') {
  try { inner = JSON.parse(inner[0][2]); } catch {}
}

const strings = [];
(function walk(v, path) {
  if (typeof v === 'string') { if (v.length > 40) strings.push({ path, len: v.length, text: v }); }
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
})(inner, '$');

const out = `captures/${outName || 'strings'}.json`;
writeFileSync(out, JSON.stringify(strings, null, 1), 'utf8');
console.log(`strings=${strings.length} -> ${out}`);
for (const s of strings) console.log(` ${s.path} len=${s.len} ${JSON.stringify(s.text.slice(0, 90))}`);
