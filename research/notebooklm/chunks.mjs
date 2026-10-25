// Split the retrieval bundle into passages and measure each one.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'captures/cross-strings.json';
const strings = JSON.parse(readFileSync(file, 'utf8'));
const bundle = strings.find(s => s.text.includes('<passage index='));
if (!bundle) { console.log('no passage bundle found'); process.exit(1); }

const t = bundle.text;
console.log(`bundle chars=${t.length}`);
console.log('prefix:', JSON.stringify(t.slice(0, 60)));
console.log('suffix:', JSON.stringify(t.slice(-60)));

const re = /<passage index="(\d+)">\n([\s\S]*?)<\/passage>/g;
let m;
const rows = [];
while ((m = re.exec(t))) rows.push({ index: Number(m[1]), len: m[2].length, text: m[2] });

console.log(`\npassages=${rows.length}`);
for (const r of rows) {
  const heads = [...r.text.matchAll(/^(#{4,6}) (.+)$/gm)].map(h => h[2].trim());
  const markers = [...r.text.matchAll(/C(\d{2})-M\d/g)].map(x => Number(x[1]));
  const uniq = [...new Set(markers)].sort((a, b) => a - b);
  console.log(` [#${r.index}] chars=${r.len} heads=${JSON.stringify(heads.slice(0, 4))} chapters=${JSON.stringify(uniq)}`);
  console.log(`       head=${JSON.stringify(r.text.slice(0, 80))}`);
  console.log(`       tail=${JSON.stringify(r.text.slice(-80))}`);
}

// overlap check: does any passage tail text appear at the next passage head?
for (let i = 1; i < rows.length; i++) {
  const prevTail = rows[i - 1].text.slice(-120);
  const head = rows[i].text.slice(0, 200);
  const common = [...head].filter(ch => prevTail.includes(ch)).length;
  console.log(`\noverlap check #${rows[i - 1].index}->#${rows[i].index}: sharedChars=${common}`);
}
