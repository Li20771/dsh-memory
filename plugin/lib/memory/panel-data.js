// panel-data.js — the L3 workflow pool: one implementation of its listing, its
// rendering, and the three governance-bearing actions.
//
// Why this module exists: the same pool is reached two ways. `memory_workflow`
// reaches it as a tool; the memory panel reaches it over HTTP
// (`/dsh-memory/panel/overview`, `/dsh-memory/panel/workflow`). If each path
// computed the pool itself, the two would drift in exactly the ways that matter:
// a different sort order (so "the first row is the one to forget" would mean two
// things), a different rounding, or — worst — a `pin` that passes the role gate
// on one path and not the other. So the pool, the renderer and the actions live
// here, and both call sites are thin.
//
// Governance is NOT re-implemented here either; it is MOVED here:
//   · role gate      — `ws.role !== 'coordinator'` refuses pin/unpin/forget
//   · pinned refusal — `forget` on a pinned workflow refuses
//   · destruction    — `forget` goes through the caller's `evictNote`, i.e.
//                      `.trash/workflows/` + a tombstone line, never `unlink`
// The messages are byte-identical to what the tool returned before this module
// existed (a snapshot diff over the tool output proved it).
//
// @module dsh-memory/memory/panel-data

import { join } from 'node:path'

import { WORKFLOW_HALF_LIFE_DAYS, workflowDecay } from './policy.js'
import { revisionOf } from '../vault/cite.js'

/** The tool's own line for an empty pool; the panel must not invent a second one. */
export const L3_EMPTY = 'L3 工作流池为空。'

/** Header for a non-empty pool. Ascending by score: the most forgettable first. */
export const l3Header = (count) => `L3 工作流 ${count} 条（按衰减分升序：最该忘的在最前）`

/** `0.412` / `<0.001` — the way a decay score is shown to a human. */
export function scoreText(score) {
  return score < 0.001 ? '<0.001' : score.toFixed(3)
}

/**
 * The pool, ordered by decay score ascending.
 *
 * Retracted workflows are excluded: a retracted note is not a candidate for
 * recall, so listing it as a forgetting candidate would be noise. Pinned ones
 * stay (state `pinned`, score 1) because "permanently kept" is still a fact about
 * the pool worth seeing.
 *
 * @param {{index:object, usage:Map<string,{count:number,lastUsed:string|null}>, halfLifeDays?:number}} input
 * @returns {Array<{path:string,title:string,state:string,score:number,ageDays:number|null,useCount:number,pinned:boolean}>}
 */
export function listWorkflows({ index, usage, halfLifeDays = WORKFLOW_HALF_LIFE_DAYS }) {
  const items = []
  for (const path of index.paths()) {
    const fm = index.get(path)?.parsed.frontmatter ?? {}
    if (String(fm.type ?? '').toLowerCase() !== 'workflow') continue
    if (String(fm.status ?? '').toLowerCase() === 'retracted') continue
    const used = usage?.get(path)
    const decay = workflowDecay(
      {
        lastUsed: used?.lastUsed,
        created: fm.created ?? fm.updated,
        useCount: used?.count ?? 0,
        pinned: fm.pinned === true
      },
      { halfLifeDays }
    )
    items.push({
      path,
      title: String(fm.title ?? path),
      state: decay.state,
      score: decay.score,
      ageDays: decay.ageDays,
      useCount: decay.useCount,
      pinned: fm.pinned === true
    })
  }
  // Ascending by score: the most forgettable first. Ties break on the path, NOT on
  // the index's insertion order — that order is decided by concurrent file reads,
  // so without this tie-break two equally-scored workflows could swap places
  // between two runs of the same tool (and between the panel's two requests), which
  // makes "the first row is the one to forget" mean two different things.
  items.sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return items
}

/** Counts by decay state, derived from the same list the panel shows. */
export function byStateOf(items) {
  const byState = { active: 0, decaying: 0, expired: 0, pinned: 0 }
  for (const item of items) {
    if (item.state === 'pinned') byState.pinned++
    else if (item.state === 'expired') byState.expired++
    else if (item.state === 'decaying') byState.decaying++
    else byState.active++
  }
  return byState
}

/** One list line. The panel and the tool render through this single function. */
export function describeWorkflow(item) {
  const age = item.ageDays === null ? '未记录使用' : `${item.ageDays} 天未用`
  return `- ${item.state === 'pinned' ? '📌' : '·'} ${item.path}｜${item.state}｜score=${scoreText(item.score)}｜${age}｜召回 ${item.useCount} 次`
}

/** The whole `action:"list"` answer as text — the tool returns this verbatim. */
export function renderL3List(items) {
  if (items.length === 0) return L3_EMPTY
  return [l3Header(items.length), ...items.map(describeWorkflow)].join('\n')
}

