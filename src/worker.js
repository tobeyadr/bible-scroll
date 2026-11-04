import { BOOKS } from '../public/books.js'
import { handleSync, expireOld } from './sync.js'
import { handleAsk } from './ask.js'

const ESV_URL = 'https://api.esv.org/v3/passage/text/'

const ESV_PARAMS = {
  'include-passage-references': 'false',
  'include-verse-numbers': 'true',
  'include-first-verse-numbers': 'true',
  'include-footnotes': 'false',
  'include-footnote-body': 'false',
  'include-headings': 'false',
  'include-short-copyright': 'false',
  'include-copyright': 'false',
  'include-passage-horizontal-lines': 'false',
  'include-heading-horizontal-lines': 'false',
  'include-selahs': 'true',
  'indent-using': 'space',
  'indent-paragraphs': '0',
  'indent-poetry': 'true',
  'indent-poetry-lines': '2',
  'indent-declares': '0',
  'indent-psalm-doxology': '0',
  'line-length': '0',
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(expireOld(env))
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Only the app itself may use the API.
    const origin = request.headers.get('Origin')
    if (origin && new URL(origin).host !== url.host) {
      return json({ error: 'Forbidden' }, 403)
    }

    if (url.pathname.startsWith('/api/sync/')) {
      if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
      return handleSync(request, env, url.pathname.slice('/api/sync/'.length))
    }

    if (url.pathname === '/api/ask') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      return handleAsk(request, env)
    }

    if (url.pathname !== '/api/passage') {
      return json({ error: 'Not found' }, 404)
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const book = Number(url.searchParams.get('book'))
    const chapter = Number(url.searchParams.get('chapter'))
    const info = BOOKS[book]
    if (!Number.isInteger(book) || !info || !Number.isInteger(chapter) || chapter < 1 || chapter > info.c) {
      return json({ error: 'Unknown book or chapter' }, 400)
    }

    if (!env.ESV_API_KEY) {
      return json({ error: 'ESV_API_KEY is not configured' }, 500)
    }

    const cache = caches.default
    const cacheKey = new Request(`${url.origin}/api/passage?book=${book}&chapter=${chapter}`)
    const hit = await cache.match(cacheKey)
    if (hit) return hit

    // Only cache misses reach the ESV API, and only a few per minute from one address, so the key stays
    // within Crossway's limits even if someone finds the URL.
    const ip = request.headers.get('CF-Connecting-IP') || 'local'
    if (env.SYNC_LIMITER && !(await env.SYNC_LIMITER.limit({ key: `esv:${ip}` })).success) {
      return json({ error: 'Too many requests' }, 429, { 'Retry-After': '60' })
    }

    // A bare "Jude 1" can be read as verse 1, so single-chapter books are requested by name.
    const q = info.c === 1 ? info.q : `${info.q} ${chapter}`
    const upstream = await fetch(`${env.ESV_API_URL || ESV_URL}?${new URLSearchParams({ q, ...ESV_PARAMS })}`, {
      headers: { Authorization: `Token ${env.ESV_API_KEY}` },
    })
    if (!upstream.ok) {
      return json({ error: 'ESV API error', status: upstream.status }, 502)
    }

    const data = await upstream.json()
    const text = data.passages?.[0]
    if (!text) {
      return json({ error: 'Passage not found' }, 404)
    }

    const response = json({ book, chapter, text }, 200, { 'Cache-Control': 'public, max-age=3600' })
    ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  },
}
