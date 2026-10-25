// Memory policy: write admission, source families, review states.
//
// Pure functions over plain data — no I/O — so every rule here is directly
// testable and every rejection carries a machine-readable code.
//
// Two rules do most of the work, and both come from the literature rather than
// taste:
//
//   1. ADMISSION is irreversible-safe by refusing at the boundary. `Gated Memory`
//      (arXiv:2610.11270) shows the distinction between "the user permanently
//      prefers X" and "the user is momentarily in situation X" exists only in the
//      original utterance; extraction destroys it. So we refuse what we cannot
//      classify, instead of guessing and living with it.
//
//   2. AUTHORITY must not inflate. A `tool-output` or `inferred` claim may become
//      an observation, but must never silently become a workspace-wide fact —
//      that is exactly the "authority collapse" of arXiv:2608.01679, where
//      consolidation kept the claim and erased the constraint on its use.
//
// @module dsh-memory/memory/policy

import { createHash } from 'node:crypto'

export const KNOWN_TYPES = new Set([
  'positioning',
  'workspace',
  'workflow',
  'memory',
  'project',
  'research',
  'finding',
  'decision',
  'question',
  'log',
  'artifact'
])

export const AUTHORITIES = ['user-stated', 'agent-observed', 'tool-output', 'inferred']

/** Types whose content every session in the workspace will see. */
export const WORKSPACE_WIDE_TYPES = new Set(['memory', 'workspace'])

export const REVIEW_STATES = ['pending', 'approved', 'revised', 'rejected']

/**
 * Derive a source family.
 *
 * Everything written while answering the same session from the same inducing
 * source shares a family. Recall keeps ONE representative per family, which is
 * the direct countermeasure to `Memory Echo` (arXiv:2610.17763): a record that is
 * merely a copy of another record must not consume a second retrieval slot and
 * masquerade as independent confirmation.
 *
 * @param {{sessionId?:string|null, source?:string|null, tool?:string|null}} input
 * @returns {string} `fam_<10 hex>`
 */
export function familyOf(input = {}) {
  const basis = [input.sessionId ?? 'nosession', input.source ?? '', input.tool ?? ''].join('|')
  return `fam_${createHash('sha1').update(basis).digest('hex').slice(0, 10)}`
}

/**
 * Decide whether a write may be admitted.
 *
 * @param {{
 *   type:string, authority?:string, sensitivity?:string, body?:string,
 *   role?:'coordinator'|'worker', confirmed?:boolean
 * }} input
 * @returns {{ok:boolean, code:string, reason:string, forced?:object}}
 */
export function checkAdmission(input = {}) {
  const type = String(input.type ?? '').toLowerCase()
  const authority = String(input.authority ?? 'agent-observed').toLowerCase()
  const sensitivity = String(input.sensitivity ?? 'normal').toLowerCase()
  const role = input.role === 'coordinator' ? 'coordinator' : 'worker'
  const body = String(input.body ?? '')

  // 1. Sensitive material never reaches the disk. A note is a git-tracked file;
  //    once written, "delete it later" is a promise we cannot keep — git history
  //    and any aggregate index retain it.
  if (sensitivity === 'sensitive') {
    return {
      ok: false,
      code: 'sensitive-refused',
      reason:
        'sensitivity=sensitive 不能落盘：记忆仓库里的一旦写入，git 历史与派生索引都会留痕，"事后销毁"对它是假的。这类内容只能存在于当前会话上下文。'
    }
  }

  // 2. Unknown type: we would not know where it belongs or who may read it.
  if (!KNOWN_TYPES.has(type)) {
    return {
      ok: false,
      code: 'unknown-type',
      reason: `未知 type "${type}"。可用：${[...KNOWN_TYPES].join(' | ')}`
    }
  }

  // 3. Empty content is pure noise.
  if (body.trim() === '') {
    return { ok: false, code: 'empty-body', reason: '正文为空，不写入。' }
  }

  // 4. L1 is the collaboration contract — only the coordinator may define it.
  if (type === 'positioning' && role !== 'coordinator') {
    return {
      ok: false,
      code: 'positioning-needs-coordinator',
      reason: '定位（L1）每轮全文注入并定义行为边界，只能由协调会话来写。'
    }
  }

  // 5. Authority inflation: a tool output or an inference may not become a
  //    workspace-wide fact on its own. It can still be recorded — as a proposal
  //    awaiting review, which is what `forced` expresses.
  if (WORKSPACE_WIDE_TYPES.has(type) && (authority === 'tool-output' || authority === 'inferred')) {
    if (input.confirmed === true) {
      return { ok: true, code: 'admitted-confirmed', reason: '工作区级写入，已由确认路径放行。' }
    }
    return {
      ok: true,
      code: 'forced-proposed',
      reason:
        'authority 为 tool-output/inferred 的内容不能单独取得工作区级效力。已记录，但强制降级为待审查（review=pending）。',
      forced: { review: { state: 'pending' }, authority }
    }
  }

  // 6. A decision without alternatives is not a decision — it is a conclusion that
  //    forgot it had a choice. Recording "we chose A" without "B was on the table
  //    and lost because…" makes the record useless exactly when it matters (six
  //    months later, when someone asks why not B).
  if (type === 'decision') {
    const alternatives = Array.isArray(input.alternatives)
      ? input.alternatives.map((a) => String(a ?? '').trim()).filter((a) => a !== '')
      : []
    if (alternatives.length < 2) {
      return {
        ok: false,
        code: 'decision-needs-alternatives',
        reason: '决策记录至少要有两个选项。「选 A 不选 B 的理由」的前提是 B 真的存在；只记一个的"决策"是事后叙事。用 alternatives 列出选项（含被选中的那个）。'
      }
    }
  }

  // 7. A project "scope" without non-goals is not a scope. Without it, anything can
  //    be argued into the project later, and the record will happily agree.
  if (type === 'project') {
    const nonGoals = Array.isArray(input.nonGoals) ? input.nonGoals.map((g) => String(g ?? '').trim()).filter((g) => g !== '') : []
    if (nonGoals.length < 1) {
      return {
        ok: false,
        code: 'project-needs-nongoals',
        reason: '项目条目必须写出非目标（nonGoals）。没有非目标的"范围"等于没有范围，后面任何东西都能被塞进来。'
      }
    }
  }

  return { ok: true, code: 'admitted', reason: '通过准入。' }
}

