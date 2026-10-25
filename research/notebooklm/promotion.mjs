import { readFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const d = JSON.parse(readFileSync('captures/11-note-to-source.json', 'utf8'));
const list = d.caps.find(c => c.url.includes('rLM1Ne'));
const first = splitChunks(list.body).map(c => c.json).find(j => Array.isArray(j) && j[0]?.[0] === 'wrb.fr');
const inner = JSON.parse(first[0][2]);

for (const nb of inner) {
  const srcs = nb?.[1];
  if (!Array.isArray(srcs) || !srcs.length) continue;
  console.log(`notebook ${JSON.stringify(nb[0])} sources=${srcs.length}`);
  for (const s of srcs) {
    const meta = s?.[2] ?? [];
    console.log(`  [${s?.[0]?.[0]}] ${JSON.stringify(s?.[1])}`);
    console.log(`     slot1=${JSON.stringify(meta[1])} slot4=${JSON.stringify(meta[4])} slot8=${JSON.stringify(meta[8])} mime=${JSON.stringify(meta[19] ?? null)}`);
  }
  break;
}
