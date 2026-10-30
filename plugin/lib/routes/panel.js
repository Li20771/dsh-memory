// routes/panel.js — the memory panel's two endpoints:
//   GET  /dsh-memory/panel/overview   the whole read-only snapshot (§3.1)
//   POST /dsh-memory/panel/workflow   one pin/unpin/forget (§3.2)
//
// Contract: `registerPanelRoutes(webServer, c)`; `c` holds what this family USES
// but does not OWN (same convention as the wallpaper-engine precedent):
//   · `disposers`    ← cleanup handles, drained by the plugin fiber on unload
//   · `refresh`      ← bring the index current before answering (tools do the same)
//   · `index`        ← parsed vault, read-only here
//   · `cfg`          ← halfLifeDays / l4Limit
//   · `vaultRoot`    ← the containment root for path parameters
//   · `workflowAdmin`← the shared L3 pool + the three governed actions
//   · `auditSources`, `harvestStatus`, `diagnoseLines` ← facts other code owns
//   · `credibility`, `clip` ← presentation helpers owned by the plugin entry
//
// Non-negotiables this file must not lose:
//   · the panel is READ-ONLY except for the three governed actions; it never
//     grows a write endpoint of its own
//   · a governance refusal is HTTP 200 with `ok:true, changed:false, refused:<text>`.
//     Only a path escape or unparseable JSON is a 400 (§3.2) — the HTTP status
//     must not become a second, softer copy of the policy
//   · `forget` from the panel IS confirmed: §3.2's body has no `confirm` field and
//     §4.3 puts the two-step confirmation in the UI. Honouring an incoming
//     `confirm:false` would make the panel's only destructive button silently do
//     nothing, so the body's value is ignored and the intent is explicit here.
//
// @module dsh-memory/routes/panel

import { isStale } from '../memory/lifecycle.js'
import {
  PANEL_LAYER_TITLES,
  byStateOf,
  findWorkspaceMap,
  l4View,
  layerEntry,
  tagCountsOf
} from '../memory/panel-data.js'
import { linkHealth } from '../vault/cite.js'
import { resolveWorkspace } from '../workspace.js'
import { KB, PANEL } from './contract.js'
import { methodOf, paramOf, readJsonBody, refuse, searchOf, sendJson } from './http.js'
import { resolveVaultPath } from './vault-paths.js'

/** Actions §3.2 exposes. `sweep`/`confirm` stay on the tool (build-contract §3.2). */
const PANEL_ACTIONS = new Set(['pin', 'unpin', 'forget'])

const PANEL_PAGE = KB.page

