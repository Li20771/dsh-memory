// contract.js — `plugin/ui-contract.json` read once, resolved to absolute paths.
//
// The contract file is the single source for the HTTP prefix and the route
// paths (build-contract §1). Three consumers read it (these routes, the client
// build script, the cross-edge test); nothing here may restate a literal path or
// the prefix, or the single source stops being single.
//
// @module dsh-memory/routes/contract

import { createRequire } from 'node:module'

// `createRequire` rather than an import attribute: reading a JSON file next to
// this module needs no bundler, no copy step, and no JSON-module syntax that
// varies by Node version. A missing or renamed file fails loudly at load.
// This module lives in `plugin/lib/routes/`, so the contract file is two levels up.
const requireJson = createRequire(import.meta.url)
const contract = requireJson('../../ui-contract.json')

export const CONTRACT = contract

/** `/dsh-memory` */
export const PREFIX = String(contract.prefix ?? '')

const under = (path) => `${PREFIX}${String(path)}`

/** Registered route paths for the panel family. */
export const PANEL = {
  overview: under(contract.panel?.overview),
  workflow: under(contract.panel?.workflow)
}

/** Registered route paths for the knowledge-base family. */
export const KB = {
  page: under(contract.kb?.page),
  open: under(contract.kb?.open),
  tree: under(contract.kb?.tree),
  note: under(contract.kb?.note),
  resolve: under(contract.kb?.resolve),
  search: under(contract.kb?.search)
}

/**
 * Prefix seat for the page plus its same-directory static files: `/dsh-memory/kb`
 * with the trailing slash removed, so `/kb` and `/kb/app.js` both reach it while
 * the `/kb/api/*` routes win as exact registrations.
 */
export const KB_PAGE_BASE = `${PREFIX}${String(contract.kb?.page ?? '').replace(/\/+$/, '')}`