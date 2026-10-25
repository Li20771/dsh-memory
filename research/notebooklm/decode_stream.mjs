// node decode_stream.mjs <raw.json> [chunkIndex]
import { readFileSync } from 'node:fs';
const [file, idxArg] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, 'utf8'));

for (const [i, c] of raw.caps.entries()) {
  console.log(`[cap ${i}] ${c.kind} len=${c.len} ${String(c.url).slice(0, 110)}`);
  console.log('   head:', JSON.stringify((c.body || '').slice(0, 160)));
}

// batchexecute streaming framing: )]}\'\n\n<len>\n<json>\n<len>\n<json>...
function frames(body) {
  const out = [];
  let s = body.replace(/^\)\]\}'?\s*/, '');
  while (s.length) {
    const m = s.match(/^(\d+)\n/);
    if (!m) break;
    const n = Number(m[1]);
    const payload = s.slice(m[0].length, m[0].length + n);
    out.push(payload);
    s = s.slice(m[0].length + n).replace(/^\n/, '');
  }
  return out;
}

const target = raw.caps[idxArg ? Number(idxArg) : raw.caps.length - 1];
const fr = frames(target.body || '');
console.log(`\n=== streaming ${target.url.slice(0, 100)} : ${fr.length} frames ===`);
for (const [i, f] of fr.entries()) {
  let j;
  try { j = JSON.parse(f); } catch { console.log(`[${i}] unparsed len=${f.length}`); continue; }
  const textish = JSON.stringify(j).match(/[\u4e00-\u9fa5A-Za-z0-9_.\-]{6,}/g) || [];
  console.log(`[${i}] len=${f.length} keys=${Array.isArray(j) ? 'array/' + j.length : typeof j} sample=${JSON.stringify(textish.slice(0, 6))}`);
}