/** A trimmed string field from a JSON body, or ''. */
function bodyText(body, key) {
  const value = body?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** cwd/session resolution must match the tools exactly (build-contract §3). */
async function workspaceFor(cwd, session) {
  return resolveWorkspace(cwd === '' ? process.cwd() : cwd, { sessionId: session === '' ? null : session })
}

export function registerPanelRoutes(webServer, c) {
  const {
    disposers,
    refresh,
    index,
    cfg,
    vaultRoot,
    workflowAdmin,
    auditSources,
    harvestStatus,
    diagnoseLines,
    credibility,
    clip
  } = c

  // 1. The read-only snapshot. One request answers everything the panel paints,
  //    so the panel never has to stitch five calls into an inconsistent view.
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: PANEL.overview,
      handler: async (req, res) => {
        if (methodOf(req) !== 'GET') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const search = searchOf(req)
        const cwd = paramOf(search, 'cwd')
        const session = paramOf(search, 'session')
        try {
          await refresh()
          const ws = await workspaceFor(cwd, session)
          const items = await workflowAdmin.list()
          const harvest = await harvestStatus(ws)
          const audit = await auditSources()
          const health = linkHealth(index)
          const mapEntry = findWorkspaceMap(index, ws)
          const l4 = l4View(index, ws, { limit: cfg.l4Limit, credibility, clip })

          sendJson(res, 200, {
            ok: true,
            vault: { root: vaultRoot },
            workspace: {
              root: ws.root,
              id: ws.id,
              episode: ws.episode,
              enabled: ws.enabled,
              mapAlwaysOn: ws.mapAlwaysOn,
              role: ws.role,
              coordinators: Array.isArray(ws.marker?.coordinators) ? ws.marker.coordinators.map(String) : [],
              state: String(ws.marker?.state ?? 'active'),
              lastActivity: ws.marker?.lastActivity ?? null,
              stale: isStale(ws.marker?.lastActivity),
              harvest
            },
            layers: {
              l1: layerEntry({
                path: 'positioning.md',
                title: PANEL_LAYER_TITLES.l1,
                entry: index.get('positioning.md')
              }),
              l2: layerEntry({
                path: mapEntry?.path ?? (ws.id ? `workspaces/${ws.id}.md` : ''),
                title: PANEL_LAYER_TITLES.l2,
                entry: mapEntry
              }),
              l4: { ...l4, title: PANEL_LAYER_TITLES.l4 }
            },
            l3: {
              halfLifeDays: cfg.workflowHalfLifeDays,
              byState: byStateOf(items),
              items
            },
            knowledge: {
              // Every indexed note: the vault's size as a reader sees it.
              notes: index.paths().length,
              tags: tagCountsOf(index),
              linkHealth: {
                total: health.totalLinks,
                resolved: health.resolvedLinks,
                unresolved: health.unresolved.map((link) => ({ from: link.from, raw: link.raw })),
                ambiguous: health.ambiguous.map((link) => ({ from: link.from, raw: link.raw }))
              },
              entryUrl: PANEL_PAGE
            },
            audit: { total: audit.total, stale: audit.stale, broken: audit.broken, gone: audit.gone, examples: audit.examples },
            diagnose: { lines: String(await diagnoseLines({ cwd, session })).split('\n') }
          })
        } catch (error) {
          // A read that fails must say so, not answer with a half-empty snapshot.
          refuse(res, 500, 'overview-failed', { detail: String(error?.message ?? error) })
        }
      }
    })
  )

  // 2. One governed action. The pool and the gates come from `workflowAdmin`, so
  //    this route can only ever be a thin transport for the tool's own policy.
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: PANEL.workflow,
      handler: async (req, res) => {
        if (methodOf(req) !== 'POST') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const parsed = await readJsonBody(req)
        if (!parsed.ok) {
          refuse(res, 400, parsed.error)
          return
        }
        const body = parsed.value
        const action = bodyText(body, 'action')
        // Path validation before anything else: an escape must not reach the pool,
        // and must not be reported as "no such workflow" either.
        const normalized = await resolveVaultPath(vaultRoot, body?.path)
        if (!normalized.ok) {
          refuse(res, 400, normalized.error)
          return
        }
        if (!PANEL_ACTIONS.has(action)) {
          refuse(res, 400, 'bad-request')
          return
        }
        try {
          // Same as every tool: bring the index current before judging. Without this
          // the first request after a mount can see an index that is still building
          // and report "no such workflow" for a workflow that plainly exists.
          await refresh()
          const ws = await workspaceFor(bodyText(body, 'cwd'), bodyText(body, 'session'))
          const reason = bodyText(body, 'reason')
          const result = await workflowAdmin.run(
            {
              action,
              path: normalized.rel,
              reason: reason === '' ? undefined : reason,
              // The panel confirmed already (§4.3); see the file header.
              confirm: true
            },
            ws
          )
          const items = await workflowAdmin.list()
          sendJson(res, 200, {
            ok: true,
            changed: result.changed,
            refused: result.refused,
            message: result.message,
            l3: { halfLifeDays: cfg.workflowHalfLifeDays, byState: byStateOf(items), items }
          })
        } catch (error) {
          refuse(res, 500, 'action-failed', { detail: String(error?.message ?? error) })
        }
      }
    })
  )
}