/**
 * Keep one representative per source family, preserving hit order.
 *
 * @param {Array<object>} hits
 * @param {(hit:object) => string|undefined} familyOfHit
 * @returns {{kept:Array<object>, dropped:number}}
 */
export function dedupeByFamily(hits, familyOfHit) {
  const seen = new Set()
  const kept = []
  let dropped = 0
  for (const hit of hits) {
    const family = familyOfHit(hit) || `solo:${hit.path}`
    if (seen.has(family)) {
      dropped++
      continue
    }
    seen.add(family)
    kept.push(hit)
  }
  return { kept, dropped }
}

/**
 * Apply a review transition.
 *
 * @param {object} current - existing review object
 * @param {string} action - approve | reject | revise
 * @param {{by?:string, note?:string, originalTextSha?:string}} [meta]
 * @returns {object} new review object
 */
export function applyReview(current, action, meta = {}) {
  const now = new Date().toISOString()
  const base = { ...(current && typeof current === 'object' ? current : {}) }
  const state = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revised'
  const next = { ...base, state, by: meta.by ?? base.by ?? null, at: now }
  if (meta.note) next.note = meta.note
  if (state === 'revised' && meta.originalTextSha) next.originalTextSha = meta.originalTextSha
  return next
}

/** Half-life for workflow decay: a workflow not recalled in ~90 days halves. */
export const WORKFLOW_HALF_LIFE_DAYS = 90

/** Below this score a workflow is a forgetting candidate. */
export const WORKFLOW_FORGET_SCORE = 0.18

/**
 * Decay for L3 workflows.
 *
 * Episodes get destroyed when a project closes; workflows do not have that
 * boundary, so without decay the L3 pool only ever grows — and a growing pool of
 * stale procedures is exactly the "spuriously successful procedure becomes
 * recurring" failure of arXiv:2610.05176. Decay makes "not recalled" the default
 * direction; recall is what earns permanence.
 *
 * `pinned` is the user's override: it is the manual version of the same decision,
 * which is why the UI's "永久保留" and the automatic sweep share this one function.
 *
 * Note WHERE permanence comes from: recall refreshes `lastUsed`, so a workflow that
 * keeps being recalled stays recent. `useCount` is only a secondary bonus — forty
 * recalls three years ago must not rescue a procedure nobody has used since.
 *
 * @param {{lastUsed?:string|null, created?:string|null, useCount?:number, pinned?:boolean}} input
 * @param {{now?:number, halfLifeDays?:number, threshold?:number}} [options]
 * @returns {{score:number, state:'pinned'|'active'|'decaying'|'expired', ageDays:number|null, useCount:number}}
 */
export function workflowDecay(input = {}, options = {}) {
  const now = options.now ?? Date.now()
  const halfLifeDays = options.halfLifeDays ?? WORKFLOW_HALF_LIFE_DAYS
  const threshold = options.threshold ?? WORKFLOW_FORGET_SCORE
  const useCount = Number.isFinite(input.useCount) ? Math.max(0, input.useCount) : 0

  if (input.pinned === true) return { score: 1, state: 'pinned', ageDays: null, useCount }

  const basis = Date.parse(String(input.lastUsed ?? input.created ?? ''))
  const ageDays = Number.isFinite(basis) ? Math.max(0, (now - basis) / 86_400_000) : null
  // Unknown age is treated as半新: decaying, never immediately expired — deleting
  // something because its date failed to parse would be the worst possible default.
  const decay = ageDays === null ? 0.4 : Math.exp(-ageDays / halfLifeDays)
  const reinforcement = 1 + 0.6 * Math.log1p(useCount)
  const score = Math.min(1, decay * reinforcement)
  const state = score < threshold ? 'expired' : score < threshold * 2 ? 'decaying' : 'active'
  // Not rounded to 3 decimals: at half-life 90 days a two-year-old entry scores
  // ~1e-4, and collapsing that to 0.000 would make real differences disappear.
  return { score: Number(score.toPrecision(4)), state, ageDays: ageDays === null ? null : Math.round(ageDays), useCount }
}
