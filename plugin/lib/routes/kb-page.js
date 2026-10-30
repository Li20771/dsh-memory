// routes/kb-page.js — the knowledge page itself (§3.3):
//   GET /dsh-memory/kb/                ← the bytes of `plugin/ui/kb/index.html`
//   GET /dsh-memory/kb/<static file>   ← same-directory assets the page loads
//
// The page is a plain static deliverable (`kb-page` writes it); this route is
// only the reader. Two rules keep the reader from becoming a file server:
//
//   · SAME DIRECTORY, WHITELISTED EXTENSIONS. `plugin/ui/kb/**` is the whole
//     world for the page family; nothing here walks up, and a subdirectory is not
//     served (the contract freezes "同目录静态文件").
//   · TRAVERSAL IS A 404, not a 400. The vault routes answer 400 for an escaping
//     path because the caller addressed the wrong thing; here the request is
//     simply not a file we serve — the same answer a stranger's path gets. An
//     encoded `%2e%2e%2f` is decoded before the decision, so no encoding slips past.
//
// `decorate`d bytes are read per request: the page is a few KB and correctness
// (a rebuilt page is served immediately) beats a cache whose invalidation is
// someone else's problem.
//
// @module dsh-memory/routes/kb-page

import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KB_PAGE_BASE } from './contract.js'
import { JSON_TYPE, methodOf, pathnameOf, refuse, sendBytes } from './http.js'

const HTML_TYPE = 'text/html; charset=utf-8'

/**
 * The single-source contract file, addressed from THIS module rather than from
 * `uiDir`.
 *
 * The page fetches `ui-contract.json` next to itself so it can reconcile its
 * build-time constants against the host at runtime. Serving that request by
 * looking inside the page directory would 404 (the contract is not, and must not
 * be, copied into `plugin/ui/kb/` — two copies is the end of "single source"), so
 * it is served from its real location instead. A literal path derived from this
 * file's own URL is also why the alias cannot be turned into a reader for
 * anything else: it is a constant, not a caller-supplied path, and it stays
 * correct even when `uiDir` is overridden.
 */
const CONTRACT_FILE = fileURLToPath(new URL('../../ui-contract.json', import.meta.url))

/** Extensions a same-directory page asset may use, with their content types. */
const STATIC_TYPES = new Map([
  ['.html', HTML_TYPE],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', JSON_TYPE],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.map', JSON_TYPE]
])

export function registerKbPageRoutes(webServer, c) {
  const { disposers, uiDir } = c

  const serve = async (res, file, type, head) => {
    try {
      const body = await readFile(file)
      sendBytes(res, 200, body, type, { head })
      return true
    } catch {
      return false
    }
  }

  disposers.push(
    webServer.register({
      kind: 'prefix',
      path: KB_PAGE_BASE,
      handler: async (req, res) => {
        const method = methodOf(req)
        if (method !== 'GET' && method !== 'HEAD') {
          refuse(res, 405, 'method-not-allowed')
          return
        }
        const head = method === 'HEAD'
        const pathname = pathnameOf(req)
        let rest = pathname.startsWith(KB_PAGE_BASE) ? pathname.slice(KB_PAGE_BASE.length) : ''
        try {
          rest = decodeURIComponent(rest)
        } catch {
          refuse(res, 404, 'not found')
          return
        }
        rest = rest.replace(/^\/+/, '')
        // Backslashes are unified for the same reason the vault routes unify them:
        // on Windows `..\api\tree` is what an escape attempt actually looks like,
        // and the URL layer only normalizes the forward-slash form.
        rest = rest.replace(/\\/g, '/')

        if (rest === '' || rest === 'index.html') {
          if (!(await serve(res, join(uiDir, 'index.html'), HTML_TYPE, head))) {
            refuse(res, 404, 'kb page not available')
          }
          return
        }

        const segments = rest.split('/')
        const unsafeSegment = segments.some((segment) => segment === '' || segment === '.' || segment === '..')
        if (unsafeSegment || segments.length !== 1 || rest.includes('\u0000')) {
          refuse(res, 404, 'not found')
          return
        }
        // The json api lives under this prefix; an unknown api path is not a file.
        if (rest.startsWith('api/') || rest === 'api') {
          refuse(res, 404, 'not found')
          return
        }
        // The page's one runtime reconciliation target. Not a file in `uiDir`.
        if (rest === 'ui-contract.json') {
          if (!(await serve(res, CONTRACT_FILE, JSON_TYPE, head))) refuse(res, 404, 'not found')
          return
        }
        const type = STATIC_TYPES.get(extname(rest).toLowerCase())
        if (!type) {
          refuse(res, 404, 'not found')
          return
        }
        if (!(await serve(res, join(uiDir, rest), type, head))) refuse(res, 404, 'not found')
      }
    })
  )
}