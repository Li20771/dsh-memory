// Audit: does any payload carry a chunk/segment id or vector data?
import { readFileSync } from 'node:fs';

const files = ['captures/inner-c1-k12.json', 'captures/cross-strings.json'];
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

for (const f of files) {
  let raw;
  try { raw = readFileSync(f, 'utf8'); } catch { console.log('missing', f); continue; }
  const ids = new Map();
  for (const m of raw.matchAll(uuid)) {
    if (!ids.has(m[0])) ids.set(m[0], { count: 0, firstAt: m.index });
    ids.get(m[0]).count++;
  }
  console.log(`\n=== ${f}`);
  for (const [id, v] of ids) console.log(`  ${id}  x${v.count}`);

  // vector-ish payload scan: long runs of numbers inside arrays
  const runs = [...raw.matchAll(/\[\s*(?:-?\d+(?:\.\d+)?\s*,\s*){12,}-?\d+(?:\.\d+)?\s*\]/g)];
  console.log(`  numericRuns(len>=13)=${runs.length}`, runs.slice(0, 3).map(r => r[0].slice(0, 90)));

  // proto-ish base64 blobs longer than 40 chars
  const blobs = [...raw.matchAll(/"[A-Za-z0-9+/]{40,}={0,2}"/g)];
  console.log(`  base64ishBlobs=${blobs.length}`, blobs.slice(0, 3).map(b => b[0].slice(0, 60)));
}
