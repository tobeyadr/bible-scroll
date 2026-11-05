import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { handleArt, providerFor, canMake, dailyLimit, sniffType, promptFor, DAILY_LIMIT } from '../src/art.js'

// A D1-shaped wrapper over node:sqlite, so the real queries run.
function fakeD1() {
  const sqlite = new DatabaseSync(':memory:')
  return {
    exec: async sql => void sqlite.exec(sql),
    prepare: sql => {
      const make = params => ({
        bind: (...next) => make(next),
        first: async () => sqlite.prepare(sql).get(...params) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
        run: async () => void sqlite.prepare(sql).run(...params),
      })
      return make([])
    },
    sqlite,
  }
}

const WEBP = btoa('RIFF\0\0\0\0WEBPVP8 pretend')
const PNG = btoa('\x89PNG\r\n\x1a\npretend')

// Stands in for the image API. Each call is recorded; `next` decides the answer.
function fakeApi() {
  const api = { calls: [], next: () => Response.json({ data: [{ b64_json: WEBP }] }) }
  globalThis.fetch = async (url, init) => {
    api.calls.push({ url, init, body: JSON.parse(init.body) })
    return api.next()
  }
  return api
}

const ctx = { waitUntil: () => {} }
const send = (env, path, method = 'GET') => handleArt(new Request(`https://app.test/api/art/${path}`, { method }), env, ctx, path)
const setup = (extra = {}) => ({ DB: fakeD1(), OPENAI_API_KEY: 'sk-test', ...extra })

test('sniffType reads the format from the first bytes', () => {
  assert.equal(sniffType(Uint8Array.from(atob(WEBP), c => c.charCodeAt(0))), 'image/webp')
  assert.equal(sniffType(Uint8Array.from(atob(PNG), c => c.charCodeAt(0))), 'image/png')
  assert.equal(sniffType(Uint8Array.from([0xff, 0xd8, 0xff])), 'image/jpeg')
  assert.equal(sniffType(Uint8Array.from([1, 2, 3, 4])), null)
})

test('the provider follows ART_PROVIDER, otherwise whichever key is set, OpenAI first', () => {
  assert.equal(providerFor({ OPENAI_API_KEY: 'a' }).key, 'OPENAI_API_KEY')
  assert.equal(providerFor({ XAI_API_KEY: 'a' }).key, 'XAI_API_KEY')
  assert.equal(providerFor({ OPENAI_API_KEY: 'a', XAI_API_KEY: 'b' }).key, 'OPENAI_API_KEY')
  assert.equal(providerFor({ OPENAI_API_KEY: 'a', XAI_API_KEY: 'b', ART_PROVIDER: 'xai' }).key, 'XAI_API_KEY')
  assert.ok(canMake({ DB: {}, XAI_API_KEY: 'x' }))
  assert.ok(!canMake({ DB: {}, ART_PROVIDER: 'xai', OPENAI_API_KEY: 'x' }), 'the chosen provider needs its own key')
  assert.ok(!canMake({ OPENAI_API_KEY: 'x' }), 'and a database')
  assert.equal(dailyLimit({}), DAILY_LIMIT)
  assert.equal(dailyLimit({ ART_DAILY_LIMIT: '5' }), 5)
  assert.equal(dailyLimit({ ART_DAILY_LIMIT: '0' }), 0)
})

test('the prompt is the shared style plus the scene', () => {
  const prompt = promptFor('red-sea')
  assert.match(prompt, /Subject: /)
  assert.ok(prompt.length > 300)
})

test('the plan lists every passage, and is empty when there is nothing to show or make', async () => {
  const env = setup()
  const body = await (await send(env, 'plan')).json()
  assert.ok(body.art.length > 150)
  assert.ok(body.art.some(e => e.ref === 'Genesis' && e.img === 'book-genesis'))
  assert.deepEqual(body.versions, {})

  const bare = setup({ OPENAI_API_KEY: undefined })
  assert.deepEqual(await (await send(bare, 'plan')).json(), { art: [], versions: {} })
})

test('the first look paints the picture and keeps it; the second look costs nothing', async () => {
  const api = fakeApi()
  const env = setup()
  const first = await send(env, 'red-sea')
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('Content-Type'), 'image/webp')
  assert.equal(first.headers.get('X-Art-Version'), '1')
  assert.match(first.headers.get('Cache-Control'), /immutable/)
  assert.equal(api.calls.length, 1)
  assert.equal(api.calls[0].url, 'https://api.openai.com/v1/images/generations')
  assert.equal(api.calls[0].init.headers.Authorization, 'Bearer sk-test')
  assert.equal(api.calls[0].body.size, '1024x1536')
  assert.match(api.calls[0].body.prompt, /Subject: /)

  const again = await send(env, 'red-sea')
  assert.equal(again.status, 200)
  assert.equal(api.calls.length, 1, 'served from the database')
  assert.deepEqual((await (await send(env, 'plan')).json()).versions, { 'red-sea': 1 })
})

test('xAI is called in its own shape', async () => {
  const api = fakeApi()
  const env = setup({ OPENAI_API_KEY: undefined, XAI_API_KEY: 'xai-test' })
  assert.equal((await send(env, 'red-sea')).status, 200)
  assert.equal(api.calls[0].url, 'https://api.x.ai/v1/images/generations')
  assert.equal(api.calls[0].body.response_format, 'b64_json')
})