/**
 * `ok` refuses, and why. Two servers read these strings — the tool's verification
 * branch and `/kb/api/resolve` — so they are stated once here. `unknown` must
 * survive to the surface unfolded: "we cannot decide" is not "the note is gone".
 */
export const CITE_STATUS_NOTES = {
  ok: '引用有效。',
  stale: '该笔记已被修改：旧区间可能指向不同内容，请重新检索确认。',
  missing: '该笔记已不存在。',
  moved: '笔记还在，但被引用的块 id 不在了（块可能被删或改写）。',
  unknown: '无法判定。'
}

/** Panel-facing layer titles (build-contract §3.1). The injected headers are longer. */
export const PANEL_LAYER_TITLES = { l1: '定位', l2: '工作区地图', l4: '工作区记忆' }

/**
 * Build one layer entry for the panel.
 *
 * `body` is the note's text as the panel shows it (trimmed for display), but
 * `revision` is the NOTE's revision — the same value `/kb/api/note` reports for
 * that path. Two surfaces showing the same file with different revisions would
 * make "did this change?" unanswerable, which is the only thing a revision is for.
 */
export function layerEntry({ path, title, entry }) {
  const body = String(entry?.parsed.body ?? '').trim()
  if (!entry || body === '') return { path: path ?? '', title, present: false, body: '', updated: null, revision: null }
  const fm = entry.parsed.frontmatter ?? {}
  return {
    path,
    title,
    present: true,
    body,
    updated: fm.updated ?? fm.created ?? null,
    revision: revisionOf(entry.parsed.body)
  }
}

/** Tag → note count, ordered by count descending then tag. */
export function tagCountsOf(index, isAuthorized = null) {
  const counts = []
  for (const [tag, paths] of Object.entries(index.tagsIndex())) {
    const allowed = typeof isAuthorized === 'function' ? paths.filter((path) => isAuthorized(path)) : paths
    if (allowed.length > 0) counts.push({ tag, count: allowed.length })
  }
  counts.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  return counts
}

/**
 * The note that IS a workspace's L2 map.
 *
 * Prefer the canonical `workspaces/<id>.md`, but do not require it: the marker's
 * id and the note's filename are edited by different hands. The fallback (match
 * the note's `scope:`) is the same rule the injector uses, which is why this rule
 * lives here and not in two places.
 */
export function findWorkspaceMap(index, ws, authorize = null) {
  if (!ws?.id) return null
  const ok = (entry) => (typeof authorize === 'function' ? authorize(entry) : true)
  const canonical = index.get(`workspaces/${ws.id}.md`)
  if (canonical && ok(canonical)) return canonical
  const wanted = String(ws.id).toLowerCase()
  for (const path of index.paths()) {
    const entry = index.get(path)
    if (String(entry?.parsed.frontmatter?.type ?? '').toLowerCase() !== 'workspace') continue
    if (String(entry?.parsed.frontmatter?.scope ?? '').toLowerCase() !== wanted) continue
    if (ok(entry)) return entry
  }
  return null
}

/** Newest episode record of one scope, or null. */
export function newestEpisodeRecord(index, scope, authorize = null) {
  if (!scope || String(scope) === '') return null
  const test = typeof authorize === 'function' ? (_path, entry) => authorize(entry) : null
  const recent = index.recentByTypeScope('memory', String(scope), 1, test)
  return recent.length > 0 ? recent[0].path : null
}

/** Where each layer lives, as repo-relative paths (null when the note is absent). */
export function layerPaths(index, ws, authorize = null) {
  const l1Entry = index.get('positioning.md')
  const l1 = l1Entry && (typeof authorize !== 'function' || authorize(l1Entry)) ? 'positioning.md' : null
  const l2 = findWorkspaceMap(index, ws, authorize)?.path ?? null
  const l4 = ws?.id ? newestEpisodeRecord(index, ws.id, authorize) : null
  return { l1, l2, l4 }
}

/**
 * The L4 digest the panel shows.
 *
 * Deliberately NOT the injector's query-driven selection: the panel has no
 * current task wording, so "the newest records in this scope" is the honest
 * answer to "what has this project been doing". The read-side switch still gates
 * it and still fails CLOSED — with L4 off the panel gets `present:false` and no
 * text, never a silently reduced answer.
 *
 * `revision` here is the DIGEST's revision, not a note's: L4 is a composed view of
 * several records, so the digest is the artifact and `path`/`updated` anchor it to
 * the newest record it was composed from.
 *
 * @param {object} index
 * @param {object} ws resolved workspace
 * @param {{limit?:number, credibility:Function, clip:Function,
 *          authorize?:((entry:object)=>boolean)|null}} deps
 */
