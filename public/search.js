// Search over the bundled BSB text. Pure functions plus an index loader, so it runs in node tests too.
//
// A verse is { b, c, v, text, key }. `key` is the verse lowercased with accents, punctuation and
// apostrophes removed, padded with a space on both sides, so " love " is a whole word and " lov" a prefix.

import { BOOKS } from './books.js'

export const normalize = s =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// "[1] In the beginning... [2] ..." -> [{ v: 1, text }, { v: 2, text }]. Text before the first mark
// (a psalm's title line) has no verse number of its own and is left out.
export function splitVerses(raw) {
  const parts = raw.split(/\[(\d+)\]/)
  const out = []
  for (let i = 1; i < parts.length; i += 2) {
    const text = parts[i + 1].replace(/\s+/g, ' ').trim()
    if (text) out.push({ v: Number(parts[i]), text })
  }
  return out
}

export function indexBook(b, chapters) {
  const verses = []
  chapters.forEach((raw, i) => {
    for (const { v, text } of splitVerses(raw)) verses.push({ b, c: i + 1, v, text, key: ` ${normalize(text)} ` })
  })
  return verses
}

// loadBook(b) resolves to that book's array of chapter texts. A few books load at a time.
export async function loadIndex(loadBook, onProgress = () => {}) {
  const perBook = new Array(BOOKS.length)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < BOOKS.length) {
      const b = next++
      perBook[b] = indexBook(b, await loadBook(b))
      onProgress(++done, BOOKS.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return perBook.flat()
}

// `love "born again" faith` -> { terms: ['love', 'faith'], phrases: ['born again'] }
export function parseQuery(q) {
  const phrases = []
  const rest = q.replace(/["“”]([^"“”]+)["“”]?/g, (_, p) => {
    const n = normalize(p)
    if (n) phrases.push(n)
    return ' '
  })
  return { terms: normalize(rest).split(' ').filter(Boolean), phrases }
}

export const isEmptyQuery = query => !query.terms.length && !query.phrases.length

// Every term has to start a word in the verse and every phrase has to appear. Whole-word hits and
// terms in the typed order rank first; the rest stay in Bible order.
export function search(index, query) {
  if (isEmptyQuery(query)) return []
  const { terms, phrases } = query
  const sequence = terms.length > 1 ? ` ${terms.join(' ')}` : null
  const hits = []
  for (let i = 0; i < index.length; i++) {
    const key = index[i].key
    let score = 0
    let ok = true
    for (const p of phrases) {
      if (!key.includes(` ${p}`)) {
        ok = false
        break
      }
      score += key.includes(` ${p} `) ? 6 : 4
    }
    if (!ok) continue
    for (const t of terms) {
      if (key.includes(` ${t} `)) score += 2
      else if (key.includes(` ${t}`)) score += 1
      else {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (sequence && key.includes(sequence)) score += 3
    hits.push({ i, score })
  }
  hits.sort((a, b) => b.score - a.score || a.i - b.i)
  return hits.map(h => index[h.i])
}

// Splits text into [{ t, hit }] so matched words can be marked without touching innerHTML.
export function highlight(text, query) {
  // Typed words match as prefixes; inside a phrase only the last word may be cut short.
  const prefixes = [...query.terms]
  const whole = new Set()
  for (const p of query.phrases) {
    const words = p.split(' ')
    words.forEach((w, i) => (i < words.length - 1 ? whole.add(w) : prefixes.push(w)))
  }
  const segs = []
  let last = 0
  for (const m of text.matchAll(/[\p{L}\p{N}’']+/gu)) {
    const w = normalize(m[0])
    if (!w || !(whole.has(w) || prefixes.some(n => w.startsWith(n)))) continue
    if (m.index > last) segs.push({ t: text.slice(last, m.index), hit: false })
    segs.push({ t: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < text.length) segs.push({ t: text.slice(last), hit: false })
  return segs
}

// A window of a long verse around its first match, cut at word boundaries.
export function snippet(text, query, max = 200) {
  if (text.length <= max) return highlight(text, query)
  const first = highlight(text, query).find(s => s.hit)
  const at = first ? text.indexOf(first.t) : 0
  let start = Math.max(0, at - 60)
  if (start > 0) {
    const sp = text.indexOf(' ', start)
    start = sp < 0 ? start : sp + 1
  }
  let end = Math.min(text.length, start + max)
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end)
    end = sp > start ? sp : end
  }
  const segs = highlight(text.slice(start, end), query)
  if (start > 0) segs.unshift({ t: '…', hit: false })
  if (end < text.length) segs.push({ t: '…', hit: false })
  return segs
}

// ---------- jumping straight to a passage: "john 3:16", "1 cor 13", "ps 23", "jude 5" ----------

const KEYS = BOOKS.map(b => b.n.toLowerCase().replace(/\s+/g, ''))
const ALIASES = {
  gn: 'genesis', ge: 'genesis', ex: 'exodus', lv: 'leviticus', nm: 'numbers', dt: 'deuteronomy',
  ps: 'psalms', sos: 'songofsolomon', songofsongs: 'songofsolomon',
  mt: 'matthew', mk: 'mark', lk: 'luke', jn: 'john',
}

function findBook(num, name) {
  const base = name.replace(/[.\s]+/g, '')
  const key = num + (ALIASES[base] || base)
  const exact = KEYS.indexOf(key)
  if (exact >= 0) return exact
  return base.length < 3 ? -1 : KEYS.findIndex(k => k.startsWith(key))
}

// -> { b, c, v, v2, verse, chapter } or null. `verse` is true when a verse (or range v..v2) was given,
// `chapter` when a chapter or verse was given; a bare book name has neither and means chapter 1.
export function parseReference(q) {
  const m = q
    .trim()
    .toLowerCase()
    .match(/^([1-3])?\s*([a-z][a-z .]*?)\s*(?:(\d+)(?:\s*[:.\s]\s*(\d+))?(?:\s*[-–]\s*(\d+))?)?$/)
  if (!m) return null
  const b = findBook(m[1] || '', m[2])
  if (b < 0) return null
  let c = m[3] ? Number(m[3]) : 1
  let v = m[4] ? Number(m[4]) : null
  if (BOOKS[b].c === 1 && m[3] && v == null) {
    v = c // "jude 5" means verse 5 of the only chapter
    c = 1
  }
  if (c < 1 || c > BOOKS[b].c) return null
  const end = v != null && m[5] ? Number(m[5]) : null
  return { b, c, v: v ?? 1, v2: end != null && end >= v ? end : (v ?? 1), verse: v != null, chapter: !!m[3] }
}

// The verses a reference points at: the verse or range, or the whole chapter when no verse was given.
export function lookup(index, ref) {
  return index.filter(x => x.b === ref.b && x.c === ref.c && (!ref.verse || (x.v >= ref.v && x.v <= ref.v2)))
}
