// Stores one opaque, client-encrypted blob per sync space. The server never sees what is inside it.
//
//   GET    /api/sync/<id>   -> { blob } + ETag            (304 if If-None-Match matches)
//   PUT    /api/sync/<id>   -> create with If-None-Match: *, update with If-Match: "<version>"
//   DELETE /api/sync/<id>
//
// <id> is derived from the user's secret and every request carries a derived bearer token, so
// neither can be guessed. Only the token's hash is stored.

const ID = /^[0-9a-f]{64}$/
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const MAX_BLOB = 1_400_000 // base64 characters, about 1 MiB of data

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })

const etag = version => `"${version}"`

async function sha256Hex(text) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('')
}

let schema = null
function ensureSchema(db) {
  schema ??= db
    .exec('CREATE TABLE IF NOT EXISTS sync (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, blob TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
    .catch(err => {
      schema = null
      throw err
    })
  return schema
}

export async function handleSync(request, env, id) {
  if (!env.DB) return json({ error: 'Sync is not set up on this server' }, 501)
  if (!ID.test(id)) return json({ error: 'Not found' }, 404)

  const ip = request.headers.get('CF-Connecting-IP') || 'local'
  if (env.SYNC_LIMITER && !(await env.SYNC_LIMITER.limit({ key: ip })).success) {
    return json({ error: 'Too many requests' }, 429, { 'Retry-After': '60' })
  }

  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer /, '')
  if (!TOKEN.test(bearer)) return json({ error: 'Unauthorized' }, 401)
  const tokenHash = await sha256Hex(bearer)

  await ensureSchema(env.DB)
  const row = await env.DB.prepare('SELECT token_hash, blob, version FROM sync WHERE id = ?').bind(id).first()

  if (request.method === 'PUT') return put(request, env, id, tokenHash, row)

  if (!row) return json({ error: 'Not found' }, 404)
  if (row.token_hash !== tokenHash) return json({ error: 'Unauthorized' }, 401)

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sync WHERE id = ?').bind(id).run()
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }

  if (request.headers.get('If-None-Match') === etag(row.version)) {
    return new Response(null, { status: 304, headers: { ETag: etag(row.version), 'Cache-Control': 'no-store' } })
  }
  return json({ blob: row.blob }, 200, { ETag: etag(row.version) })
}

async function put(request, env, id, tokenHash, row) {
  const text = await request.text()
  if (text.length > MAX_BLOB + 64) return json({ error: 'Too large' }, 413)
  let blob
  try {
    blob = JSON.parse(text).blob
  } catch {}
  if (typeof blob !== 'string' || blob.length > MAX_BLOB || !BASE64.test(blob)) return json({ error: 'Bad request' }, 400)

  const now = Date.now()

  if (request.headers.get('If-None-Match') === '*') {
    const result = await env.DB.prepare(
      'INSERT INTO sync (id, token_hash, blob, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(id, tokenHash, blob, now)
      .run()
    if (result.meta.changes === 0) return json({ error: 'Already exists' }, 409)
    return json({ ok: true }, 201, { ETag: etag(1) })
  }

  const match = (request.headers.get('If-Match') || '').match(/^"(\d+)"$/)
  if (!match) return json({ error: 'If-Match or If-None-Match is required' }, 428)

  if (!row) return json({ error: 'Not found' }, 404)
  if (row.token_hash !== tokenHash) return json({ error: 'Unauthorized' }, 401)

  const version = Number(match[1])
  const result = await env.DB.prepare(
    'UPDATE sync SET blob = ?, version = version + 1, updated_at = ? WHERE id = ? AND token_hash = ? AND version = ?',
  )
    .bind(blob, now, id, tokenHash, version)
    .run()
  if (result.meta.changes === 0) return json({ error: 'Out of date' }, 409, { ETag: etag(row.version) })
  return json({ ok: true }, 200, { ETag: etag(version + 1) })
}

// Spaces nobody has touched for a year are deleted.
export async function expireOld(env) {
  if (!env.DB) return
  await ensureSchema(env.DB)
  await env.DB.prepare('DELETE FROM sync WHERE updated_at < ?').bind(Date.now() - 365 * 24 * 60 * 60 * 1000).run()
}