export function l4View(index, ws, { limit = 3, credibility, clip, authorize = null } = {}) {
  const empty = { path: '', present: false, body: '', updated: null, revision: null }
  if (!ws?.id || ws.enabled !== true) return empty
  const test = typeof authorize === 'function' ? (_path, entry) => authorize(entry) : null
  const recent = index.recentByTypeScope('memory', ws.id, limit, test)
  if (recent.length === 0) return empty
  const body = recent
    .map(({ path, entry }) => {
      const fm = entry.parsed.frontmatter ?? {}
      return `- ${credibility(fm.review?.state ?? null, fm.authority ?? null)} ${path}\n  ${clip(String(entry.parsed.body ?? '').trim(), 320)}`
    })
    .join('\n')
  const newest = recent[0]
  const fm = newest.entry.parsed.frontmatter ?? {}
  return {
    path: newest.path,
    present: true,
    body,
    updated: fm.updated ?? fm.created ?? null,
    revision: revisionOf(body)
  }
}

/**
 * The three panel actions, sharing their whole judgement with `memory_workflow`.
 *
 * @param {{index:object, vaultRoot:string, loadUsage:Function, halfLifeDays:number,
 *          rewriteNote:Function, evictNote:Function,
 *          authorize?:((entry:object, access:object)=>boolean)|null}} deps
 */
export function createWorkflowAdmin({
  index,
  vaultRoot,
  loadUsage,
  halfLifeDays,
  rewriteNote,
  evictNote,
  authorize = null
}) {
  /**
   * The authorized L3 pool. No access context -> empty, never the whole vault.
   * @param {object|null} access
   * @returns {Promise<Array<object>>}
   */
  async function list(access) {
    if (!access || typeof authorize !== 'function') return []
    const usage = await loadUsage()
    return listWorkflows({ index, usage, halfLifeDays }).filter((item) => {
      const entry = index.get(item.path)
      return Boolean(entry) && authorize(entry, access)
    })
  }

  const refused = (message) => ({ status: 'refused', message, changed: false, refused: message })
  const missing = (rel) => ({ status: 'missing', message: `没有找到工作流 ${rel}。`, changed: false, refused: null })
  const changed = (message) => ({ status: 'changed', message, changed: true, refused: null })

  /**
   * Run one action. `confirm` is what makes a destruction real; the tool's
   * two-step preview and the panel's own confirmation dialog both end up here.
   * The caller's authorization context is authoritative for both the role gate
   * and the target lookup: an unmarked/foreign workflow is indistinguishable
   * from a missing one.
   *
   * @returns {Promise<{status:'changed'|'refused'|'missing'|'preview'|'failed',
   *                    message:string, changed:boolean, refused:string|null}>}
   */
  async function run({ action, path, reason, confirm }, ws, access) {
    if (!access || access.bindingMismatch) return refused('拒绝：无可信访问上下文。')
    if (!access.isCoordinator) return refused('拒绝：只有 Curator/主 DSH（orchestrator）可以变更工作流。')
    const rel = String(path ?? '').replace(/^\/+/, '')
    const usage = await loadUsage()
    const pool = await list(access)
    const target = pool.find((item) => item.path === rel)

    if (action === 'pin' || action === 'unpin') {
      if (!target) return missing(rel)
      const abs = join(vaultRoot, ...rel.split('/'))
      await rewriteNote(abs, (frontmatter) => {
        if (action === 'pin') frontmatter.pinned = true
        else delete frontmatter.pinned
        frontmatter.updated = new Date().toISOString()
      })
      await index.refreshFiles([abs])
      return changed(
        action === 'pin'
          ? `${rel} → 已固定：永久保留，不参与衰减淘汰。`
          : `${rel} → 已解固：重新参与衰减（当前 score=${target.score}）。`
      )
    }

    // action === 'forget'
    if (!target) return missing(rel)
    if (target.pinned) {
      return refused(`拒绝：${rel} 已固定（永久保留）。先 unpin 再遗忘，否则"永久保留"就失去了意义。`)
    }
    if (confirm !== true) {
      return {
        status: 'preview',
        changed: false,
        refused: null,
        message: [
          `即将遗忘 ${rel}`,
          `- 状态 ${target.state}｜score=${target.score}｜召回 ${target.useCount} 次`,
          '内容会移入 .trash/（可捞回），并留下墓碑。确认请再调用一次并传 confirm=true。',
          '残余（不假装能清）：git 历史里仍可找回旧版本。'
        ].join('\n')
      }
    }
    const moved = await evictNote(rel, reason ?? 'manual-forget', 'workflows')
    if (!moved) return { status: 'failed', message: `遗忘失败：${rel} 已不在索引中。`, changed: false, refused: null }
    usage.delete(rel)
    return changed(`已遗忘 ${rel}（移入 .trash/workflows/，墓碑已记）。残余：git 历史里仍可找回。`)
  }

  return { list, run }
}