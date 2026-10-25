// node inner.mjs <capture.json> <capIndex> <chunkIndex>
import { readFileSync, writeFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const [file, capIdx, chunkIdx] = process.argv.slice(2);
const cap = JSON.parse(readFileSync(file, 'utf8')).caps[Number(capIdx)];
const chunks = splitChunks(cap.body);
const chunk = chunks[Number(chunkIdx)];

// unwrap: [["wrb.fr", null, "<inner json>"]]
let inner = chunk.json;
const env = Array.isArray(inner) && inner[0] ? inner[0] : null;
if (Array.isArray(env) && typeof env[2] === 'string') {
  try { inner = JSON.parse(env[2]); } catch (e) { console.log('inner parse failed:', e.message); }
}

const pretty = JSON.stringify(inner, null, 1);
const out = `captures/inner-c${capIdx}-k${chunkIdx}.json`;
writeFileSync(out, pretty, 'utf8');
console.log(`chunk=${chunkIdx} raw=${chunk.text.length}B innerChars=${pretty.length} -> ${out}`);
console.log('top:', Array.isArray(inner) ? `array(${inner.length})` : typeof inner);