test('a picture the API hands back as an address is downloaded', async () => {
  const api = fakeApi()
  api.next = () => Response.json({ data: [{ url: 'https://files.test/a.png' }] })
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) =>
    url === 'https://files.test/a.png' ? new Response(Uint8Array.from(atob(PNG), c => c.charCodeAt(0))) : original(url, init)
  const res = await send(setup(), 'red-sea')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'image/png')
})

test('without a key nothing is painted, but a stored picture is still served', async () => {
  const api = fakeApi()
  const env = setup()
  await send(env, 'red-sea')
  const keyless = { DB: env.DB }
  assert.equal((await send(keyless, 'red-sea')).status, 200)
  assert.equal((await send(keyless, 'crucifixion')).status, 404)
  assert.equal(api.calls.length, 1)
})

test('only one picture is painted at a time: others are told to ask again', async () => {
  const api = fakeApi()
  let release
  api.next = () => new Promise(resolve => (release = () => resolve(Response.json({ data: [{ b64_json: WEBP }] }))))
  const env = setup()
  const first = send(env, 'red-sea')
  await new Promise(resolve => setTimeout(resolve, 20))
  const second = await send(env, 'red-sea')
  assert.equal(second.status, 202)
  assert.equal(second.headers.get('Retry-After'), '8')
  assert.equal(api.calls.length, 1)
  release()
  assert.equal((await first).status, 200)
  assert.equal((await send(env, 'red-sea')).status, 200)
})

test('a failure is reported, not stored, and retried only after a pause', async () => {
  const api = fakeApi()
  api.next = () => Response.json({ error: { message: 'content policy' } }, { status: 400 })
  const env = setup()
  const first = await send(env, 'red-sea')
  assert.equal(first.status, 502)
  const soon = await send(env, 'red-sea')
  assert.equal(soon.status, 502)
  assert.equal(api.calls.length, 1, 'not hammered')
  assert.deepEqual((await (await send(env, 'plan')).json()).versions, {})

  env.DB.sqlite.exec('UPDATE art_job SET started_at = started_at - 120000')
  api.next = () => Response.json({ data: [{ b64_json: WEBP }] })
  assert.equal((await send(env, 'red-sea')).status, 200)
  assert.equal(api.calls.length, 2)
})

test('something that is not a picture is refused', async () => {
  const api = fakeApi()
  api.next = () => Response.json({ data: [{ b64_json: btoa('<html>nope</html>') }] })
  const env = setup()
  assert.equal((await send(env, 'red-sea')).status, 502)
  assert.equal((await send(env, 'plan').then(r => r.json())).versions['red-sea'], undefined)
})

test('the daily allowance stops new pictures, and a failed one does not use it up', async () => {
  const api = fakeApi()
  const env = setup({ ART_DAILY_LIMIT: '2' })
  assert.equal((await send(env, 'red-sea')).status, 200)
  api.next = () => new Response('boom', { status: 500 })
  assert.equal((await send(env, 'crucifixion')).status, 502)
  env.DB.sqlite.exec('DELETE FROM art_job')
  api.next = () => Response.json({ data: [{ b64_json: WEBP }] })
  assert.equal((await send(env, 'crucifixion')).status, 200, 'the failure was given back')
  const over = await send(env, 'building-the-ark')
  assert.equal(over.status, 429)
  assert.match((await over.json()).error, /all the new pictures for today/)
  assert.equal((await send(env, 'red-sea')).status, 200, 'pictures already made are still free')
})

test('redo paints a new picture, counts the version up, and replaces the stored one', async () => {
  const api = fakeApi()
  const env = setup()
  await send(env, 'red-sea')
  const redo = await send(env, 'red-sea/regenerate', 'POST')
  assert.equal(redo.status, 200)
  assert.deepEqual(await redo.json(), { version: 2 })
  assert.equal(api.calls.length, 2)
  assert.equal((await send(env, 'red-sea')).headers.get('X-Art-Version'), '2')
})

test('a failed redo keeps the picture that is there', async () => {
  const api = fakeApi()
  const env = setup()
  await send(env, 'red-sea')
  api.next = () => new Response('boom', { status: 500 })
  assert.equal((await send(env, 'red-sea/regenerate', 'POST')).status, 502)
  const kept = await send(env, 'red-sea')
  assert.equal(kept.status, 200)
  assert.equal(kept.headers.get('X-Art-Version'), '1')
})

test('the wrong id, address or method is turned away without a call to the API', async () => {
  const api = fakeApi()
  const env = setup()
  assert.equal((await send(env, 'not-a-picture')).status, 404)
  assert.equal((await send(env, 'red-sea/other', 'POST')).status, 404)
  assert.equal((await send(env, 'red-sea/regenerate/x', 'POST')).status, 404)
  assert.equal((await send(env, 'red-sea/regenerate')).status, 405)
  assert.equal((await send(env, 'red-sea', 'POST')).status, 405)
  assert.equal((await send(env, 'plan', 'POST')).status, 405)
  assert.equal((await handleArt(new Request('https://app.test/api/art/plan'), {}, ctx, 'plan')).status, 500, 'no database')
  assert.equal(api.calls.length, 0)
})

test('the rate limiter holds back a flood of new pictures', async () => {
  const api = fakeApi()
  const env = setup({ ART_LIMITER: { limit: async () => ({ success: false }) } })
  const res = await send(env, 'red-sea')
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('Retry-After'), '60')
  assert.equal(api.calls.length, 0)
})
