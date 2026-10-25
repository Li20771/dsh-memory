import { readFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const d = JSON.parse(readFileSync('captures/08-reload-content.json', 'utf8'));
const body = d.rpcs[0].body;
const chunks = splitChunks(body);
const first = chunks.map(c => c.json).find(j => Array.isArray(j) && j[0]?.[0] === 'wrb.fr');
const inner = JSON.parse(first[0][2]);

console.log('notebook entries:', inner.length);
for (const n of inner) {
  const title = n?.[0], sources = n?.[1];
  if (!Array.isArray(sources) || !sources.length) continue;
  console.log(`\n== notebook ${JSON.stringify(title)}  sources=${sources.length}  id=${n?.[2]}`);
  for (const s of sources) {
    const meta = s?.[2] ?? [];
    console.log(`  [${s?.[0]?.[0]}] title=${JSON.stringify(s?.[1])}`);
    console.log(`    meta(${meta.length}) = ${JSON.stringify(meta).slice(0, 620)}`);
    console.log(`    tail = ${JSON.stringify(s?.[3])}`);
  }
}
