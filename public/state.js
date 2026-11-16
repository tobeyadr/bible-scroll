// Her saved passages, notes and reading position, kept in localStorage as one document (see merge.js).
// Settings stay separate: text size and theme are per device.
import { emptyDoc, normalizeDoc } from './merge.js'
import { BOOKS } from './books.js'
import { DEFAULT_COLOR, contains, sameSpot } from './highlight.js'
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

  // Groups notes (oldest first) under the note they reply to. A reply whose original is gone, say deleted on another
  // device, stands on its own so it is never lost. Each result carries its replies and the time of the latest one.
  const threads = notes => {
    const ids = new Set(notes.map(n => n.k))
    const roots = notes.filter(n => !n.p || !ids.has(n.p)).map(n => ({ ...n, replies: [] }))
    const byId = new Map(roots.map(n => [n.k, n]))
    for (const n of notes) if (n.p && byId.has(n.p)) byId.get(n.p).replies.push(n)
    for (const root of roots) root.last = Math.max(root.u, ...root.replies.map(r => r.u))
    return roots
  }

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

    // The notes to list: each original note once, most recently touched first (a reply counts as touching it).
    noteList: () => threads(live(doc.notes)).sort((a, b) => b.last - a.last),
    // Notes (and replies) whose verses overlap the given range, oldest first.
    notesFor: (b, c, v1, v2) =>
      live(doc.notes)
        .filter(n => n.b === b && n.c === c && n.v1 <= v2 && n.v2 >= v1)
        .sort((x, y) => x.at - y.at),
    // The same notes grouped for reading: each original note, newest first, with its replies oldest first.
    threadsFor: (b, c, v1, v2) =>
      threads(
        live(doc.notes)
          .filter(n => n.b === b && n.c === c && n.v1 <= v2 && n.v2 >= v1)
          .sort((x, y) => x.at - y.at),
      ).sort((x, y) => y.at - x.at),
    // p is the note this one replies to. A reply always hangs off the original, never off another reply.
    // q is words quoted from the passage, and h the highlight they came from.
    saveNote({ id, b, c, v1, v2, text, p, q, h }) {
      const now = Date.now()
      const key = id || newId()
      const at = doc.notes[key]?.at ?? now
      const note = { b, c, v1, v2, text, at, u: now }
      const parent = p && (doc.notes[p]?.p || p)
      if (parent) note.p = parent
      if (q) note.q = q
      if (q && h) note.h = h
      doc = { ...doc, notes: { ...doc.notes, [key]: note } }
      commit('local')
      return key
    },
    // Deleting a note takes its replies with it.
    deleteNote(id) {
      const now = Date.now()
      const gone = { [id]: { u: now, d: 1 } }
      for (const [k, n] of Object.entries(doc.notes)) if (n.p === id && !n.d) gone[k] = { u: now, d: 1 }
      doc = { ...doc, notes: { ...doc.notes, ...gone } }
      commit('local')
    },

    // Highlights of one chapter in one translation, oldest first (so the newest is drawn on top).
    highlightsFor: (b, c, t) =>
      live(doc.hl)
        .filter(h => h.b === b && h.c === c && h.t === t)
        .sort((x, y) => x.at - y.at || (x.k < y.k ? -1 : 1))
        .map(({ k, ...h }) => ({ id: k, ...h })),
    // Highlights a new one completely covers are replaced by it, and the same words highlighted again just
    // change colour. Returns the id of the highlight now on those words.
    addHighlight({ b, c, t, v1, s, v2, e, q, col }) {
      const now = Date.now()
      const spot = { v1, s, v2, e }
      const next = { ...doc.hl }
      let id = null
      for (const h of live(doc.hl)) {
        if (h.b !== b || h.c !== c || h.t !== t) continue
        if (sameSpot(h, spot)) {
          id = h.k
          next[id] = { ...doc.hl[id], col: col || h.col, u: now }
        } else if (contains(spot, h)) {
          next[h.k] = { u: now, d: 1 }
        }
      }
      if (!id) {
        id = newId()
        next[id] = { b, c, t, v1, s, v2, e, q, col: col || DEFAULT_COLOR, at: now, u: now }
      }
      doc = { ...doc, hl: next }
      commit('local')
      return id
    },
    setHighlightColor(id, col) {
      if (!doc.hl[id] || doc.hl[id].d) return
      doc = { ...doc, hl: { ...doc.hl, [id]: { ...doc.hl[id], col, u: Date.now() } } }
      commit('local')
    },
    removeHighlight(id) {
      doc = { ...doc, hl: { ...doc.hl, [id]: { u: Date.now(), d: 1 } } }
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
