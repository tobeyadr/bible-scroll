// Her saved passages, notes and reading position, kept in localStorage as one document (see merge.js).
// Settings stay separate: text size and theme are per device.
import { emptyDoc, normalizeDoc } from './merge.js'
import { BOOKS } from './books.js'
import { WHOLE, readKey, addRange, sameRanges, hasRange, chapterStatus } from './read.js'

const KEY = 'bs:doc'

export function createState(storage) {
  const read = key => {
    try {
      const raw = storage.getItem(key)
      return raw == null ? null : JSON.parse(raw)
    } catch {
      return null
    }
  }
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value))
    } catch {}
  }

  // Version 1 of the app kept these as separate keys.
  function load() {
    const existing = read(KEY)
    if (existing) return normalizeDoc(existing)
    const doc = emptyDoc()
    const oldSaved = read('bs:saved')
    if (Array.isArray(oldSaved)) {
      for (const s of oldSaved) doc.saved[s.k] = { b: s.b, c: s.c, v1: s.v1, v2: s.v2, u: s.at || Date.now() }
    }
    const oldPos = read('bs:pos')
    if (oldPos) doc.pos = { b: oldPos.b, c: oldPos.c, v: oldPos.v, u: Date.now() }
    write(KEY, doc)
    return doc
  }

  let doc = load()
  let committed = doc // what listeners last saw, so they can tell what changed
  const listeners = new Set()

  function commit(source) {
    const previous = committed
    committed = doc
    write(KEY, doc)
    listeners.forEach(fn => fn(source, previous))
  }

  const live = map =>
    Object.entries(map)
      .filter(([, item]) => !item.d)
      .map(([k, item]) => ({ k, ...item }))

  const newId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  // Writes one chapter's reading record; the time always moves forward, and a clear remembers when it happened.
  function putRead(key, { r, n }, old, andCommit = true, clearing = false) {
    const now = Math.max(Date.now(), (old?.u || 0) + 1)
    const entry = { r, n, u: now }
    const z = clearing ? now : old?.z
    if (z) entry.z = z
    doc = { ...doc, read: { ...doc.read, [key]: entry } }
    if (andCommit) commit('local')
  }

  return {
    snapshot: () => doc,
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    savedList: () => live(doc.saved).sort((a, b) => b.u - a.u),
    isSaved: key => !!doc.saved[key] && !doc.saved[key].d,
    setSaved({ k, b, c, v1, v2 }, on) {
      doc = { ...doc, saved: { ...doc.saved, [k]: on ? { b, c, v1, v2, u: Date.now() } : { u: Date.now(), d: 1 } } }
      commit('local')
    },

    noteList: () => live(doc.notes).sort((a, b) => b.u - a.u),
    // Notes whose verses overlap the given range, oldest first.
    notesFor: (b, c, v1, v2) =>
      live(doc.notes)
        .filter(n => n.b === b && n.c === c && n.v1 <= v2 && n.v2 >= v1)
        .sort((x, y) => x.at - y.at),
    saveNote({ id, b, c, v1, v2, text }) {
      const now = Date.now()
      const key = id || newId()
      const at = doc.notes[key]?.at ?? now
      doc = { ...doc, notes: { ...doc.notes, [key]: { b, c, v1, v2, text, at, u: now } } }
      commit('local')
      return key
    },
    deleteNote(id) {
      doc = { ...doc, notes: { ...doc.notes, [id]: { u: Date.now(), d: 1 } } }
      commit('local')
    },

    getPos: () => doc.pos,
    setPos({ b, c, v }) {
      if (doc.pos && doc.pos.b === b && doc.pos.c === c && doc.pos.v === v) return
      doc = { ...doc, pos: { b, c, v, u: Date.now() } }
      commit('local')
    },

    // What she has read (read.js). Returns true when something new was recorded.
    readEntry: (b, c) => doc.read[readKey(b, c)] ?? null,
    readMap: () => doc.read,
    hasRead: (b, c, v1, v2) => hasRange(doc.read[readKey(b, c)]?.r, v1, v2),
    markRead(b, c, v1, v2, n) {
      const key = readKey(b, c)
      const old = doc.read[key]
      const r = addRange(old?.r, v1, v2)
      if (old && sameRanges(old.r, r) && (old.n || 0) >= n) return false
      putRead(key, { r, n: Math.max(old?.n || 0, n) }, old)
      return true
    },
    // Marks every chapter of a book as read, for books read before using the app.
    markBookRead(b) {
      for (let c = 1; c <= BOOKS[b].c; c++) {
        const old = doc.read[readKey(b, c)]
        if (chapterStatus(old) !== 'read') putRead(readKey(b, c), { r: [[1, WHOLE]], n: old?.n || 0 }, old, false)
      }
      commit('local')
    },
    // Forgets what was read in one book, or in all of them.
    clearRead(b) {
      for (const [key, old] of Object.entries(doc.read)) {
        if (b != null && !key.startsWith(`${b}.`)) continue
        if (old.r?.length) putRead(key, { r: [], n: old.n || 0 }, old, false, true)
      }
      commit('local')
    },

    // Called by sync with the merged result.
    applyRemote(merged) {
      doc = normalizeDoc(merged)
      commit('remote')
    },
  }
}
