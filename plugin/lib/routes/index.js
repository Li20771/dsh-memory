// routes/index.js — the whole HTTP surface, registered through the plugin fiber.
//
// `registerMemoryRoutes(webServer, c)` returns one disposer that removes every
// route it registered. Three families, one entry point:
//   · panel.js    the memory panel (overview + the three governed actions)
//   · kb-api.js   the knowledge page's read-only JSON api
//   · kb-page.js  the knowledge page and its same-directory assets
//
// Registration ORDER matters in one direction only: the `/kb/api/*` routes are
// exact registrations and the page is a prefix seat, and the host resolves an
// exact hit before the longest prefix — so the api cannot be swallowed by the
// page. Registration is nevertheless done api-first, because a future route
// change that made them collide would then fail loudly (a duplicate throws) at
// the first request rather than silently answering the wrong handler.
//
// @module dsh-memory/routes

import { registerKbApiRoutes } from './kb-api.js'
import { registerKbOpenRoutes } from './kb-open.js'
import { registerKbPageRoutes } from './kb-page.js'
import { registerPanelRoutes } from './panel.js'

/**
 * @param {{register:Function}} webServer the host webserver service
 * @param {object} c shared dependencies (`disposers` is drained by the caller's
 *   fiber so a plugin unload leaves no route behind)
 * @returns {() => void} disposer removing every route registered here
 */
export function registerMemoryRoutes(webServer, c) {
  registerKbApiRoutes(webServer, c)
  registerKbOpenRoutes(webServer, c)
  registerKbPageRoutes(webServer, c)
  registerPanelRoutes(webServer, c)
  return () => {
    for (const dispose of c.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // A route table is a Map: a failed delete cannot corrupt it, and an
        // unload must not stop half-way because one handle misbehaved.
      }
    }
  }
}