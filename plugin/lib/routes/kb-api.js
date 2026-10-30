// routes/kb-api.js — the knowledge page's read-only JSON API (§3.3):
//   GET /dsh-memory/kb/api/tree     the whole vault as a tree
//   GET /dsh-memory/kb/api/note     one note, with blocks/links/citations
//   GET /dsh-memory/kb/api/resolve  one citation's current status
//   GET /dsh-memory/kb/api/search   sentence-level search
//
// Read-only by construction: no handler in this file writes, moves or rewrites
// anything. The only filesystem access is the containment check on `?path=`.
//
// Three contract points are easy to get subtly wrong, so each is stated in code:
//   · a missing note is HTTP 404 `{ok:false,error:"note not found",path}` — the UI's
//     "missing" state. It must never look like an empty note.
//   · `resolve.status` is `resolveCitation()`'s own status. There are five possible
//     values and `unknown` must reach the surface unfolded: "cannot decide" is a
//     different fact from "the note is gone".
//   · a citation is cited at a REVISION. `revision` in every answer is the note's
//     CURRENT revision (same meaning as `resolve`), while the cited revision stays
//     inside `spec` — so a stale badge can be explained without a second field.
//
// @module dsh-memory/routes/kb-api

import { CITE_STATUS_NOTES, layerPaths, tagCountsOf } from '../memory/panel-data.js'
import { lineRangeOf, parseCitation, resolveCitation, revisionOf } from '../vault/cite.js'
import { resolveAnchor } from '../vault/links.js'
// Aliased: every handler below binds a local `search` for the request's query
// parameters, and a shadowed vault search would have been called as one.
import { search as searchVault } from '../vault/query.js'
import { resolveWorkspace } from '../workspace.js'
import { KB } from './contract.js'
import { methodOf, paramOf, refuse, searchOf, sendJson } from './http.js'
import { resolveVaultPath } from './vault-paths.js'

const DEFAULT_HIT_LIMIT = 20
const MAX_HIT_LIMIT = 50

/** A note's frontmatter, or an empty object. */
const frontmatterOf = (entry) => entry?.parsed.frontmatter ?? {}

/** One row of the tree's note list. */
function noteRow(index, path) {
  const entry = index.get(path)
  const fm = frontmatterOf(entry)
  return {
    path,
    title: String(fm.title ?? path),
    type: String(fm.type ?? ''),
    scope: String(fm.scope ?? ''),
    tags: entry?.parsed.tags ?? [],
    updated: fm.updated ?? fm.created ?? null,
    status: String(fm.status ?? 'active')
  }
}

/**
 * Workspaces as scopes, each with its member notes.
 *
 * The map note itself (`type: workspace`) is excluded from its own members: it
 * describes the scope, it is not an item in it. Every other note whose `scope:`
 * matches (or nests under it) is a member.
 */
