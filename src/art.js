import plan from '../art/images.json' with { type: 'json' }

// The pictures for the Illustrated theme, made on demand. The plan (art/images.json) says which passages get which
// picture and what to paint; the first time a picture is asked for, an image API paints it, and it is kept in D1
// for good, so each one is made once however often it is read. "Redo" paints a fresh one in its place.
//
//   GET  /api/art/plan               which picture goes with which passage, and which already exist
//   GET  /api/art/<id>               the picture, painting it first if it does not exist yet
//   POST /api/art/<id>/regenerate    paint a new one to replace it

export const DAILY_LIMIT = 40 // new pictures a day (OPENAI_API_KEY / XAI_API_KEY bills per picture)
const STALE_JOB_MS = 3 * 60 * 1000 // a picture "being painted" for longer than this is assumed lost
const RETRY_FAILED_MS = 60 * 1000 // after a failure, wait this long before trying that picture again
const TIMEOUT_MS = 120 * 1000
const MAX_BYTES = 1_400_000 // as base64 this stays under D1's 2 MB limit for one row

const IMAGES = new Map(plan.images.map(image => [image.id, image]))

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

// ---------- providers ----------

// The text-to-image APIs. Both answer with the picture as base64. OpenAI is the tested one; the xAI request follows
// its published shape but has not been run against the live service.
export const PROVIDERS = {
  openai: {
    key: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/images/generations',
    body: (env, prompt) => ({
      model: env.ART_MODEL || 'gpt-image-1',
      prompt,
      size: `${plan.size.width}x${plan.size.height}`,
      quality: env.ART_QUALITY || 'medium',
      output_format: 'webp',
      output_compression: 80,
      n: 1,
    }),
  },
  xai: {
    key: 'XAI_API_KEY',
    url: 'https://api.x.ai/v1/images/generations',
    body: (env, prompt) => ({ model: env.ART_MODEL || 'grok-imagine-image', prompt, n: 1, response_format: 'b64_json', aspect_ratio: '2:3' }),
  },
}

// ART_PROVIDER picks one; otherwise whichever key is set (OpenAI first).
export function providerFor(env) {
  const named = PROVIDERS[env.ART_PROVIDER]
  if (named) return named
  return env.XAI_API_KEY && !env.OPENAI_API_KEY ? PROVIDERS.xai : PROVIDERS.openai
}

export const canMake = env => !!env.DB && !!env[providerFor(env).key]

export const dailyLimit = env => Math.max(0, Math.floor(Number(env.ART_DAILY_LIMIT ?? DAILY_LIMIT)) || 0)

export const promptFor = id => `${plan.style}\n\nSubject: ${IMAGES.get(id).prompt}`

const bytesOf = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0))

// The format from the first bytes, so a picture is served as what it really is.
export function sniffType(bytes) {
  const at = (i, text) => [...text].every((ch, k) => bytes[i + k] === ch.charCodeAt(0))
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp'
  if (at(1, 'PNG')) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  return null
}

// Asks the image API for one picture. Returns { data: base64, type }.
export async function paint(env, id) {
  const provider = providerFor(env)
  const res = await fetch(env.ART_API_URL || provider.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env[provider.key]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(provider.body(env, promptFor(id))),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.json().then(b => b.error?.message || b.error || '', () => '')
    throw new Error(`image API ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`)
  }
  const item = (await res.json()).data?.[0]
  let data = item?.b64_json
  if (!data && item?.url) {
    // Some APIs hand back an address instead; fetch it and keep the bytes.
    const file = await fetch(item.url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!file.ok) throw new Error(`image download ${file.status}`)
    const raw = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < raw.length; i += 0x8000) binary += String.fromCharCode(...raw.subarray(i, i + 0x8000))
    data = btoa(binary)
  }
  if (!data) throw new Error('the image API sent no picture')
  const bytes = bytesOf(data)
  const type = sniffType(bytes)
  if (!type) throw new Error('the image API sent something that is not a picture')
  if (bytes.length > MAX_BYTES) throw new Error('the picture is too large')
  return { data, type }
}

// ---------- storage ----------

const ready = new WeakMap()
function ensureSchema(db) {
  if (!ready.has(db)) {
    const done = (async () => {
      await db.exec('CREATE TABLE IF NOT EXISTS art_image (id TEXT PRIMARY KEY, data TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL, made_at INTEGER NOT NULL)')
      await db.exec('CREATE TABLE IF NOT EXISTS art_job (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, error TEXT)')
      await db.exec('CREATE TABLE IF NOT EXISTS art_usage (day TEXT PRIMARY KEY, n INTEGER NOT NULL)')
    })().catch(err => {
      ready.delete(db)
      throw err
    })
    ready.set(db, done)
  }
  return ready.get(db)
}

const getImage = (db, id) => db.prepare('SELECT data, type, version FROM art_image WHERE id = ?').bind(id).first()

async function versions(db) {
  const { results } = await db.prepare('SELECT id, version FROM art_image').all()
  return Object.fromEntries(results.map(row => [row.id, row.version]))
}

