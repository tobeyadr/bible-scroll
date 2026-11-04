// Keeps her data in step across devices through the Worker, without an account.
// See keys.js for what the secret is and merge.js for how two copies are combined.
import { mergeDocs, sameDoc, canon } from './merge.js'
import { b64u, generateSecret, deriveKeys, encryptDoc, decryptDoc, phraseFromSecret, secretFromPhrase } from './keys.js'

const CONFIG = 'bs:sync' // { secret, etag, hash, last } for this device

async function digest(doc) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon(doc))))
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('')
}

const ERRORS = {
  401: 'The server did not accept this sync phrase.',
  413: 'Your notes have grown too large to sync.',
  429: 'Too many requests. Try again in a minute.',
}

export function createSync({ state, storage, base = '', fetchFn = (...args) => globalThis.fetch(...args), delay = 4000 }) {
  const readConfig = () => {
    try {
      return JSON.parse(storage.getItem(CONFIG))
    } catch {
      return null
    }
  }
  const writeConfig = cfg => {
    try {
      if (cfg) storage.setItem(CONFIG, JSON.stringify(cfg))
      else storage.removeItem(CONFIG)
    } catch {}
  }

  let status = { state: readConfig() ? 'idle' : 'off', error: null, last: readConfig()?.last ?? null }
  const listeners = new Set()
  const setStatus = patch => {
    status = { ...status, ...patch }
    listeners.forEach(fn => fn(status))
  }

  let keysCache = null
  async function keysFor(secretText) {
    if (keysCache?.secret !== secretText) keysCache = { secret: secretText, keys: await deriveKeys(b64u.decode(secretText)) }
    return keysCache.keys
  }

  const call = (keys, method, headers = {}, body) =>
    fetchFn(`${base}/api/sync/${keys.id}`, {
      method,
      headers: { Authorization: `Bearer ${keys.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body,
    })

  const fail = res => new Error(ERRORS[res.status] || `Sync failed (HTTP ${res.status}).`)

  // Upload `doc`. Returns the new etag, or null if someone else wrote first (409).
  async function put(keys, secretText, doc, headers) {
    const res = await call(keys, 'PUT', headers, JSON.stringify({ blob: await encryptDoc(keys.key, doc) }))
    if (res.status === 409) return null
    if (!res.ok) throw fail(res)
    const etag = res.headers.get('ETag')
    writeConfig({ secret: secretText, etag, hash: await digest(doc), last: Date.now() })
    return etag
  }

  // One full round: fetch the server copy, merge it in, upload if the merge has something new.
  async function round() {
    const cfg = readConfig()
    if (!cfg) return
    const keys = await keysFor(cfg.secret)

    for (let attempt = 0; attempt < 4; attempt++) {
      const current = readConfig()
      const res = await call(keys, 'GET', current.etag ? { 'If-None-Match': current.etag } : {})

      if (res.status === 404) {
        // The server copy is gone (expired or deleted elsewhere): put ours back.
        if (await put(keys, current.secret, state.snapshot(), { 'If-None-Match': '*' })) return
        continue
      }

      if (res.status === 304) {
        const local = state.snapshot()
        if ((await digest(local)) === current.hash) {
          writeConfig({ ...current, last: Date.now() })
          return
        }
        if (await put(keys, current.secret, local, { 'If-Match': current.etag })) return
        continue
      }

      if (!res.ok) throw fail(res)

      const etag = res.headers.get('ETag')
      const remote = await decryptDoc(keys.key, (await res.json()).blob)
      const local = state.snapshot()
      const merged = mergeDocs(local, remote)
      if (!sameDoc(merged, local)) state.applyRemote(merged)

      if (sameDoc(merged, remote)) {
        writeConfig({ secret: current.secret, etag, hash: await digest(merged), last: Date.now() })
        return
      }
      if (await put(keys, current.secret, merged, { 'If-Match': etag })) return
    }
    throw new Error('Could not sync. Try again in a moment.')
  }

  let inflight = null
  let again = false
  let timer = null

  function syncNow() {
    clearTimeout(timer)
    if (!readConfig()) return Promise.resolve(status)
    if (inflight) {
      again = true
      return inflight
    }
    setStatus({ state: 'syncing', error: null })
    inflight = (async () => {
      try {
        do {
          again = false
          await round()
        } while (again)
        setStatus({ state: 'idle', error: null, last: readConfig()?.last ?? Date.now() })
      } catch (err) {
        setStatus({ state: 'error', error: err.message || 'Sync failed.' })
      } finally {
        inflight = null
      }
      return status
    })()
    return inflight
  }

  function schedule() {
    if (!readConfig()) return
    clearTimeout(timer)
    timer = setTimeout(syncNow, delay)
  }

  return {
    status: () => status,
    onStatus(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    isOn: () => !!readConfig(),
    syncNow,
    schedule,

    // Start syncing from this device. Returns the 12-word phrase to write down.
    async enable() {
      const secret = generateSecret()
      const text = b64u.encode(secret)
      const keys = await keysFor(text)
      writeConfig({ secret: text, etag: null, hash: null, last: null })
      try {
        await put(keys, text, state.snapshot(), { 'If-None-Match': '*' })
      } catch (err) {
        writeConfig(null)
        throw err
      }
      setStatus({ state: 'idle', error: null, last: readConfig().last })
      return phraseFromSecret(secret)
    },

    // Join existing synced data with a 12-word phrase or the secret from a link.
    async join(input) {
      const text = input.trim()
      const secret = /\s/.test(text) ? await secretFromPhrase(text) : b64u.decode(text)
      if (secret.length !== 16) throw new Error('That does not look like a sync phrase.')
      const secretText = b64u.encode(secret)
      const keys = await keysFor(secretText)

      const res = await call(keys, 'GET')
      if (res.status === 404) throw new Error('No synced data was found for that phrase. Check the words, or turn sync on from the other device first.')
      if (!res.ok) throw fail(res)

      let remote
      try {
        remote = await decryptDoc(keys.key, (await res.json()).blob)
      } catch {
        throw new Error('That phrase found data, but it could not be unlocked.')
      }
      writeConfig({ secret: secretText, etag: res.headers.get('ETag'), hash: null, last: null })
      const merged = mergeDocs(state.snapshot(), remote)
      if (!sameDoc(merged, state.snapshot())) state.applyRemote(merged)
      setStatus({ state: 'idle', error: null })
      await syncNow() // uploads the merge if this device had anything new
    },

    phrase: async () => phraseFromSecret(b64u.decode(readConfig().secret)),
    link: () => `${globalThis.location?.origin ?? ''}/#sync=${readConfig().secret}`,

    // Stop syncing on this device. The server copy and other devices are untouched.
    disconnect() {
      clearTimeout(timer)
      writeConfig(null)
      keysCache = null
      setStatus({ state: 'off', error: null, last: null })
    },

    // Delete the server copy as well. Other devices keep their local data.
    async destroy() {
      const cfg = readConfig()
      if (!cfg) return
      const res = await call(await keysFor(cfg.secret), 'DELETE')
      if (!res.ok && res.status !== 404) throw fail(res)
      this.disconnect()
    },
  }
}
