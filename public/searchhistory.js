// Her recent searches: newest first, no repeats, a handful kept. Pure functions; the list itself is saved by the caller.

export const MAX_SEARCHES = 15

const clean = s => String(s).replace(/\s+/g, ' ').trim()
const same = (a, b) => a.toLowerCase() === b.toLowerCase()

// A search worth keeping has at least two letters or digits.
const keepable = s => s.replace(/[^\p{L}\p{N}]/gu, '').length >= 2

export function remember(list, raw) {
  const text = clean(raw)
  if (!keepable(text)) return list
  return [text, ...list.filter(s => !same(s, text))].slice(0, MAX_SEARCHES)
}

export const forget = (list, raw) => list.filter(s => !same(s, clean(raw)))

// Whatever was in storage, as a clean list.
export const readList = value => (Array.isArray(value) ? value.filter(s => typeof s === 'string' && keepable(s)).slice(0, MAX_SEARCHES) : [])
