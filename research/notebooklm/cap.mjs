// node cap.mjs <capture.json> [--full <rpcid>]
import { readFileSync } from 'node:fs';
const [file, mode, rpcid] = process.argv.slice(2);
const cap = JSON.parse(readFileSync(file, 'utf8'));
const pick = cap.transactions.filter(t => !rpcid || t.url.includes('rpcids=' + rpcid));

for (const t of pick) {
  console.log('='.repeat(100));
  console.log(`${t.method} ${t.status} ${t.url.replace(/https:\/\/notebook\.google\.com\/_\/LabsTailwindUi\/data\//, '')}`.slice(0, 200));
  if (t.postData) {
    console.log(`-- request (${t.postData.length}B) --`);
    console.log(mode === '--full' ? t.postData : t.postData.slice(0, 3000));
  }
  if (t.respBody) {
    console.log(`-- response (${t.respBody.length}B) --`);
    console.log(mode === '--full' ? t.respBody : t.respBody.slice(0, 4000));
  }
}
