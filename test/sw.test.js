import test from 'node:test'
import assert from 'node:assert/strict'

// Loads public/sw.js against a small fake of the service worker environment, then fires fetch and activate events.
const listeners = {}
const stores = new Map() // cache name -> Map(url -> response)
const fetched = []
let status = 200 // what the fake network answers with

const open = name => {
  if (!stores.has(name)) stores.set(name, new Map())
  const store = stores.get(name)
  return Promise.resolve({
    match: request => Promise.resolve(store.get(request.url)),
    put: (request, response) => Promise.resolve(store.set(request.url, response)),
    addAll: () => Promise.resolve(),
  })
}
globalThis.caches = {
  open,
  keys: () => Promise.resolve([...stores.keys()]),
  delete: name => Promise.resolve(stores.delete(name)),
}
globalThis.location = { origin: 'https://app.test' }
globalThis.fetch = async request => {
  fetched.push(request.url)
  const res = { ok: status < 400, status, body: `network:${request.url}`, clone: () => res }
  return res
}
globalThis.self = {
  addEventListener: (type, fn) => (listeners[type] = fn),
  skipWaiting: () => {},
  clients: { claim: () => {} },
}
await import('../public/sw.js')

const get = async path => {
  let answer
  const request = { method: 'GET', url: `https://app.test${path}`, mode: 'cors' }
  listeners.fetch({ request, respondWith: p => (answer = p) })
  return answer && (await answer)
}
const art = () => stores.get('bible-scroll-art')

test('a picture is fetched once and then always served from its own cache', async () => {
  fetched.length = 0
  const first = await get('/api/art/book-john?v=1')
  assert.equal(first.body, 'network:https://app.test/api/art/book-john?v=1')
  const again = await get('/api/art/book-john?v=1')
  assert.equal(again, first)
  assert.equal(fetched.length, 1, 'only the first look goes to the network')
  assert.ok(art().has('https://app.test/api/art/book-john?v=1'))
})

test('a redone picture has a new version in its address, so it is fetched again', async () => {
  fetched.length = 0
  await get('/api/art/book-john?v=2')
  assert.equal(fetched.length, 1)
})

test('a picture that is still being painted, or failed, is not kept', async () => {
  for (const code of [202, 429, 502]) {
    status = code
    fetched.length = 0
    await get('/api/art/red-sea?v=0')
    await get('/api/art/red-sea?v=0')
    assert.equal(fetched.length, 2, `${code} is asked for again`)
    assert.ok(!art().has('https://app.test/api/art/red-sea?v=0'), `${code} is not cached`)
  }
  status = 200
})

test('the plan, and every other API call, is left to the network', async () => {
  fetched.length = 0
  assert.equal(await get('/api/art/plan'), undefined)
  assert.equal(await get('/api/passage?book=0&chapter=1'), undefined)
  assert.equal(fetched.length, 0, 'the worker does not answer them')
})

test('a post to redo a picture is never intercepted', () => {
  let answered = false
  const request = { method: 'POST', url: 'https://app.test/api/art/red-sea/regenerate', mode: 'cors' }
  listeners.fetch({ request, respondWith: () => (answered = true) })
  assert.equal(answered, false)
})

test('a new app version keeps the pictures but drops old app caches', async () => {
  stores.set('bible-scroll-v1', new Map())
  let done
  listeners.activate({ waitUntil: p => (done = p) })
  await done
  assert.ok(stores.has('bible-scroll-art'), 'pictures survive an update')
  assert.ok(!stores.has('bible-scroll-v1'), 'an old app cache is removed')
})
