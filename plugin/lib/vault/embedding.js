// Optional semantic recall, deliberately limited in scope.
//
// WHAT IT IS ALLOWED TO DO: widen the candidate set. Nothing else.
//
// The reason is measured, not aesthetic. arXiv:2610.26433 found that embedding
// geometry predicts answer correctness with pooled AUROC 0.640 — BELOW the
// 0.655 question-difficulty baseline. Cosine similarity is therefore not a
// quality signal: ranking by it does not just fail to help, it replaces "missed
// the supporting sentence" with "picked a fluent opposite", which is worse
// because it looks like evidence.
//
// So the contract here is narrow and enforced by the caller:
//   embed()  -> widen candidates
//   cosine() -> a number, never a verdict
// The lexical scorer still decides what gets injected and in what order.
//
// Three safety properties, each answering a specific failure:
//   * disabled by default          -> zero regression when unused
//   * every failure returns null   -> falls back to lexical, never throws
//   * vectors never persist in the vault -> the repo stays portable
//
// @module dsh-memory/vault/embedding

import { createHash } from 'node:crypto'

const sha1 = (text) => createHash('sha1').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)

/** Cosine similarity; 0 for degenerate input. */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Create an embedding provider.
 *
 * @param {{
 *   enabled?:boolean, endpoint?:string, model?:string, apiKeyEnv?:string,
 *   timeoutMs?:number, maxDocs?:number, batchSize?:number, minSimilarity?:number
 * }} [config]
 * @param {{request?:Function, now?:()=>number}} [deps] - `request` is injectable for tests
 * @returns {{
 *   enabled:boolean, status:object, embed:(texts:string[])=>Promise<number[][]|null>,
 *   expand:(index:object, query:string, options:object)=>Promise<Set<string>>,
 *   cached:()=>number
 * }}
 */