function scopesOf(index) {
  const all = index.paths()
  const scopes = []
  for (const path of all) {
    const fm = frontmatterOf(index.get(path))
    if (String(fm.type ?? '').toLowerCase() !== 'workspace') continue
    const fallback = path.replace(/^workspaces\//, '').replace(/\.md$/i, '')
    const id = String(fm.scope ?? fallback)
    const wanted = id.toLowerCase()
    const members = all
      .filter((other) => {
        const otherFm = frontmatterOf(index.get(other))
        if (String(otherFm.type ?? '').toLowerCase() === 'workspace') return false
        const scope = String(otherFm.scope ?? '').toLowerCase()
        return scope === wanted || scope.startsWith(`${wanted}/`)
      })
      .sort()
    scopes.push({ id, title: String(fm.title ?? id), notes: members })
  }
  scopes.sort((a, b) => a.id.localeCompare(b.id))
  return scopes
}

export function registerKbApiRoutes(webServer, c) {
  const { disposers, refresh, index, vaultRoot } = c

  const resolveWorkspaceFor = async (search) =>
    resolveWorkspace(paramOf(search, 'cwd') === '' ? process.cwd() : paramOf(search, 'cwd'), {
      sessionId: paramOf(search, 'session') === '' ? null : paramOf(search, 'session')
    })

  // 1. Tree.
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: KB.tree,
      handler: async (req, res) => {
        if (methodOf(req) !== 'GET') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        try {
          await refresh()
          const ws = await resolveWorkspaceFor(searchOf(req))
          sendJson(res, 200, {
            ok: true,
            vault: { root: vaultRoot },
            layers: layerPaths(index, ws),
            notes: index.paths().map((path) => noteRow(index, path)),
            tags: tagCountsOf(index),
            scopes: scopesOf(index)
          })
        } catch (error) {
          refuse(res, 500, 'tree-failed', { detail: String(error?.message ?? error) })
        }
      }
    })
  )

  // 2. One note.
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: KB.note,
      handler: async (req, res) => {
        if (methodOf(req) !== 'GET') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const search = searchOf(req)
        const normalized = await resolveVaultPath(vaultRoot, search.get('path'))
        if (!normalized.ok) {
          refuse(res, 400, normalized.error)
          return
        }
        try {
          await refresh()
          const rel = normalized.rel
          const entry = index.get(rel)
          if (!entry) {
            // The UI's missing state. Never an empty note.
            refuse(res, 404, 'note not found', { path: rel })
            return
          }
          const parsed = entry.parsed
          const fm = frontmatterOf(entry)
          const body = String(parsed.body ?? '')

          const backlinks = []
          for (const from of index.backlinksOf(rel)) {
            for (const link of index.outlinksOf(from)) {
              if (link.resolution !== 'file' || link.fileId !== rel) continue
              backlinks.push({ from, raw: link.raw, kind: link.embed ? 'embed' : 'link' })
            }
          }

          const outlinks = index.outlinksOf(rel).map((link) => ({
            raw: link.raw,
            // The resolved note id is what a click needs; `raw` keeps the written form.
            target: link.resolution === 'file' ? link.fileId : link.target,
            resolved: link.resolution === 'file' || link.resolution === 'self',
            kind: link.embed ? 'embed' : 'link'
          }))

          const sources = Array.isArray(fm.sources) ? fm.sources : []
          const citations = []
          for (const spec of sources) {
            const text = String(spec ?? '')
            if (text === '') continue
            const at = text.lastIndexOf('@')
            const ref = at > 0 ? text.slice(0, at) : text
            const citedRevision = at > 0 ? text.slice(at + 1) : ''
            const citation = parseCitation(ref)
            const resolved = resolveCitation(index, {
              ...citation,
              revision: citedRevision === '' ? undefined : citedRevision
            })
            const targetEntry = index.get(citation.note)
            // `line` is a line in the TARGET note: that is the line the reader will
            // land on when the badge is clicked.
            let line = null
            if (targetEntry) {
              const range = resolveAnchor(targetEntry.parsed, citation.heading, citation.block)
              if (range.kind !== 'none') line = lineRangeOf(targetEntry.parsed.body, range).startLine
            }
            citations.push({
              spec: text,
              line,
              status: resolved.status,
              revision: resolved.revision,
              target: citation.note
            })
          }

          sendJson(res, 200, {
            ok: true,
            path: rel,
            title: String(fm.title ?? rel),
            frontmatter: fm,
            body,
            revision: revisionOf(body),
            lines: body.split('\n').length,
            // Only id'd blocks: an anchor needs an id to be worth listing.
            blocks: (parsed.blocks ?? [])
              .filter((block) => typeof block.id === 'string' && block.id !== '')
              .map((block) => ({ id: block.id, line: lineRangeOf(body, { start: block.start, end: block.end }).startLine })),
            tags: parsed.tags ?? [],
            backlinks,
            outlinks,
            citations
          })
        } catch (error) {
          refuse(res, 500, 'note-failed', { detail: String(error?.message ?? error) })
        }
      }
    })
  )

  // 3. Citation status.
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: KB.resolve,
      handler: async (req, res) => {
        if (methodOf(req) !== 'GET') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const search = searchOf(req)
        const cite = paramOf(search, 'cite')
        if (cite === '') {
          refuse(res, 400, 'bad-request')
          return
        }
        try {
          await refresh()
          const revision = paramOf(search, 'revision')
          const citation = parseCitation(cite)
          const resolved = resolveCitation(index, {
            ...citation,
            revision: revision === '' ? undefined : revision
          })
          const targetEntry = index.get(citation.note)
          let range = resolved.range
          let text = resolved.text
          if (targetEntry) {
            const anchor = resolveAnchor(targetEntry.parsed, citation.heading, citation.block)
            if (anchor.kind !== 'none') {
              range = { start: anchor.start, end: anchor.end }
              text = String(targetEntry.parsed.body ?? '').slice(anchor.start, anchor.end)
            }
          }
          sendJson(res, 200, {
            ok: true,
            // Verbatim, never folded: `unknown` is a real answer to a real question.
            status: resolved.status,
            revision: resolved.revision ?? null,
            target: citation.note,
            range: range ?? null,
            text: text ?? null,
            reason: CITE_STATUS_NOTES[resolved.status] ?? null
          })
        } catch (error) {
          refuse(res, 500, 'resolve-failed', { detail: String(error?.message ?? error) })
        }
      }
    })
  )

  // 4. Search.
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: KB.search,
      handler: async (req, res) => {
        if (methodOf(req) !== 'GET') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const search = searchOf(req)
        const query = paramOf(search, 'q')
        if (query === '') {
          refuse(res, 400, 'bad-request')
          return
        }
        const limitText = paramOf(search, 'limit')
        let limit = DEFAULT_HIT_LIMIT
        if (limitText !== '') {
          const asked = Number(limitText)
          if (!Number.isFinite(asked) || asked < 1) {
            refuse(res, 400, 'bad-request')
            return
          }
          limit = Math.min(MAX_HIT_LIMIT, Math.floor(asked))
        }
        try {
          await refresh()
          // No scope funnel: the knowledge page browses the whole vault, which is
          // the same vault /kb/api/tree lists. Withholding is a RECALL admission
          // rule (memory_search), not a visibility rule for the reader's own page.
          const result = searchVault(index, query, { limit })
          sendJson(res, 200, {
            ok: true,
            widened: result.widened,
            notes: result.notes,
            hits: result.hits.map((hit) => ({
              path: hit.path,
              cite: hit.cite,
              score: hit.score,
              section: hit.section,
              passage: hit.passage,
              range: hit.range,
              sentence: hit.sentence ? { text: hit.sentence.text, range: hit.sentence.range } : null,
              sentenceLines: hit.sentenceLines
                ? { start: hit.sentenceLines.startLine, end: hit.sentenceLines.endLine }
                : null
            }))
          })
        } catch (error) {
          refuse(res, 500, 'search-failed', { detail: String(error?.message ?? error) })
        }
      }
    })
  )
}