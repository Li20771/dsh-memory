// node dump_final.mjs <capture.json> <capIndex>
import { readFileSync, writeFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const [file, idxArg] = process.argv.slice(2);
const cap = JSON.parse(readFileSync(file, 'utf8')).caps[Number(idxArg)];
const chunks = splitChunks(cap.body);

let total = 0;
chunks.forEach((c, i) => {
  const j = JSON.stringify(c.json);
  total += j.length;
  console.log(`[${i}] text=${c.text.length}B json=${j.length}ch  head=${JSON.stringify(c.text.slice(0, 100))}`);
});

const out = `captures/${file.split(/[\\/]/).pop().replace(/\.json$/, '')}.cap${idxArg}.chunks.json`;
writeFileSync(out, JSON.stringify(chunks.map(c => c.json), null, 1), 'utf8');
console.log(`\nchunks=${chunks.length} totalJsonChars=${total} -> ${out}`);