export function createEmbeddingProvider(config = {}, deps = {}) {
  const request = deps.request ?? (typeof fetch === 'function' ? fetch : null)
  const now = deps.now ?? (() => Date.now())

  const settings = {
    enabled: config.enabled === true,
    endpoint: typeof config.endpoint === 'string' ? config.endpoint : '',
    model: typeof config.model === 'string' ? config.model : 'text-embedding-3-small',
    apiKeyEnv: typeof config.apiKeyEnv === 'string' ? config.apiKeyEnv : '',
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 8000,
    maxDocs: Number.isFinite(config.maxDocs) ? config.maxDocs : 2000,
    batchSize: Number.isFinite(config.batchSize) ? config.batchSize : 32,
    minSimilarity: Number.isFinite(config.minSimilarity) ? config.minSimilarity : 0.25
  }

  const usable = () => settings.enabled && settings.endpoint !== '' && request !== null

  /** Per-process vector cache: note content hash -> vector. Never written to disk. */
  const cache = new Map()
  const stats = { calls: 0, failures: 0, lastError: null, lastFailureAt: null }

  const status = () => ({
    enabled: settings.enabled,
    usable: usable(),
    endpoint: settings.endpoint === '' ? '' : settings.endpoint.replace(/\/+$/, ''),
    model: settings.model,
    cached: cache.size,
    calls: stats.calls,
    failures: stats.failures,
    lastError: stats.lastError
  })

  /**
   * Embed a batch. Returns null on ANY failure — the caller must treat null as
   * "no semantic help available", never as "no results".
   * @param {string[]} texts
   * @returns {Promise<number[][]|null>}
   */
  async function embed(texts) {
    if (!usable()) return null
    const input = (texts ?? []).map((t) => String(t ?? '').slice(0, 4000))
    if (input.length === 0) return []
    const out = []
    for (let i = 0; i < input.length; i += settings.batchSize) {
      const batch = input.slice(i, i + settings.batchSize)
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), settings.timeoutMs) : null
      try {
        stats.calls++
        const headers = { 'content-type': 'application/json' }
        const key = settings.apiKeyEnv ? process.env[settings.apiKeyEnv] : undefined
        if (typeof key === 'string' && key !== '') headers.authorization = `Bearer ${key}`
        const response = await request(settings.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: settings.model, input: batch }),
          ...(controller ? { signal: controller.signal } : {})
        })
        if (!response || typeof response.json !== 'function') throw new Error('no response body')
        if (response.ok === false) throw new Error(`http ${response.status}`)
        const payload = await response.json()
        const rows = payload?.data
        if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error('unexpected shape')
        for (const row of rows) {
          const vector = row?.embedding
          if (!Array.isArray(vector) || vector.length === 0) throw new Error('empty embedding')
          out.push(vector)
        }
      } catch (error) {
        // Fail closed to lexical. A broken embedder must never break recall.
        stats.failures++
        stats.lastError = String(error?.message ?? error)
        stats.lastFailureAt = now()
        return null
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    return out
  }

  /**
   * Wide candidate set for a query, restricted to one scope predicate.
   *
   * Sharding is mandatory, not an optimisation: arXiv:2610.04195 shows a shared
   * embedding space leaks across tenants through ordinary cosine retrieval, with
   * no exploit required. `options.scopeTest` is therefore applied BEFORE any
   * similarity comparison, so vectors from different scopes never meet.
   *
   * @param {{paths:()=>string[], get:(p:string)=>object|undefined}} index
   * @param {string} query
   * @param {{scopeTest?:(path:string, entry:object)=>boolean, limit?:number}} [options]
   * @returns {Promise<Set<string>>}
   */
  async function expand(index, query, options = {}) {
    if (!usable()) return new Set()
    const limit = Number.isFinite(options.limit) ? options.limit : 24
    const scopeTest = typeof options.scopeTest === 'function' ? options.scopeTest : null

    const candidates = []
    for (const path of index.paths()) {
      const entry = index.get(path)
      if (!entry) continue
      if (scopeTest && !scopeTest(path, entry)) continue
      candidates.push([path, entry])
      if (candidates.length >= settings.maxDocs) break
    }
    if (candidates.length === 0) return new Set()

    const queryVector = (await embed([query]))?.[0]
    if (!queryVector) return new Set()

    // Embed documents in batches, reusing the process cache.
    const missing = []
    for (const [path, entry] of candidates) {
      const key = sha1(entry.parsed.body)
      if (!cache.has(key)) missing.push(key)
    }
    const uniqueMissing = [...new Set(missing)]
    for (let i = 0; i < uniqueMissing.length; i += settings.batchSize) {
      const slice = uniqueMissing.slice(i, i + settings.batchSize)
      const bodies = slice.map((key) => {
        const found = candidates.find(([, entry]) => sha1(entry.parsed.body) === key)
        return found ? found[1].parsed.body : ''
      })
      const vectors = await embed(bodies)
      if (!vectors) return new Set()
      slice.forEach((key, at) => cache.set(key, vectors[at]))
    }

    const scored = []
    for (const [path, entry] of candidates) {
      const vector = cache.get(sha1(entry.parsed.body))
      if (!vector) continue
      const similarity = cosine(queryVector, vector)
      if (similarity < settings.minSimilarity) continue
      scored.push([path, similarity])
    }
    scored.sort((a, b) => b[1] - a[1])
    return new Set(scored.slice(0, limit).map(([path]) => path))
  }

  return { enabled: settings.enabled, status, embed, expand, cached: () => cache.size }
}

/**
 * Persist-free wrapper used when embeddings are disabled: keeps call sites free of
 * `if` statements while guaranteeing identical behaviour.
 */
export function nullProvider() {
  return {
    enabled: false,
    status: () => ({ enabled: false, usable: false, endpoint: '', model: '', cached: 0, calls: 0, failures: 0, lastError: null }),
    embed: async () => null,
    expand: async () => new Set(),
    cached: () => 0
  }
}
