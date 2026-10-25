// Robust batchexecute stream splitter: ignore the length prefix and walk
// bracket depth from each chunk start, honouring string escapes.
export function splitChunks(body) {
  const s = String(body).replace(/^\)\]\}'?\s*/, '');
  const chunks = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    // optional length header
    const m = /^(\d{1,8})\n/.exec(s.slice(i, i + 10));
    if (m) i += m[0].length;
    if (s[i] !== '[' && s[i] !== '{') { i++; continue; }
    const start = i;
    const open = s[i];
    const close = open === '[' ? ']' : '}';
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = i; k < s.length; k++) {
      const c = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end < 0) break;
    const text = s.slice(start, end);
    let json = null;
    try { json = JSON.parse(text); } catch { try { json = JSON.parse(JSON.parse(text)); } catch {} }
    chunks.push({ text, json });
    i = end;
  }
  return chunks;
}

export function framesOf(body) { return splitChunks(body); }
