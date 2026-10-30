// http.js — the only implementation of "answer an HTTP request" in this plugin.
//
// Three things are shared by every route and belong in exactly one place:
//   · request parsing (pathname, query, one-shot JSON body with a byte cap)
//   · response writing (JSON and bytes, with `Cache-Control: no-store`)
//   · the `{ ok:false, error }` refusal body
// Copying any of them per route is how one route ends up without the body cap or
// with a different error vocabulary than the UI was written against.
//
// Node builtins only (plugin constraint 1). No compression: the host webserver
// already offers gzip for the whole listener, and adding a second layer here
// would be a behaviour the tests could not see.
//
// @module dsh-memory/routes/http

const BASE = 'http://127.0.0.1'

/** Content type for every JSON answer in this plugin. */
export const JSON_TYPE = 'application/json; charset=utf-8'

/** Default JSON body cap. A panel action body is a handful of short fields. */
export const JSON_BODY_MAX_BYTES = 64 * 1024

/** `req.method` upper-cased, defaulting to GET. */
export function methodOf(req) {
  return String(req?.method ?? 'GET').toUpperCase()
}

/** The request's pathname, parsed the same way the host parses it. */
export function pathnameOf(req) {
  try {
    return new URL(String(req?.url ?? '/'), BASE).pathname
  } catch {
    return '/'
  }
}

/** The request's query parameters. */
export function searchOf(req) {
  try {
    return new URL(String(req?.url ?? '/'), BASE).searchParams
  } catch {
    return new URLSearchParams('')
  }
}

/** A trimmed query parameter, or '' when absent/blank. */
export function paramOf(search, name) {
  const value = search.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/** Write a JSON answer. `cacheControl: null` omits the header. */
export function sendJson(res, code, payload, cacheControl = 'no-store') {
  res.statusCode = code
  res.setHeader('Content-Type', JSON_TYPE)
  if (cacheControl !== null) res.setHeader('Cache-Control', cacheControl)
  res.end(Buffer.from(JSON.stringify(payload), 'utf8'))
}

/** Write bytes (or a string) with an explicit content type. */
export function sendBytes(res, code, body, contentType, { head = false } = {}) {
  res.statusCode = code
  if (contentType) res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-store')
  if (head) {
    res.end()
    return
  }
  res.end(Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8'))
}

/** The one refusal body shape. `extra` carries contract-mandated fields. */
export function refuse(res, code, error, extra) {
  sendJson(res, code, { ok: false, error, ...(extra ?? {}) })
}

/**
 * Buffer one JSON request body.
 *
 * Two invariants, both deliberate:
 *   ① the cap is checked against CUMULATIVE bytes (`size += chunk.length`), not
 *      against the final length — checking the length after buffering is not a
 *      cap at all;
 *   ② the bytes are decoded ONCE at the end. Concatenating text chunk by chunk
 *      would cut a multi-byte character that straddles a TCP segment into U+FFFD
 *      and silently write a corrupted string.
 *
 * @returns {Promise<{ok:true, value:object} | {ok:false, error:'bad-request'}>}
 */
export function readJsonBody(req, maxBytes = JSON_BODY_MAX_BYTES) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    if (typeof req?.on !== 'function') {
      done({ ok: false, error: 'bad-request' })
      return
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        done({ ok: false, error: 'bad-request' })
        try {
          if (typeof req.resume === 'function') req.resume()
        } catch {
          // the request is already being refused; nothing to recover
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        done({ ok: true, value: {} })
        return
      }
      try {
        const value = JSON.parse(text)
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          done({ ok: false, error: 'bad-request' })
          return
        }
        done({ ok: true, value })
      } catch {
        done({ ok: false, error: 'bad-request' })
      }
    })
    req.on('error', () => done({ ok: false, error: 'bad-request' }))
  })
}