// A new picture is version 1; painting it again counts up, which is how phones know to fetch the new one.
async function saveImage(db, id, { data, type }) {
  const row = await db
    .prepare(
      'INSERT INTO art_image (id, data, type, version, made_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, type = excluded.type, version = art_image.version + 1, made_at = excluded.made_at RETURNING version',
    )
    .bind(id, data, type, Date.now())
    .first()
  return row.version
}

// One picture is painted at a time. Taking the job says "I will"; a job that is still fresh, or failed a moment ago,
// is left alone. Returns true when the caller now owns it.
async function takeJob(db, id) {
  const now = Date.now()
  const row = await db
    .prepare(
      'INSERT INTO art_job (id, started_at, error) VALUES (?, ?, NULL) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, error = NULL WHERE (art_job.error IS NULL AND art_job.started_at < ?) OR (art_job.error IS NOT NULL AND art_job.started_at < ?) RETURNING id',
    )
    .bind(id, now, now - STALE_JOB_MS, now - RETRY_FAILED_MS)
    .first()
  return !!row
}

const endJob = (db, id) => db.prepare('DELETE FROM art_job WHERE id = ?').bind(id).run()
const failJob = (db, id, message) => db.prepare('UPDATE art_job SET error = ? WHERE id = ?').bind(message, id).run()
const jobOf = (db, id) => db.prepare('SELECT started_at, error FROM art_job WHERE id = ?').bind(id).first()

// The day's allowance of new pictures, counted before the API is called (and given back if it fails).
async function takeSlot(env) {
  const limit = dailyLimit(env)
  const day = new Date().toISOString().slice(0, 10)
  const row = await env.DB.prepare('INSERT INTO art_usage (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n').bind(day).first()
  if (row.n > limit) {
    await giveBackSlot(env, day)
    return { error: `That is all the new pictures for today (${limit}). It starts again at midnight UTC.` }
  }
  return { day }
}

const giveBackSlot = (env, day) => env.DB.prepare('UPDATE art_usage SET n = MAX(n - 1, 0) WHERE day = ?').bind(day).run().catch(() => {})

// ---------- routes ----------

function picture(image) {
  return new Response(bytesOf(image.data), {
    headers: {
      'Content-Type': image.type,
      // The address carries the version, so a picture can be kept for good.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Art-Version': String(image.version),
    },
  })
}

// Paints one picture and stores it, as a unit that carries on (via waitUntil) even if the reader moves on.
// Resolves to { version } or { error }, and never throws.
async function make(env, id) {
  const slot = await takeSlot(env).catch(err => ({ error: String(err.message || err) }))
  if (slot.error) {
    await endJob(env.DB, id).catch(() => {})
    return { error: slot.error, status: 429 }
  }
  try {
    const version = await saveImage(env.DB, id, await paint(env, id))
    await endJob(env.DB, id)
    return { version }
  } catch (err) {
    console.error('art: could not paint', id, err)
    await giveBackSlot(env, slot.day)
    await failJob(env.DB, id, 'The picture could not be made. It will try again in a minute.').catch(() => {})
    return { error: 'The picture could not be made right now.', status: 502 }
  }
}

export async function handleArt(request, env, ctx, rest) {
  if (!env.DB) return json({ error: 'Pictures are not set up on this server.' }, 500)
  await ensureSchema(env.DB)

  if (rest === 'plan') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
    const have = await versions(env.DB)
    // Only worth offering when there is something to show, or a key to make it with.
    if (!canMake(env) && !Object.keys(have).length) return json({ art: [], versions: {} })
    const art = plan.images.flatMap(image => image.refs.map(ref => ({ ref, img: image.id })))
    return json({ art, versions: have })
  }

  const [id, action, ...extra] = rest.split('/')
  if (!IMAGES.has(id) || extra.length) return json({ error: 'Unknown picture' }, 404)
  const redo = action === 'regenerate'
  if (action !== undefined && !redo) return json({ error: 'Unknown picture' }, 404)
  if (redo ? request.method !== 'POST' : request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  if (!redo) {
    const stored = await getImage(env.DB, id)
    if (stored) return picture(stored)
  }
  if (!canMake(env)) return json({ error: 'No picture yet, and no image API key is set.' }, redo ? 500 : 404)

  // Making a picture costs money, so one address only gets a few a minute.
  const ip = request.headers.get('CF-Connecting-IP') || 'local'
  if (env.ART_LIMITER && !(await env.ART_LIMITER.limit({ key: `art:${ip}` })).success) {
    return json({ error: 'Too many pictures at once. Wait a minute.' }, 429, { 'Retry-After': '60' })
  }

  if (!(await takeJob(env.DB, id))) {
    const job = await jobOf(env.DB, id)
    if (job?.error) return json({ error: job.error }, 502)
    return json({ status: 'making' }, 202, { 'Retry-After': '8' }) // someone else started it; ask again soon
  }

  const work = make(env, id)
  ctx?.waitUntil(work)
  const result = await work
  if (result.error) return json({ error: result.error }, result.status)
  if (redo) return json({ version: result.version })
  return picture(await getImage(env.DB, id))
}
