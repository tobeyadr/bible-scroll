import { BOOKS } from './books.js'

// Which picture goes behind a card in the Illustrated theme. The list is { ref, img } entries from
// /art/manifest.json, and a ref can be a whole book ("Genesis"), a chapter ("Genesis 7"), chapters ("Matthew 5-7"),
// a verse or a run of verses ("Genesis 11:1-9"), or a run that crosses chapters ("Genesis 6:9-9:17").
// The narrowest entry that covers the card wins, so a book picture is the default and anything more specific
// overrides it. Pure functions, so they can be tested without a browser.

const WHOLE = 999 // "to the end" of a chapter or a book

const key = (b, c, v) => b * 1e6 + c * 1e3 + v

const DASH = '\\s*[-\\u2013]\\s*'
const SHAPES = [
  [/^(\d+)$/, ([c]) => [c, 1, c, WHOLE]], // Genesis 7
  [new RegExp(`^(\\d+)${DASH}(\\d+)$`), ([c1, c2]) => [c1, 1, c2, WHOLE]], // Matthew 5-7
  [/^(\d+):(\d+)$/, ([c, v]) => [c, v, c, v]], // John 3:16
  [new RegExp(`^(\\d+):(\\d+)${DASH}(\\d+)$`), ([c, v1, v2]) => [c, v1, c, v2]], // Genesis 11:1-9
  [new RegExp(`^(\\d+):(\\d+)${DASH}(\\d+):(\\d+)$`), ([c1, v1, c2, v2]) => [c1, v1, c2, v2]], // Genesis 6:9-9:17
]

// "Genesis 11:1-9" -> { from, to } as sortable numbers, or null when it is not a real place in the Bible.
// Whether the verse numbers exist in that chapter is not checked here (the tests check the shipped list).
export function parseArtRef(ref) {
  const text = String(ref).trim()
  const b = BOOKS.findIndex(book => text === book.n || text.startsWith(`${book.n} `))
  if (b < 0) return null
  const rest = text.slice(BOOKS[b].n.length).trim()

  let c1 = 1
  let v1 = 1
  let c2 = BOOKS[b].c
  let v2 = WHOLE
  if (rest) {
    let numbers = null
    for (const [pattern, build] of SHAPES) {
      const m = rest.match(pattern)
      if (m) {
        numbers = build(m.slice(1).map(Number))
        break
      }
    }
    if (!numbers) return null
    ;[c1, v1, c2, v2] = numbers
  }
  if (c1 < 1 || c2 > BOOKS[b].c || v1 < 1 || v2 < 1) return null
  const from = key(b, c1, v1)
  const to = key(b, c2, v2)
  return from <= to ? { from, to } : null
}

// The entries as numbers, ready for pickArt. Anything that does not parse is left out.
export function compileArt(manifest) {
  const out = []
  for (const entry of manifest?.art ?? []) {
    const range = typeof entry?.img === 'string' && parseArtRef(entry.ref)
    if (range) out.push({ from: range.from, to: range.to, img: entry.img })
  }
  return out
}

// The picture for a card that starts at b (book index), c, v, or null. The narrowest range wins; if two are
// the same size, the one later in the list does.
export function pickArt(entries, b, c, v) {
  const at = key(b, c, v)
  let best = null
  for (const entry of entries) {
    if (at < entry.from || at > entry.to) continue
    if (!best || entry.to - entry.from <= best.to - best.from) best = entry
  }
  return best ? best.img : null
}

export const artUrl = img => `/art/${img}`
