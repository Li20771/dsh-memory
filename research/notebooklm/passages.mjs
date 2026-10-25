// node passages.mjs <capture.json> <capIndex> [label]
// Chunk/coverage report: parses <passage index="N"> blocks out of the retrieval
// tool-call arguments and compares them with the citation ranges.
import { readFileSync, writeFileSync } from 'node:fs';
import { splitChunks } from './stream_frames.mjs';

const [file, capIdx, label] = process.argv.slice(2);
const cap = JSON.parse(readFileSync(file, 'utf8')).caps[Number(capIdx)];
const chunks = splitChunks(cap.body).map(c => ({ ...c, size: JSON.stringify(c.json).length }))
  .sort((a, b) => b.size - a.size);
let inner = chunks[0].json;
if (Array.isArray(inner) && inner[0] && typeof inner[0][2] === 'string') {
  try { inner = JSON.parse(inner[0][2]); } catch {}
}

const thoughts = JSON.stringify(inner[0]?.[4] ?? []);
const unescape = s => s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

const rawPassages = [...thoughts.matchAll(/<passage index=\\"(\d+)\\">\\n([\s\S]*?)<\\\/passage>|<passage index="(\d+)">\n([\s\S]*?)<\/passage>/g)]
  .map(m => ({ index: Number(m[1] ?? m[3]), text: unescape(m[2] ?? m[4] ?? '') }));

const passages = rawPassages.map(p => {
  const heads = [...p.text.matchAll(/^(#{2,6})\s*(.+)$/gm)].map(h => `${h[1].length}:${h[2].trim()}`);
  return {
    index: p.index,
    chars: p.text.length,
    firstHeading: heads[0] ?? null,
    headings: heads.slice(0, 30),
    head: p.text.slice(0, 120).replace(/\n/g, ' '),
    tail: p.text.slice(-120).replace(/\n/g, ' '),
  };
});

const queries = [...thoughts.matchAll(/"user_queries",\[null,null,null,null,null,\[\[\[null,null,"([^"]+)"/g)].map(m => m[1]);
const statuses = [...thoughts.matchAll(/retrieval_status[^"]*"([^"]{0,240})"/g)].map(m => m[1]);

const groups = (Array.isArray(inner[1]) ? inner[1] : []).map(g => ({
  ranges: g?.[3] ?? null,
  sources: (g?.[5] ?? []).map(s => s?.[0]?.[0] ?? s),
}));

const out = {
  label: label || file,
  answer: inner[0]?.[0] ?? null,
  queries,
  statuses,
  passages,
  groups,
  sourceCountMentioned: [...thoughts.matchAll(/(\d+)% of the sources/g)].map(m => m[1]),
};
writeFileSync(`captures/${(label || 'passages').replace(/[^\w-]/g, '_')}.json`, JSON.stringify(out, null, 1), 'utf8');

console.log('ANSWER:', (out.answer || '').slice(0, 500));
console.log('\nQUERIES:', JSON.stringify(out.queries));
console.log('STATUS:', JSON.stringify(out.statuses));
console.log('COVERAGE:', JSON.stringify(out.sourceCountMentioned));
console.log(`\nPASSAGES: ${passages.length}`);
for (const p of passages) {
  console.log(` [#${p.index}] chars=${p.chars} headings=${JSON.stringify(p.headings)}`);
  console.log(`      head=${JSON.stringify(p.head)}`);
}
console.log('\nCITATION GROUPS:', JSON.stringify(out.groups, null, 1).slice(0, 1200));
