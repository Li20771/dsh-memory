// Episode lifecycle and the harvest contract.
//
// The lifecycle exists because episode memory is TEMPORARY: it is scoped to one
// project run, and when the run ends its content must be harvested — promoted to
// a workflow, folded into the knowledge base, or explicitly discarded — and then
// destroyed. Nothing here is allowed to be lost silently:
//
//   * `checkHarvestCoverage` refuses to close an episode while any record has no
//     disposition. "I forgot one" is the failure this whole module exists for.
//   * every disposition carries either a target or a reason, so a later reader can
//     answer "why is this gone" without guessing.
//   * purge moves files into `.trash/` instead of unlinking, and appends a
//     tombstone LINE — because "this project existed" is information worth
//     keeping even after its content is gone.
//
// Pure functions only. I/O lives in the plugin entry.
//
// @module dsh-memory/memory/lifecycle

export const EPISODE_STATES = ['open', 'active', 'harvesting', 'closing', 'purged', 'abandoned']

/**
 * Allowed transitions.
 *
 * `harvesting -> active` is deliberate: a harvest can stall (a record turns out to
 * need more work) and freezing the episode forever would be worse than reopening
 * it. Any other way back is refused.
 */
const TRANSITIONS = {
  open: ['active', 'abandoned'],
  active: ['harvesting', 'abandoned'],
  harvesting: ['closing', 'active', 'abandoned'],
  closing: ['purged'],
  purged: [],
  abandoned: ['purged']
}

export const DISPOSITIONS = ['harvested', 'discarded', 'deferred']

/** Default cool-down between closing and the point where purge is allowed. */
export const CLOSING_DAYS = 7

/** Default inactivity window before an episode is reported as stale. */
export const STALE_DAYS = 30

export function isState(value) {
  return EPISODE_STATES.includes(String(value))
}

export function canTransition(from, to) {
  const list = TRANSITIONS[String(from)]
  return Array.isArray(list) && list.includes(String(to))
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`非法状态迁移: ${from} → ${to}（允许：${(TRANSITIONS[String(from)] ?? []).join(', ') || '无'}）`)
  }
  return true
}

/** Days since an ISO timestamp, or null when unparseable. */
export function daysSince(iso, now = Date.now()) {
  const at = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(at)) return null
  return (now - at) / 86_400_000
}

/** Whether an episode has gone quiet past the stale threshold. */
export function isStale(lastActivity, now = Date.now(), staleDays = STALE_DAYS) {
  const days = daysSince(lastActivity, now)
  return days !== null && days >= staleDays
}

/** Whether the cool-down after `closing` has elapsed. */
export function closingElapsed(closingUntil, now = Date.now()) {
  const at = Date.parse(String(closingUntil ?? ''))
  if (!Number.isFinite(at)) return false
  return now >= at
}

/**
 * Validate the harvest report against the records that actually exist.
 *
 * @param {string[]} recordPaths - every record path in the episode at close time
 * @param {Array<{path:string, disposition:string, target?:string, reason?:string}>} entries
 * @returns {{ok:boolean, missing:string[], invalid:string[], covered:number, total:number}}
 */
export function checkHarvestCoverage(recordPaths, entries = []) {
  const seen = new Map()
  const invalid = []
  for (const entry of entries) {
    const path = String(entry?.path ?? '').trim()
    if (path === '') {
      invalid.push('存在没有 path 的处置行')
      continue
    }
    const disposition = String(entry?.disposition ?? '').trim()
    if (!DISPOSITIONS.includes(disposition)) {
      invalid.push(`${path}: 非法处置 "${disposition}"（应为 ${DISPOSITIONS.join('/')}）`)
      continue
    }
    if (disposition === 'harvested' && String(entry?.target ?? '').trim() === '') {
      invalid.push(`${path}: harvested 必须写 target（收割去了哪里）`)
      continue
    }
    if (disposition === 'discarded' && String(entry?.reason ?? '').trim() === '') {
      invalid.push(`${path}: discarded 必须写 reason`)
      continue
    }
    if (seen.has(path)) {
      invalid.push(`${path}: 重复处置`)
      continue
    }
    seen.set(path, entry)
  }
  const missing = recordPaths.filter((path) => !seen.has(path))
  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    covered: seen.size,
    total: recordPaths.length
  }
}

/** One harvest-report line. Kept human-readable so the report can be edited by hand. */
export function renderDisposition(entry) {
  const parts = [`- ${entry.path}`, entry.disposition]
  if (entry.target) parts.push(`target=${entry.target}`)
  if (entry.reason) parts.push(`reason=${entry.reason}`)
  if (entry.at) parts.push(`at=${entry.at}`)
  return parts.join(' | ')
}

const DISPOSITION_LINE = /^-\s+(\S+)\s*\|\s*(harvested|discarded|deferred)\b(.*)$/

/** Parse a harvest report body back into entries. */
export function parseDispositions(body) {
  const entries = []
  for (const raw of String(body ?? '').split('\n')) {
    const m = DISPOSITION_LINE.exec(raw.trim())
    if (!m) continue
    const entry = { path: m[1].trim(), disposition: m[2] }
    for (const pair of m[3].split('|')) {
      const at = pair.indexOf('=')
      if (at < 0) continue
      const key = pair.slice(0, at).trim()
      const value = pair.slice(at + 1).trim()
      if (key !== '' && value !== '') entry[key] = value
    }
    entries.push(entry)
  }
  return entries
}
