// node report.mjs <capture.json> <capIndex> [label]
import { readFileSync, writeFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const [file, capIdx, label, set] = process.argv.slice(2);
let doc = JSON.parse(readFileSync(file, 'utf8'));
if (!doc.caps && set) doc = doc[set];
if (!doc.caps) throw new Error('no caps array; pass a set name (e.g. q3)');
const cap = doc.caps[Number(capIdx)];
const chunks = splitChunks(cap.body)
  .map(c => ({ ...c, size: JSON.stringify(c.json).length }))
  .sort((a, b) => b.size - a.size);

let inner = chunks[0].json;
if (Array.isArray(inner) && inner[0] && typeof inner[0][2] === 'string') {
  try { inner = JSON.parse(inner[0][2]); } catch {}
}

const msg = inner[0];
const out = { label: label || file, answer: msg?.[0] ?? null };

out.conversation = msg?.[2] ?? null;

// inline citation markers -> group index
const markerBlock = inner[2]?.[0];
out.markers = Array.isArray(markerBlock)
  ? markerBlock.map(m => {
      const r = Array.isArray(m?.[0]) ? m[0] : null;
      const nums = Array.isArray(r) ? r.filter(x => typeof x === 'number') : [];
      return { pos: nums.length >= 2 ? [nums[0], nums[1]] : r, groups: m?.[1] ?? null, raw: m };
    })
  : null;

// citation groups
const groups = Array.isArray(inner[1]) ? inner[1] : [];
out.groups = groups.map(g => ({
  head: g?.[0] ?? null,
  count: g?.[2] ?? null,
  ranges: g?.[3] ?? null,
  sources: g?.[5] ?? null,
  ids: g?.[6] ?? null,
  passageBlocks: Array.isArray(g?.[4]) ? g[4].map(b => ({ range: [b?.[0], b?.[1]], type: b?.[3] ?? null })) : null,
}));

// retrieval activity inside thoughts
const thoughts = JSON.stringify(msg?.[4] ?? []);
out.retrieval = {
  userQueries: [...thoughts.matchAll(/"user_queries",\[null,null,null,null,null,\[\[\[null,null,"([^"]+)"\]/g)].map(m => m[1]),
  passageCount: (thoughts.match(/<passage index=/g) || []).length,
  retrievalStatus: (thoughts.match(/retrieval_status[^\]]*"([^"]{0,200})/) || [])[1] ?? null,
  thinkingSummaries: [...thoughts.matchAll(/\*\*([A-Z][^*]{2,60})\*\*/g)].map(m => m[1]).slice(0, 12),
};

// answer text block ranges + bold segments (structural sanity)
out.answerBlocks = Array.isArray(msg?.[4]?.[0])
  ? msg[4][0].filter(Array.isArray).map(b => ({
      range: [b?.[0], b?.[1]],
      text: (b?.[2] || []).map(s => s?.[2]?.[0]).join('').slice(0, 90),
      listMeta: b?.[5] ?? undefined,
    }))
  : null;

writeFileSync(`captures/report-${(label || 'cap').replace(/[^\w-]/g, '_')}.json`, JSON.stringify(out, null, 1), 'utf8');

console.log('ANSWER:\n' + (out.answer || '').slice(0, 900));
console.log('\nanswer length:', (out.answer || '').length);
console.log('\nMARKERS:', JSON.stringify(out.markers));
console.log('\nGROUPS:');
for (const [i, g] of out.groups.entries()) {
  console.log(` [${i}] ranges=${JSON.stringify(g.ranges)} count=${g.count} sources=${JSON.stringify(g.sources)} ids=${JSON.stringify(g.ids)}`);
  console.log(`     passageBlocks=${JSON.stringify(g.passageBlocks)}`);
}
console.log('\nRETRIEVAL:', JSON.stringify(out.retrieval, null, 1));
console.log('\nANSWER BLOCKS:');
for (const b of out.answerBlocks || []) console.log('  ', JSON.stringify(b));
